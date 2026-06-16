/**
 * Supabase-backed Team read repository (TEAM-1).
 *
 * The Teams analogue of {@link import("./supabaseEmployeeRepository")}. It reads
 * the `teams` table created in migration 0017 and returns the SAME shapes the
 * localStorage store returns, so the TEAM-2 read seam can swap it in with no UI
 * change.
 *
 * Behaviour parity: scoping mirrors the localStorage store \u2014 scope by the
 * app-facing `company_legacy_id`. Soft-deleted rows (`deleted_at` set) are
 * filtered out (WO-5.6 convention).
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import type { Team } from "@/types";

/** Columns selected for a lightweight summary list (no `data` jsonb). */
const SUMMARY_COLUMNS = "legacy_id, company_legacy_id, name, deleted_at";

/** Lightweight team row for count / id-set parity checks. */
export interface TeamSummary {
  id: string;
  companyId: string;
  name: string;
}

/** Shape of the flat summary columns returned by Supabase. */
interface TeamSummaryRow {
  legacy_id: string;
  company_legacy_id: string;
  name: string;
  deleted_at: string | null;
}

/** Shape of a full team row (the lossless `data` jsonb + scope/soft-delete). */
interface TeamFullRow {
  data: Team;
  company_legacy_id: string;
  deleted_at: string | null;
}

/** Thrown when the repository is used but Supabase is not configured. */
class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "SupabaseTeamRepository requires Supabase. Set EXPO_PUBLIC_SUPABASE_URL " +
        "and EXPO_PUBLIC_SUPABASE_ANON_KEY.",
    );
    this.name = "SupabaseNotConfiguredError";
  }
}

function rowToSummary(row: TeamSummaryRow): TeamSummary {
  return { id: row.legacy_id, companyId: row.company_legacy_id, name: row.name };
}

/**
 * Fetches the company-scoped summary rows. The optional company scope mirrors the
 * localStorage store: when `companyId` is omitted, all (RLS-visible) rows are
 * returned; otherwise only the matching `company_legacy_id`. Soft-deleted rows
 * are filtered out (WO-5.6 convention).
 */
export async function listTeamSummariesFromSupabase(
  companyId?: string | null,
): Promise<TeamSummary[]> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("teams.list.supabase.summaries");
  try {
    let query = supabase.from("teams").select(SUMMARY_COLUMNS);
    if (companyId !== undefined && companyId !== null) {
      query = query.eq("company_legacy_id", companyId);
    }
    const { data, error } = await query;
    if (error) {
      throw new Error(`[teams] Supabase list failed: ${error.message}`);
    }
    const rows = (data ?? []) as unknown as TeamSummaryRow[];
    return rows.filter((r) => !r.deleted_at).map(rowToSummary);
  } finally {
    stop();
  }
}

/**
 * Lists FULL team records (the lossless `data` jsonb) for a company scope.
 *
 * TEAM-2: the Teams settings surface renders the full team record (name,
 * description, createdAt). This returns the same {@link Team} objects the page
 * reads from localStorage today, so the read source can move to Supabase without
 * any visible behaviour change.
 *
 * Company scope mirrors the localStorage store: omit `companyId` for all
 * RLS-visible rows, or pass an app-facing id to filter on `company_legacy_id`.
 */
export async function listFullTeamsFromSupabase(
  companyId?: string | null,
): Promise<Team[]> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("teams.list.supabase.full");
  perf.count("teams.list.supabase.full.calls");
  try {
    let query = supabase.from("teams").select("data, company_legacy_id, deleted_at");
    if (companyId !== undefined && companyId !== null) {
      query = query.eq("company_legacy_id", companyId);
    }
    const { data, error } = await query;
    if (error) {
      throw new Error(`[teams] Supabase full list failed: ${error.message}`);
    }
    const rows = (data ?? []) as unknown as TeamFullRow[];
    return rows
      .filter((r) => !r.deleted_at)
      .map((r) => r.data)
      .filter((t): t is Team => Boolean(t));
  } finally {
    stop();
  }
}
