/**
 * Supabase-backed Saved Review Queue READ repository (Slice 2b-3).
 *
 * The read adapter for the Time Reporting workspace's saved review queues — the
 * named, shareable, ordered views over time reports used for exception-based
 * triage. It implements the storage-agnostic {@link SavedReviewQueueRepository}
 * contract against the migration-0032 tables (`saved_review_queues` and, for the
 * optional saved-filter link hydration, `saved_filters`) and returns the SAME
 * {@link SavedReviewQueue} shape the contract declares, rebuilt losslessly from
 * the `data` jsonb.
 *
 * SCOPE — READ ONLY, DORMANT. There are NO create / update / delete queue
 * mutations, NO evaluation/execution of the saved filters (membership is not
 * computed here), and this is NOT wired into AppContext, any page or any route.
 * {@link shouldReadSavedReviewQueuesFromSupabase} exposes the dormant
 * {@link TIME_REPORTING_SUPABASE_READ} gate (DEFAULT OFF) for a future consumer;
 * nothing reads it yet, and it deliberately does NOT use the cut-over resolver.
 *
 * QUERY RULES (Slice 2b-3):
 *   - Every query is company-scoped first (by the app-facing `company_legacy_id`).
 *   - Soft-deleted rows (`deleted_at` set) are excluded by default.
 *   - Filtering + pagination happen SERVER-SIDE (`.eq/.or` + `.range`
 *     + `{ count: "exact" }`) — rows are never fully loaded and sliced in memory.
 *   - Queue rows stay lightweight: the flat columns + the single `data` jsonb of
 *     the queue (which already embeds its filter losslessly).
 *   - Deterministic ordering: `sort_order` asc, then `legacy_id` asc.
 *   - The saved filter criteria stay in `data` jsonb. `getById` only hydrates the
 *     filter from the linked `saved_filters` row when the embedded filter is
 *     missing — never an evaluation, never a per-row N+1 in `list`.
 *
 * EMPTY SUPABASE IS VALID: an empty result returns an empty list / `total: 0`
 * and a missing queue returns `null` — there is NO fallback to localStorage, NO
 * seed and NO unsafe-empty behaviour.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import { evaluateSearchThreshold } from "@/lib/searchThreshold";
import { TIME_REPORTING_SUPABASE_READ } from "@/lib/featureFlags";
import type { SavedFilter, SavedReviewQueue } from "@/types/timeReporting";
import type { SavedReviewQueueRepository } from "./timeReportingRepository";
import type { CountParams, ListParams, ListResult } from "./types";

/**
 * Flat queue columns + the lossless queue `data` jsonb. The flat columns drive
 * server-side filtering / ordering / pagination; `data` carries the full
 * {@link SavedReviewQueue} including the embedded filter.
 */
const QUEUE_COLUMNS =
  "legacy_id, company_legacy_id, name, description, saved_filter_legacy_id, " +
  "shared, sort_order, created_by_user_id, data, created_at, updated_at";

/** Shape of the flat queue columns (+ `data`) returned by Supabase. */
interface SavedReviewQueueRow {
  legacy_id: string;
  company_legacy_id: string;
  name: string | null;
  description: string | null;
  saved_filter_legacy_id: string | null;
  shared: boolean | null;
  sort_order: number | null;
  created_by_user_id: string | null;
  data: SavedReviewQueue | null;
  created_at: string | null;
  updated_at: string | null;
}

/** Shape of a `saved_filters` row used only for link hydration in getById. */
interface SavedFilterRow {
  data: SavedFilter | null;
  deleted_at: string | null;
}

/** Thrown when the repository is used but Supabase is not configured. */
class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "SupabaseSavedReviewQueueRepository requires Supabase. Set " +
        "EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.",
    );
    this.name = "SupabaseNotConfiguredError";
  }
}

/**
 * Dormant read gate (DEFAULT OFF). Slice 2b-3 wires NO live consumer; this is
 * here so a later read-seam wave can switch the saved-queue read source without
 * renaming. It deliberately does NOT use the cut-over resolver.
 */
export function shouldReadSavedReviewQueuesFromSupabase(): boolean {
  return TIME_REPORTING_SUPABASE_READ;
}

/**
 * A minimal valid filter when neither the embedded queue filter nor a linked
 * saved filter is available — keeps the {@link SavedReviewQueue} type whole
 * without inventing criteria (no evaluation, no membership implied).
 */
function fallbackFilter(row: SavedReviewQueueRow): SavedFilter {
  return {
    id: row.saved_filter_legacy_id ?? "",
    companyId: row.company_legacy_id,
    name: "",
    match: "all",
    criteria: [],
    createdAt: row.created_at ?? "",
    updatedAt: row.updated_at ?? "",
  };
}

/** Rebuilds a {@link SavedReviewQueue} from the flat columns + `data` jsonb. */
function rowToQueue(
  row: SavedReviewQueueRow,
  filterOverride?: SavedFilter,
): SavedReviewQueue {
  const d = row.data ?? ({} as Partial<SavedReviewQueue>);
  const filter = filterOverride ?? d.filter ?? fallbackFilter(row);
  return {
    id: row.legacy_id,
    companyId: row.company_legacy_id,
    name: row.name ?? d.name ?? "",
    description: row.description ?? d.description ?? undefined,
    filter,
    shared: row.shared ?? d.shared ?? false,
    sortOrder: row.sort_order ?? d.sortOrder ?? undefined,
    createdByUserId: row.created_by_user_id ?? d.createdByUserId ?? undefined,
    createdAt: row.created_at ?? d.createdAt ?? "",
    updatedAt: row.updated_at ?? d.updatedAt ?? "",
  };
}

