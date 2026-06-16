/**
 * Booking Queue migration + shadow-read tooling (BQ-1).
 *
 * The Booking Queue analogue of {@link import("./areaMigration")}. Two READ-ONLY
 * development/admin utilities:
 *
 *   1. `migrateBookingQueue()` — copies localStorage queue items INTO the Supabase
 *      `booking_queue` table (idempotent upsert on `legacy_id`, `dryRun` mode).
 *      Items whose company has no Supabase row are skipped + reported.
 *   2. `shadowReadBookingQueue()` — diffs localStorage vs Supabase for a company
 *      scope (count / id set / soft-reference parity / detail payload).
 *
 * localStorage stays the source of truth; these tools only populate + verify.
 * The CRITICAL guarantee is `legacy_id` stability — re-derivation
 * (normalizeBookingQueueItem) keeps the same item id, so an upsert never orphans.
 */
import { getBookingQueue } from "@/lib/store";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { BookingQueueItem } from "@/types";
import { loadCompanyUuidMap } from "./customerMigration";
import {
  listBookingQueueSummariesFromSupabase,
  listFullBookingQueueFromSupabase,
} from "./supabaseBookingQueueRepository";

/** A single upsert row written to (or planned for) the `booking_queue` table. */
export interface BookingQueueUpsertRow {
  legacy_id: string;
  company_id: string | null;
  company_legacy_id: string;
  work_order_legacy_id: string;
  service_row_legacy_id: string;
  customer_legacy_id: string;
  assignment_status: string;
  schedule_status: string;
  service_date: string | null;
  cancelled_at: string | null;
  deleted_at: string | null;
  data: BookingQueueItem;
}

/** Structured outcome of a booking-queue migration run (or dry-run). */
export interface BookingQueueMigrationReport {
  ok: boolean;
  dryRun: boolean;
  companyId: string | null;
  sourceCount: number;
  plannedCount: number;
  writtenCount: number;
  skipped: Array<{ id: string; reason: string }>;
  error?: string;
}

function scopeByCompany(
  items: BookingQueueItem[],
  companyId: string | null | undefined,
): BookingQueueItem[] {
  if (companyId === undefined || companyId === null) return items;
  return items.filter((b) => b.companyId === companyId);
}

/**
 * Maps a localStorage {@link BookingQueueItem} to a `booking_queue` upsert row.
 * Shared by the migration utility and the dual-write mirror so both write
 * byte-identical rows. The full record is preserved losslessly in `data`.
 */
export function toBookingQueueUpsertRow(
  item: BookingQueueItem,
  companyUuid: string | null,
): BookingQueueUpsertRow {
  return {
    legacy_id: item.id,
    company_id: companyUuid,
    company_legacy_id: item.companyId,
    work_order_legacy_id: item.workOrderId,
    service_row_legacy_id: item.serviceRowId,
    customer_legacy_id: item.customerId,
    assignment_status: item.assignmentStatus,
    schedule_status: item.scheduleStatus,
    service_date: item.serviceDate ?? null,
    cancelled_at: item.cancelledAt ?? null,
    deleted_at: null,
    data: item,
  };
}

/** Migrates localStorage booking-queue items into Supabase. */
export async function migrateBookingQueue(options?: {
  companyId?: string | null;
  dryRun?: boolean;
}): Promise<BookingQueueMigrationReport> {
  const companyId = options?.companyId ?? null;
  const dryRun = options?.dryRun ?? false;

  const source = scopeByCompany(getBookingQueue(), companyId);
  const report: BookingQueueMigrationReport = {
    ok: false,
    dryRun,
    companyId,
    sourceCount: source.length,
    plannedCount: 0,
    writtenCount: 0,
    skipped: [],
  };

  if (!isSupabaseConfigured || !supabase) {
    report.error = "Supabase is not configured.";
    return report;
  }

  const companyMap = await loadCompanyUuidMap();
  const rows: BookingQueueUpsertRow[] = [];
  for (const item of source) {
    const uuid = companyMap.get(item.companyId) ?? null;
    if (!uuid) {
      report.skipped.push({
        id: item.id,
        reason: `No Supabase company found for legacy_id "${item.companyId}". Migrate companies first.`,
      });
      continue;
    }
    rows.push(toBookingQueueUpsertRow(item, uuid));
  }
  report.plannedCount = rows.length;

  if (dryRun || rows.length === 0) {
    report.ok = report.skipped.length === 0;
    return report;
  }

  const CHUNK = 200;
  try {
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const { error } = await supabase
        .from("booking_queue")
        .upsert(chunk, { onConflict: "legacy_id" });
      if (error) {
        report.error = `Upsert failed at chunk ${i / CHUNK}: ${error.message}`;
        report.writtenCount = i;
        return report;
      }
    }
    report.writtenCount = rows.length;
    report.ok = report.skipped.length === 0;
    return report;
  } catch (err) {
    report.error = err instanceof Error ? err.message : "Unknown migration error.";
    return report;
  }
}

