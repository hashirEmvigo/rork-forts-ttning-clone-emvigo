/**
 * Supabase-backed Protocol Run repository boundary (Phase 2C-A1).
 *
 * Foundation only: this module is not wired into the execution UI yet and does
 * not read from or migrate browser storage. Empty Supabase reads are valid and
 * return [] / null with no local fallback, seed, or demo data.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import {
  sortProtocolRunItems,
  sortProtocolRunSections,
  type ProtocolRunItem,
  type ProtocolRunItemStatus,
  type ProtocolRunSection,
  type ProtocolRunStatus,
  type ProtocolRunV2,
} from "@/types";
import type { DetailParams } from "./types";

const PROTOCOL_RUN_COLUMNS =
  "legacy_id, company_id, company_legacy_id, customer_legacy_id, " +
  "work_order_legacy_id, visit_occurrence_legacy_id, " +
  "source_customer_protocol_legacy_id, status, generated_at, completed_at, " +
  "data, deleted_at, created_at, updated_at";

/** Complete persisted protocol-run aggregate stored in `protocol_runs.data`. */
export interface ProtocolRunAggregate {
  run: ProtocolRunV2;
  sections: ProtocolRunSection[];
  items: ProtocolRunItem[];
}

/** Row inserted/updated in the `protocol_runs` table. */
export interface ProtocolRunUpsertRow {
  legacy_id: string;
  company_id: string;
  company_legacy_id: string;
  customer_legacy_id: string | null;
  work_order_legacy_id: string | null;
  visit_occurrence_legacy_id: string | null;
  source_customer_protocol_legacy_id: string | null;
  status: ProtocolRunStatus;
  generated_at: string;
  completed_at: string | null;
  data: ProtocolRunAggregate;
  deleted_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

interface ProtocolRunRow extends ProtocolRunUpsertRow {
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateProtocolRunAggregateParams {
  /** Real Supabase companies.id UUID. Required for RLS-safe inserts. */
  companyUuid: string;
}

export interface UpdateRunStatusParams extends DetailParams {
  now?: string;
}

export interface UpdateItemStatusOptions extends DetailParams {
  completedBy?: string;
  skipReason?: string;
  now?: string;
}

class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "SupabaseProtocolRunRepository requires Supabase. Set " +
        "EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.",
    );
    this.name = "SupabaseNotConfiguredError";
  }
}

