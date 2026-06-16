/**
 * Customer Protocol migration + shadow-read tooling (PROT-1).
 *
 * Reads the three localStorage collections (protocols / sections / items),
 * groups them into {@link CustomerProtocolAggregate}s keyed by protocol id, and
 * upserts one row per protocol into `customer_protocols`. Protocols are company
 * + customer scoped; a protocol whose company has no Supabase row is skipped +
 * reported.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type {
  CustomerProtocolV2,
  CustomerProtocolSection,
  CustomerProtocolItem,
} from "@/types";
import { loadCompanyUuidMap } from "./customerMigration";
import {
  listCustomerProtocolSummariesFromSupabase,
  listFullCustomerProtocolsFromSupabase,
  type CustomerProtocolAggregate,
} from "./supabaseCustomerProtocolRepository";

const PROTOCOLS_KEY = "cleanops.customerProtocolsV2";
const SECTIONS_KEY = "cleanops.customerProtocolSections";
const ITEMS_KEY = "cleanops.customerProtocolItems";

function readKey<T>(key: string): T[] {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

/** Builds the lossless aggregates from the three localStorage collections. */
export function readLocalCustomerProtocolAggregates(): CustomerProtocolAggregate[] {
  const protocols = readKey<CustomerProtocolV2>(PROTOCOLS_KEY);
  const sections = readKey<CustomerProtocolSection>(SECTIONS_KEY);
  const items = readKey<CustomerProtocolItem>(ITEMS_KEY);
  return protocols.map((protocol) => ({
    protocol,
    sections: sections.filter((s) => s.customerProtocolId === protocol.id),
    items: items.filter((i) => i.customerProtocolId === protocol.id),
  }));
}

/** A single upsert row written to (or planned for) `customer_protocols`. */
export interface CustomerProtocolUpsertRow {
  legacy_id: string;
  company_id: string | null;
  company_legacy_id: string;
  customer_legacy_id: string;
  name: string;
  is_archived: boolean;
  deleted_at: string | null;
  data: CustomerProtocolAggregate;
}

/** Structured outcome of a customer-protocol migration run (or dry-run). */
export interface CustomerProtocolMigrationReport {
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
  aggregates: CustomerProtocolAggregate[],
  companyId: string | null | undefined,
): CustomerProtocolAggregate[] {
  if (companyId === undefined || companyId === null) return aggregates;
  return aggregates.filter((a) => a.protocol.companyId === companyId);
}

/** Maps a localStorage aggregate to a `customer_protocols` upsert row. */
export function toCustomerProtocolUpsertRow(
  aggregate: CustomerProtocolAggregate,
  companyUuid: string | null,
): CustomerProtocolUpsertRow {
  const p = aggregate.protocol;
  return {
    legacy_id: p.id,
    company_id: companyUuid,
    company_legacy_id: p.companyId,
    customer_legacy_id: p.customerId,
    name: p.name,
    is_archived: p.isArchived,
    deleted_at: null,
    data: aggregate,
  };
}

/** Migrates localStorage customer protocols into Supabase. */
export async function migrateCustomerProtocols(options?: {
  companyId?: string | null;
  dryRun?: boolean;
}): Promise<CustomerProtocolMigrationReport> {
  const companyId = options?.companyId ?? null;
  const dryRun = options?.dryRun ?? false;

  const source = scopeByCompany(readLocalCustomerProtocolAggregates(), companyId);
  const report: CustomerProtocolMigrationReport = {
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
  const rows: CustomerProtocolUpsertRow[] = [];
  for (const aggregate of source) {
    const p = aggregate.protocol;
    const uuid = companyMap.get(p.companyId) ?? null;
    if (!uuid) {
      report.skipped.push({
        id: p.id,
        reason: `No Supabase company found for legacy_id "${p.companyId}". Migrate companies first.`,
      });
      continue;
    }
    rows.push(toCustomerProtocolUpsertRow(aggregate, uuid));
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
        .from("customer_protocols")
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

/** Per-aspect outcome of a localStorage-vs-Supabase protocol comparison. */
export interface CustomerProtocolShadowReport {
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

/** Compares localStorage customer protocols against the Supabase shadow copy. */
export async function shadowReadCustomerProtocols(
  companyId?: string | null,
): Promise<CustomerProtocolShadowReport> {
  const scope = companyId ?? null;
  const queryScope = companyId ?? undefined;
  const notes: string[] = [];

  const local = scopeByCompany(readLocalCustomerProtocolAggregates(), queryScope);

  const report: CustomerProtocolShadowReport = {
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

  let remote: Awaited<ReturnType<typeof listCustomerProtocolSummariesFromSupabase>>;
  try {
    remote = await listCustomerProtocolSummariesFromSupabase(queryScope);
  } catch (err) {
    notes.push(err instanceof Error ? err.message : "Supabase read failed.");
    return report;
  }

  report.supabaseCount = remote.length;
  report.countMatch = local.length === remote.length;
  if (!report.countMatch) {
    notes.push(`count mismatch: local ${local.length} vs supabase ${remote.length}`);
  }

  const { onlyA, onlyB } = idSetDiff(
    local.map((a) => a.protocol.id),
    remote.map((p) => p.id),
  );
  report.missingInSupabase = onlyA;
  report.extraInSupabase = onlyB;
  report.idsMatch = onlyA.length === 0 && onlyB.length === 0;
  if (onlyA.length > 0) notes.push(`${onlyA.length} protocol(s) not yet in Supabase`);
  if (onlyB.length > 0) notes.push(`${onlyB.length} extra protocol(s) in Supabase`);

  const remoteById = new Map(remote.map((p) => [p.id, p] as const));
  let summaryMatch = true;
  for (const l of local) {
    const r = remoteById.get(l.protocol.id);
    if (!r) continue;
    if (r.name !== l.protocol.name || r.customerId !== l.protocol.customerId) {
      summaryMatch = false;
      notes.push(`summary mismatch for ${l.protocol.id}`);
      break;
    }
  }
  report.summaryMatch = summaryMatch;

  let detailMatch = true;
  const sample = local.find((l) => remoteById.has(l.protocol.id));
  if (sample) {
    try {
      const remoteFull = await listFullCustomerProtocolsFromSupabase(queryScope);
      const remoteDetail =
        remoteFull.find((a) => a.protocol.id === sample.protocol.id) ?? null;
      detailMatch =
        Boolean(remoteDetail) && JSON.stringify(remoteDetail) === JSON.stringify(sample);
      if (!detailMatch) notes.push(`detail mismatch for ${sample.protocol.id}`);
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
    migrateCustomerProtocols,
    shadowReadCustomerProtocols,
  };
}
