/**
 * Supabase-backed Activity Log read repository (ACTIVITY-1).
 *
 * The Activity Log analogue of {@link import("./supabaseAreaRepository")}. Reads
 * the `activity_events` table (migration 0029) and returns the SAME
 * {@link AuditEvent} shapes the localStorage store returns (rebuilt losslessly
 * from the `data` jsonb), so the read seam can swap it in with no UI change.
 *
 * The trail is append-only and date-ordered — reads come back newest-first and,
 * by default, scoped to the freshest `limit` rows so the Activity Log never
 * over-fetches (OP2 activity-log blueprint). A company scope returns that
 * company's events; unscoped returns all RLS-visible rows (super-admin path).
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import type { AuditEvent } from "@/types";

/** How many events the read seam reconciles by default (matches the local cap). */
export const ACTIVITY_DEFAULT_LIMIT = 500;

const SUMMARY_COLUMNS =
  "legacy_id, company_legacy_id, actor_id, actor_name, actor_role, action, occurred_at";

/** Lightweight event row for count / id-set parity checks. */
export interface ActivityEventRowSummary {
  id: string;
  companyId: string | null;
  actorId: string | null;
  action: string;
  at: string;
}

interface ActivitySummaryRow {
  legacy_id: string;
  company_legacy_id: string | null;
  actor_id: string | null;
  actor_name: string;
  actor_role: string;
  action: string;
  occurred_at: string;
}

interface ActivityFullRow {
  data: AuditEvent;
}

class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "SupabaseActivityRepository requires Supabase. Set EXPO_PUBLIC_SUPABASE_URL " +
        "and EXPO_PUBLIC_SUPABASE_ANON_KEY.",
    );
    this.name = "SupabaseNotConfiguredError";
  }
}

function rowToSummary(row: ActivitySummaryRow): ActivityEventRowSummary {
  return {
    id: row.legacy_id,
    companyId: row.company_legacy_id,
    actorId: row.actor_id,
    action: row.action,
    at: row.occurred_at,
  };
}

/** Company-scoped summary rows (newest first), capped to `limit`. */
export async function listActivityEventSummariesFromSupabase(
  companyId?: string | null,
  limit: number = ACTIVITY_DEFAULT_LIMIT,
): Promise<ActivityEventRowSummary[]> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("activity.list.supabase.summaries");
  try {
    let query = supabase
      .from("activity_events")
      .select(SUMMARY_COLUMNS)
      .order("occurred_at", { ascending: false })
      .limit(limit);
    if (companyId !== undefined && companyId !== null) {
      query = query.eq("company_legacy_id", companyId);
    }
    const { data, error } = await query;
    if (error) throw new Error(`[activity] Supabase list failed: ${error.message}`);
    const rows = (data ?? []) as unknown as ActivitySummaryRow[];
    return rows.map(rowToSummary);
  } finally {
    stop();
  }
}

/** FULL audit-event records (lossless `data` jsonb), newest first, capped. */
export async function listActivityEventsFromSupabase(
  companyId?: string | null,
  limit: number = ACTIVITY_DEFAULT_LIMIT,
): Promise<AuditEvent[]> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("activity.list.supabase.full");
  perf.count("activity.list.supabase.full.calls");
  try {
    let query = supabase
      .from("activity_events")
      .select("data, occurred_at")
      .order("occurred_at", { ascending: false })
      .limit(limit);
    if (companyId !== undefined && companyId !== null) {
      query = query.eq("company_legacy_id", companyId);
    }
    const { data, error } = await query;
    if (error) throw new Error(`[activity] Supabase full list failed: ${error.message}`);
    const rows = (data ?? []) as unknown as ActivityFullRow[];
    return rows.map((r) => r.data).filter((e): e is AuditEvent => Boolean(e));
  } finally {
    stop();
  }
}