function requireClient() {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  return supabase;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeAggregate(aggregate: ProtocolRunAggregate): ProtocolRunAggregate {
  return {
    run: aggregate.run,
    sections: sortProtocolRunSections(aggregate.sections),
    items: sortProtocolRunItems(aggregate.items),
  };
}

/** Maps a complete protocol-run aggregate to the flat Supabase row shape. */
export function toProtocolRunUpsertRow(
  aggregate: ProtocolRunAggregate,
  companyUuid: string,
): ProtocolRunUpsertRow {
  const normalized = normalizeAggregate(aggregate);
  const { run } = normalized;
  return {
    legacy_id: run.id,
    company_id: companyUuid,
    company_legacy_id: run.companyId,
    customer_legacy_id: run.customerId ?? null,
    work_order_legacy_id: run.workOrderId ?? null,
    visit_occurrence_legacy_id: run.visitOccurrenceId ?? null,
    source_customer_protocol_legacy_id: run.sourceCustomerProtocolId ?? null,
    status: run.status,
    generated_at: run.generatedAt,
    completed_at: run.completedAt ?? null,
    data: normalized,
    deleted_at: null,
    created_at: run.createdAt,
    updated_at: run.updatedAt,
  };
}

function rowToAggregate(row: ProtocolRunRow): ProtocolRunAggregate | null {
  if (!row.data?.run) return null;
  return normalizeAggregate(row.data);
}

function isVisibleRow(row: ProtocolRunRow | null, params: DetailParams = {}): row is ProtocolRunRow {
  if (!row || row.deleted_at) return false;
  if (params.companyId !== undefined && params.companyId !== null) {
    return row.company_legacy_id === params.companyId;
  }
  return true;
}

function withRunStatus(
  aggregate: ProtocolRunAggregate,
  status: ProtocolRunStatus,
  now: string,
): ProtocolRunAggregate {
  return normalizeAggregate({
    ...aggregate,
    run: {
      ...aggregate.run,
      status,
      completedAt: status === "completed" ? (aggregate.run.completedAt ?? now) : undefined,
      updatedAt: now,
    },
  });
}

function withItemStatus(
  aggregate: ProtocolRunAggregate,
  itemId: string,
  status: ProtocolRunItemStatus,
  options: UpdateItemStatusOptions,
  now: string,
): ProtocolRunAggregate | null {
  let found = false;
  const items = aggregate.items.map((item) => {
    if (item.id !== itemId || item.runId !== aggregate.run.id) return item;
    found = true;
    return {
      ...item,
      status,
      completedAt: status === "done" ? now : undefined,
      completedBy: status === "done" ? options.completedBy : undefined,
      skipReason: status === "skipped" ? options.skipReason : undefined,
    } satisfies ProtocolRunItem;
  });
  if (!found) return null;
  return normalizeAggregate({
    ...aggregate,
    run: { ...aggregate.run, updatedAt: now },
    items,
  });
}

async function updateAggregateRow(
  legacyId: string,
  aggregate: ProtocolRunAggregate,
  params: DetailParams,
): Promise<ProtocolRunAggregate | null> {
  const client = requireClient();
  const row = toProtocolRunUpsertRow(aggregate, "00000000-0000-0000-0000-000000000000");
  let query = client
    .from("protocol_runs")
    .update({
      status: row.status,
      completed_at: row.completed_at,
      data: row.data,
      updated_at: aggregate.run.updatedAt,
    })
    .eq("legacy_id", legacyId)
    .is("deleted_at", null);
  if (params.companyId !== undefined && params.companyId !== null) {
    query = query.eq("company_legacy_id", params.companyId);
  }
  const { data, error } = await query.select(PROTOCOL_RUN_COLUMNS).maybeSingle();
  if (error) throw new Error(`[protocolRuns] Supabase update failed: ${error.message}`);
  const updated = (data ?? null) as unknown as ProtocolRunRow | null;
  return updated ? rowToAggregate(updated) : null;
}

/** Supabase source-of-truth boundary for protocol run aggregates. */
export const supabaseProtocolRunRepository = {
  /** Lists non-deleted protocol runs for one company. Empty Supabase returns []. */
  async listByCompany(companyId: string): Promise<ProtocolRunAggregate[]> {
    const client = requireClient();
    const stop = perf.start("protocolRuns.list.supabase");
    try {
      const { data, error } = await client
        .from("protocol_runs")
        .select(PROTOCOL_RUN_COLUMNS)
        .eq("company_legacy_id", companyId)
        .is("deleted_at", null)
        .order("generated_at", { ascending: false })
        .order("legacy_id", { ascending: false });
      if (error) throw new Error(`[protocolRuns] Supabase list failed: ${error.message}`);
      const rows = (data ?? []) as unknown as ProtocolRunRow[];
      return rows
        .map(rowToAggregate)
        .filter((aggregate): aggregate is ProtocolRunAggregate => Boolean(aggregate));
    } finally {
      stop();
    }
  },

  /** Looks up one non-deleted run by legacy id, optionally company scoped. */
  async getByLegacyId(
    legacyId: string,
    params: DetailParams = {},
  ): Promise<ProtocolRunAggregate | null> {
    const client = requireClient();
    const { data, error } = await client
      .from("protocol_runs")
      .select(PROTOCOL_RUN_COLUMNS)
      .eq("legacy_id", legacyId)
      .maybeSingle();
    if (error) throw new Error(`[protocolRuns] Supabase get failed: ${error.message}`);
    const row = (data ?? null) as unknown as ProtocolRunRow | null;
    if (!isVisibleRow(row, params)) return null;
    return rowToAggregate(row);
  },

  /** Inserts a new protocol run aggregate. No upsert, no local fallback. */
  async createRunAggregate(
    aggregate: ProtocolRunAggregate,
    params: CreateProtocolRunAggregateParams,
  ): Promise<ProtocolRunAggregate> {
    const client = requireClient();
    const row = toProtocolRunUpsertRow(aggregate, params.companyUuid);
    const { data, error } = await client
      .from("protocol_runs")
      .insert(row)
      .select(PROTOCOL_RUN_COLUMNS)
      .maybeSingle();
    if (error) throw new Error(`[protocolRuns] Supabase create failed: ${error.message}`);
    const created = rowToAggregate(data as unknown as ProtocolRunRow);
    if (!created) throw new Error("[protocolRuns] Supabase create returned an invalid row");
    return created;
  },

  /** Updates only the aggregate lifecycle status and completed timestamp. */
  async updateRunAggregateStatus(
    legacyId: string,
    status: ProtocolRunStatus,
    params: UpdateRunStatusParams = {},
  ): Promise<ProtocolRunAggregate | null> {
    const current = await this.getByLegacyId(legacyId, params);
    if (!current) return null;
    const next = withRunStatus(current, status, params.now ?? nowIso());
    return updateAggregateRow(legacyId, next, params);
  },

  /** Updates one item inside the aggregate JSON payload. */
  async updateItemStatusInsideAggregate(
    legacyId: string,
    itemId: string,
    status: ProtocolRunItemStatus,
    options: UpdateItemStatusOptions = {},
  ): Promise<ProtocolRunAggregate | null> {
    const current = await this.getByLegacyId(legacyId, options);
    if (!current) return null;
    const next = withItemStatus(current, itemId, status, options, options.now ?? nowIso());
    if (!next) return null;
    return updateAggregateRow(legacyId, next, options);
  },

  /** Archives a run by setting deleted_at. There is no hard-delete path. */
  async softDeleteRun(legacyId: string, params: UpdateRunStatusParams = {}): Promise<boolean> {
    const client = requireClient();
    let query = client
      .from("protocol_runs")
      .update({ deleted_at: params.now ?? nowIso() })
      .eq("legacy_id", legacyId)
      .is("deleted_at", null);
    if (params.companyId !== undefined && params.companyId !== null) {
      query = query.eq("company_legacy_id", params.companyId);
    }
    const { data, error } = await query.select("legacy_id").maybeSingle();
    if (error) throw new Error(`[protocolRuns] Supabase archive failed: ${error.message}`);
    return Boolean(data);
  },
};