/** Per-aspect outcome of a localStorage-vs-Supabase booking-queue comparison. */
export interface BookingQueueShadowReport {
  ok: boolean;
  companyId: string | null;
  localCount: number;
  supabaseCount: number;
  countMatch: boolean;
  idsMatch: boolean;
  summaryMatch: boolean;
  detailMatch: boolean;
  missingInSupabase: string[];
  extraInSupabase: string[];
  notes: string[];
}

function idSetDiff(a: string[], b: string[]): { onlyA: string[]; onlyB: string[] } {
  const setB = new Set(b);
  const setA = new Set(a);
  return { onlyA: a.filter((id) => !setB.has(id)), onlyB: b.filter((id) => !setA.has(id)) };
}

/** Compares localStorage queue items against the Supabase shadow copy for a scope. */
export async function shadowReadBookingQueue(
  companyId?: string | null,
): Promise<BookingQueueShadowReport> {
  const scope = companyId ?? null;
  const queryScope = companyId ?? undefined;
  const notes: string[] = [];

  const local = scopeByCompany(getBookingQueue(), queryScope);

  const report: BookingQueueShadowReport = {
    ok: false,
    companyId: scope,
    localCount: local.length,
    supabaseCount: 0,
    countMatch: false,
    idsMatch: false,
    summaryMatch: false,
    detailMatch: false,
    missingInSupabase: [],
    extraInSupabase: [],
    notes,
  };

  if (!isSupabaseConfigured || !supabase) {
    notes.push("Supabase is not configured.");
    return report;
  }

  let remote: Awaited<ReturnType<typeof listBookingQueueSummariesFromSupabase>>;
  try {
    remote = await listBookingQueueSummariesFromSupabase(queryScope);
  } catch (err) {
    notes.push(err instanceof Error ? err.message : "Supabase read failed.");
    return report;
  }

  report.supabaseCount = remote.length;
  report.countMatch = local.length === remote.length;
  if (!report.countMatch) {
    notes.push(`count mismatch: local ${local.length} vs supabase ${remote.length}`);
  }

  const { onlyA, onlyB } = idSetDiff(local.map((b) => b.id), remote.map((b) => b.id));
  report.missingInSupabase = onlyA;
  report.extraInSupabase = onlyB;
  report.idsMatch = onlyA.length === 0 && onlyB.length === 0;
  if (onlyA.length > 0) notes.push(`${onlyA.length} queue item(s) not yet in Supabase`);
  if (onlyB.length > 0) notes.push(`${onlyB.length} extra queue item(s) in Supabase`);

  const remoteById = new Map(remote.map((b) => [b.id, b] as const));
  let summaryMatch = true;
  for (const l of local) {
    const r = remoteById.get(l.id);
    if (!r) continue;
    if (
      r.companyId !== l.companyId ||
      r.workOrderId !== l.workOrderId ||
      r.serviceRowId !== l.serviceRowId
    ) {
      summaryMatch = false;
      notes.push(`summary mismatch for ${l.id}`);
      break;
    }
  }
  report.summaryMatch = summaryMatch;

  let detailMatch = true;
  const sample = local.find((l) => remoteById.has(l.id));
  if (sample) {
    try {
      const remoteFull = await listFullBookingQueueFromSupabase(queryScope);
      const remoteDetail = remoteFull.find((b) => b.id === sample.id) ?? null;
      detailMatch =
        Boolean(remoteDetail) && JSON.stringify(remoteDetail) === JSON.stringify(sample);
      if (!detailMatch) notes.push(`detail mismatch for ${sample.id}`);
    } catch (err) {
      detailMatch = false;
      notes.push(err instanceof Error ? err.message : "detail read failed");
    }
  }
  report.detailMatch = detailMatch;

  report.ok =
    report.countMatch && report.idsMatch && report.summaryMatch && report.detailMatch;
  return report;
}

if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    migrateBookingQueue,
    shadowReadBookingQueue,
  };
}