/** True when the queue carries no usable embedded filter criteria. */
function hasEmbeddedFilter(queue: SavedReviewQueue | null): boolean {
  return Boolean(queue?.filter && Array.isArray(queue.filter.criteria));
}

/** Builds the free-text OR expression matched server-side against name/description. */
function buildSearchExpression(rawSearch: string | undefined): string | null {
  const { activeQuery, shouldSearch } = evaluateSearchThreshold(rawSearch ?? "");
  if (!shouldSearch) return null;
  const term = activeQuery.replace(/[*,]/g, "").toLowerCase();
  if (!term) return null;
  return [`name.ilike.*${term}*`, `description.ilike.*${term}*`].join(",");
}

/**
 * A minimal structural view of the chainable PostgREST query the reads touch,
 * typed locally so helpers can be shared without leaking `any`.
 */
interface FilterableQuery {
  eq(column: string, value: unknown): FilterableQuery;
  is(column: string, value: unknown): FilterableQuery;
  or(filters: string): FilterableQuery;
}

/** Applies company scope, soft-delete exclusion and free-text search. */
function applyScope<Q extends FilterableQuery>(
  query: Q,
  params: ListParams | CountParams,
): Q {
  let q: FilterableQuery = query;
  if (params.companyId !== undefined && params.companyId !== null) {
    q = q.eq("company_legacy_id", params.companyId);
  }
  q = q.is("deleted_at", null);
  const searchExpr = buildSearchExpression(params.search);
  if (searchExpr) {
    q = q.or(searchExpr);
  }
  return q as Q;
}

/** Loads the linked saved filter for one queue, or null when missing / deleted. */
async function loadLinkedFilter(
  savedFilterLegacyId: string,
): Promise<SavedFilter | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("saved_filters")
    .select("data, deleted_at")
    .eq("legacy_id", savedFilterLegacyId)
    .maybeSingle();
  if (error) {
    throw new Error(`[savedReviewQueue] Supabase filter load failed: ${error.message}`);
  }
  if (!data) return null;
  const row = data as unknown as SavedFilterRow;
  if (row.deleted_at) return null;
  return row.data ?? null;
}

/**
 * The Slice 2b-3 read-only Saved Review Queue repository (dormant — no consumer).
 */
export const supabaseSavedReviewQueueRepository: SavedReviewQueueRepository = {
  async list(params: ListParams = {}) {
    if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
    const stop = perf.start("savedReviewQueue.list.supabase");
    try {
      let query = supabase
        .from("saved_review_queues")
        .select(QUEUE_COLUMNS, { count: "exact" }) as unknown as FilterableQuery;
      query = applyScope(query, params);
      // Deterministic ordering: explicit sort order, legacy_id tiebreak.
      let ordered = (query as unknown as {
        order(column: string, opts: { ascending: boolean }): unknown;
      }).order("sort_order", { ascending: true });
      ordered = (ordered as {
        order(column: string, opts: { ascending: boolean }): unknown;
      }).order("legacy_id", { ascending: true });

      const pageSize = params.pageSize;
      const page = params.page && params.page > 0 ? params.page : 1;
      let finalQuery = ordered;
      if (pageSize && pageSize > 0) {
        const from = (page - 1) * pageSize;
        finalQuery = (ordered as {
          range(from: number, to: number): unknown;
        }).range(from, from + pageSize - 1);
      }

      const { data, error, count } = (await finalQuery) as {
        data: SavedReviewQueueRow[] | null;
        error: { message: string } | null;
        count: number | null;
      };
      if (error) {
        throw new Error(`[savedReviewQueue] Supabase list failed: ${error.message}`);
      }
      const items = (data ?? []).map((r) => rowToQueue(r));
      const total = count ?? items.length;
      return {
        items,
        total,
        page: pageSize && pageSize > 0 ? page : 1,
        pageSize: pageSize && pageSize > 0 ? pageSize : total,
      } satisfies ListResult<SavedReviewQueue>;
    } finally {
      stop();
    }
  },

  async getById(id: string, params: ListParams = {}) {
    if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
    const stop = perf.start("savedReviewQueue.getById.supabase");
    try {
      const { data, error } = await supabase
        .from("saved_review_queues")
        .select(`${QUEUE_COLUMNS}, deleted_at`)
        .eq("legacy_id", id)
        .maybeSingle();
      if (error) {
        throw new Error(`[savedReviewQueue] Supabase getById failed: ${error.message}`);
      }
      if (!data) return null;
      const row = data as unknown as SavedReviewQueueRow & { deleted_at: string | null };
      if (row.deleted_at) return null;
      if (
        params.companyId !== undefined &&
        params.companyId !== null &&
        row.company_legacy_id !== params.companyId
      ) {
        return null;
      }
      // Hydrate the filter from the linked saved_filters row ONLY when the queue
      // does not already embed it (read-only link mapping; no evaluation).
      let filterOverride: SavedFilter | undefined;
      if (!hasEmbeddedFilter(row.data) && row.saved_filter_legacy_id) {
        const linked = await loadLinkedFilter(row.saved_filter_legacy_id);
        if (linked) filterOverride = linked;
      }
      return rowToQueue(row, filterOverride);
    } finally {
      stop();
    }
  },

  async count(params: CountParams = {}) {
    if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
    let query = supabase
      .from("saved_review_queues")
      .select("legacy_id", {
        count: "exact",
        head: true,
      }) as unknown as FilterableQuery;
    query = applyScope(query, params);
    const { error, count } = (await query) as unknown as {
      error: { message: string } | null;
      count: number | null;
    };
    if (error) {
      throw new Error(`[savedReviewQueue] Supabase count failed: ${error.message}`);
    }
    return count ?? 0;
  },
};
