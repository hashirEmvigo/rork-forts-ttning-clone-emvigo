/**
 * Customer Protocol dual-write mirror (PROT-1).
 *
 * localStorage stays the source of truth: every protocol write completes against
 * localStorage BEFORE this runs. When dual-write / authoritative mode is on, the
 * protocol store fires {@link mirrorCustomerProtocolWrites} to MIRROR the change
 * into `customer_protocols`. Operates on {@link CustomerProtocolAggregate}s
 * (protocol + sections + items). Company-scoped; a protocol whose company has no
 * Supabase row is skipped + reported. Never throws, idempotent, soft-delete
 * removal propagation, self-validating.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import { loadCompanyUuidMap } from "./customerMigration";
import type { CustomerProtocolAggregate } from "./supabaseCustomerProtocolRepository";
import {
  toCustomerProtocolUpsertRow,
  type CustomerProtocolUpsertRow,
} from "./customerProtocolMigration";

export type CustomerProtocolWriteField = "legacy_id" | "company_legacy_id" | "name";

export interface CustomerProtocolWriteMismatch {
  id: string;
  field: CustomerProtocolWriteField | "missing";
  local: string;
  supabase: string;
  at: string;
}

export interface CustomerProtocolWriteDiff {
  created: string[];
  updated: string[];
  removed: string[];
}

export interface CustomerProtocolDualWriteResult {
  ok: boolean;
  noop: boolean;
  diff: CustomerProtocolWriteDiff;
  mirrored: number;
  removed: number;
  skipped: Array<{ id: string; reason: string }>;
  mismatches: CustomerProtocolWriteMismatch[];
  error: string | null;
  durationMs: number;
}

export interface CustomerProtocolDualWriteState {
  runs: number;
  noops: number;
  created: number;
  updated: number;
  removed: number;
  skipped: number;
  validations: number;
  mismatches: number;
  failures: number;
  lastError: string | null;
  lastRunAt: string | null;
  recentMismatches: CustomerProtocolWriteMismatch[];
}

const MAX_RECENT_MISMATCHES = 50;

const state: CustomerProtocolDualWriteState = {
  runs: 0,
  noops: 0,
  created: 0,
  updated: 0,
  removed: 0,
  skipped: 0,
  validations: 0,
  mismatches: 0,
  failures: 0,
  lastError: null,
  lastRunAt: null,
  recentMismatches: [],
};

export function getCustomerProtocolDualWriteState(): CustomerProtocolDualWriteState {
  return { ...state, recentMismatches: [...state.recentMismatches] };
}

export function resetCustomerProtocolDualWriteState(): void {
  state.runs = 0;
  state.noops = 0;
  state.created = 0;
  state.updated = 0;
  state.removed = 0;
  state.skipped = 0;
  state.validations = 0;
  state.mismatches = 0;
  state.failures = 0;
  state.lastError = null;
  state.lastRunAt = null;
  state.recentMismatches = [];
}

function fingerprint(aggregate: CustomerProtocolAggregate): string {
  return JSON.stringify(aggregate);
}

function diffAggregates(
  prev: CustomerProtocolAggregate[],
  next: CustomerProtocolAggregate[],
): CustomerProtocolWriteDiff {
  const prevById = new Map(prev.map((a) => [a.protocol.id, a]));
  const nextById = new Map(next.map((a) => [a.protocol.id, a]));
  const created: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];

  for (const a of next) {
    const before = prevById.get(a.protocol.id);
    if (!before) created.push(a.protocol.id);
    else if (fingerprint(before) !== fingerprint(a)) updated.push(a.protocol.id);
  }
  for (const a of prev) {
    if (!nextById.has(a.protocol.id)) removed.push(a.protocol.id);
  }
  return { created, updated, removed };
}

function recordMismatch(m: CustomerProtocolWriteMismatch): void {
  state.mismatches += 1;
  state.recentMismatches.unshift(m);
  if (state.recentMismatches.length > MAX_RECENT_MISMATCHES) {
    state.recentMismatches.length = MAX_RECENT_MISMATCHES;
  }
}

async function validateMirroredRows(
  rows: CustomerProtocolUpsertRow[],
  sourceById: Map<string, CustomerProtocolAggregate>,
): Promise<CustomerProtocolWriteMismatch[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const stop = perf.start("customerProtocol.write.validation");
  const found: CustomerProtocolWriteMismatch[] = [];
  const at = new Date().toISOString();
  try {
    for (const row of rows) {
      const local = sourceById.get(row.legacy_id);
      if (!local) continue;
      const { data, error } = await supabase
        .from("customer_protocols")
        .select("legacy_id, company_legacy_id, name")
        .eq("legacy_id", row.legacy_id)
        .maybeSingle();
      state.validations += 1;
      if (error || !data) {
        const m: CustomerProtocolWriteMismatch = {
          id: row.legacy_id,
          field: "missing",
          local: local.protocol.id,
          supabase: error ? `error: ${error.message}` : "no row",
          at,
        };
        found.push(m);
        recordMismatch(m);
        continue;
      }
      const r = data as unknown as {
        legacy_id: string;
        company_legacy_id: string;
        name: string;
      };
      const checks: Array<[CustomerProtocolWriteField, string, string]> = [
        ["legacy_id", local.protocol.id, r.legacy_id],
        ["company_legacy_id", local.protocol.companyId, r.company_legacy_id],
        ["name", local.protocol.name, r.name],
      ];
      for (const [field, localVal, supaVal] of checks) {
        if (localVal !== supaVal) {
          const m: CustomerProtocolWriteMismatch = {
            id: row.legacy_id,
            field,
            local: localVal,
            supabase: supaVal,
            at,
          };
          found.push(m);
          recordMismatch(m);
        }
      }
    }
    return found;
  } finally {
    stop();
  }
}

/** Mirrors a customer-protocol write (prev → next aggregates) into Supabase. */
export async function mirrorCustomerProtocolWrites(
  prev: CustomerProtocolAggregate[],
  next: CustomerProtocolAggregate[],
): Promise<CustomerProtocolDualWriteResult> {
  const stopDual = perf.start("customerProtocol.write.dual");
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  state.runs += 1;
  state.lastRunAt = new Date().toISOString();

  const diff = diffAggregates(prev, next);

  const result: CustomerProtocolDualWriteResult = {
    ok: false,
    noop: false,
    diff,
    mirrored: 0,
    removed: 0,
    skipped: [],
    mismatches: [],
    error: null,
    durationMs: 0,
  };

  const finish = (): CustomerProtocolDualWriteResult => {
    stopDual();
    result.durationMs =
      (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt;
    return result;
  };

  const changedIds = [...diff.created, ...diff.updated];
  if (changedIds.length === 0 && diff.removed.length === 0) {
    state.noops += 1;
    result.ok = true;
    result.noop = true;
    return finish();
  }

  if (!isSupabaseConfigured || !supabase) {
    state.failures += 1;
    state.lastError = "Supabase is not configured.";
    result.error = "Supabase is not configured.";
    return finish();
  }

  const nextById = new Map(next.map((a) => [a.protocol.id, a]));
  const stopWrite = perf.start("customerProtocol.write.supabase");
  try {
    const companyMap = await loadCompanyUuidMap();
    const rows: CustomerProtocolUpsertRow[] = [];
    const sourceById = new Map<string, CustomerProtocolAggregate>();
    for (const id of changedIds) {
      const aggregate = nextById.get(id);
      if (!aggregate) continue;
      const uuid = companyMap.get(aggregate.protocol.companyId) ?? null;
      if (!uuid) {
        result.skipped.push({
          id,
          reason: `No Supabase company for legacy_id "${aggregate.protocol.companyId}". Migrate companies first.`,
        });
        state.skipped += 1;
        continue;
      }
      rows.push(toCustomerProtocolUpsertRow(aggregate, uuid));
      sourceById.set(id, aggregate);
    }

    if (rows.length > 0) {
      const { error } = await supabase
        .from("customer_protocols")
        .upsert(rows, { onConflict: "legacy_id" });
      if (error) {
        state.failures += 1;
        state.lastError = error.message;
        result.error = `Supabase upsert failed: ${error.message}`;
        return finish();
      }
      result.mirrored = rows.length;
      const createdSet = new Set(diff.created);
      for (const row of rows) {
        if (createdSet.has(row.legacy_id)) state.created += 1;
        else state.updated += 1;
      }
    }

    if (diff.removed.length > 0) {
      const { error } = await supabase
        .from("customer_protocols")
        .update({ deleted_at: new Date().toISOString() })
        .in("legacy_id", diff.removed);
      if (error) {
        state.failures += 1;
        state.lastError = error.message;
        result.error = `Supabase soft-delete failed: ${error.message}`;
        return finish();
      }
      result.removed = diff.removed.length;
      state.removed += diff.removed.length;
    }

    stopWrite();

    result.mismatches = await validateMirroredRows(rows, sourceById);
    result.ok =
      result.error === null &&
      result.skipped.length === 0 &&
      result.mismatches.length === 0;
    return finish();
  } catch (err) {
    stopWrite();
    state.failures += 1;
    state.lastError = err instanceof Error ? err.message : "Unknown mirror error.";
    result.error = state.lastError;
    return finish();
  }
}

if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    mirrorCustomerProtocolWrites,
    getCustomerProtocolDualWriteState,
    resetCustomerProtocolDualWriteState,
  };
}
