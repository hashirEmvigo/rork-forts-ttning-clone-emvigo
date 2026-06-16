/**
 * Supabase-backed Customer Protocol repository boundary (Phase 2C-A3.1).
 *
 * This module talks only to the `customer_protocols` table. It never reads from
 * browser storage, never migrates/rescues local data, and treats empty Supabase
 * reads as authoritative [] / null results.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import {
  sortCustomerProtocolItems,
  sortCustomerProtocolSections,
  type CustomerProtocolV2,
  type CustomerProtocolSection,
  type CustomerProtocolItem,
} from "@/types";
import type { DetailParams } from "./types";

const CUSTOMER_PROTOCOL_COLUMNS =
  "legacy_id, company_id, company_legacy_id, customer_legacy_id, name, " +
  "is_archived, data, deleted_at, created_at, updated_at";

/** The lossless aggregate persisted in `customer_protocols.data`. */
export interface CustomerProtocolAggregate {
  protocol: CustomerProtocolV2;
  sections: CustomerProtocolSection[];
  items: CustomerProtocolItem[];
}

/** Row inserted/updated in the `customer_protocols` table. */
export interface CustomerProtocolUpsertRow {
  legacy_id: string;
  company_id: string;
  company_legacy_id: string;
  customer_legacy_id: string;
  name: string;
  is_archived: boolean;
  data: CustomerProtocolAggregate;
  deleted_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

/** Lightweight protocol row for count / id-set parity checks. */
export interface CustomerProtocolSummary {
  id: string;
  companyId: string;
  customerId: string;
  name: string;
}

interface CustomerProtocolSummaryRow {
  legacy_id: string;
  company_legacy_id: string;
  customer_legacy_id: string;
  name: string;
  is_archived: boolean;
  deleted_at: string | null;
}

interface CustomerProtocolRow extends CustomerProtocolUpsertRow {
  company_id: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CustomerProtocolListOptions {
  includeArchived?: boolean;
}

export interface CustomerProtocolDetailParams extends DetailParams, CustomerProtocolListOptions {
  customerId?: string | null;
}

export interface CreateCustomerProtocolAggregateParams {
  /** Real Supabase companies.id UUID. Required for RLS-safe inserts. */
  companyUuid: string;
}

export interface CustomerProtocolMutationParams extends CustomerProtocolDetailParams {
  now?: string;
}

export type CustomerProtocolMetadataPatch = Partial<
  Pick<
    CustomerProtocolV2,
    | "name"
    | "description"
    | "categoryIds"
    | "floorPresetIds"
    | "sourceTemplateId"
    | "sourceTemplateName"
    | "sourceTemplateVersion"
    | "schemaVersion"
  >
>;

class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "SupabaseCustomerProtocolRepository requires Supabase. Set " +
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

function normalizeAggregate(aggregate: CustomerProtocolAggregate): CustomerProtocolAggregate {
  return {
    protocol: aggregate.protocol,
    sections: sortCustomerProtocolSections(aggregate.sections),
    items: sortCustomerProtocolItems(aggregate.items),
  };
}

function rowToSummary(row: CustomerProtocolSummaryRow): CustomerProtocolSummary {
  return {
    id: row.legacy_id,
    companyId: row.company_legacy_id,
    customerId: row.customer_legacy_id,
    name: row.name,
  };
}

/** Maps a complete customer-protocol aggregate to the flat Supabase row shape. */
export function toCustomerProtocolUpsertRow(
  aggregate: CustomerProtocolAggregate,
  companyUuid: string,
): CustomerProtocolUpsertRow {
  const normalized = normalizeAggregate(aggregate);
  const { protocol } = normalized;
  return {
    legacy_id: protocol.id,
    company_id: companyUuid,
    company_legacy_id: protocol.companyId,
    customer_legacy_id: protocol.customerId,
    name: protocol.name,
    is_archived: protocol.isArchived,
    data: normalized,
    deleted_at: null,
    created_at: protocol.createdAt,
    updated_at: protocol.updatedAt,
  };
}

function rowToAggregate(row: CustomerProtocolRow): CustomerProtocolAggregate | null {
  if (!row.data?.protocol) return null;
  return normalizeAggregate(row.data);
}

function isVisibleRow(
  row: CustomerProtocolRow | null,
  params: CustomerProtocolDetailParams = {},
): row is CustomerProtocolRow {
  if (!row || row.deleted_at) return false;
  if (params.includeArchived === false && row.is_archived) return false;
  if (params.companyId !== undefined && params.companyId !== null) {
    if (row.company_legacy_id !== params.companyId) return false;
  }
  if (params.customerId !== undefined && params.customerId !== null) {
    if (row.customer_legacy_id !== params.customerId) return false;
  }
  return true;
}

function withTimestamp(
  aggregate: CustomerProtocolAggregate,
  now: string,
): CustomerProtocolAggregate {
  return normalizeAggregate({
    ...aggregate,
    protocol: { ...aggregate.protocol, updatedAt: now },
  });
}

function withArchiveState(
  aggregate: CustomerProtocolAggregate,
  isArchived: boolean,
  now: string,
): CustomerProtocolAggregate {
  return normalizeAggregate({
    ...aggregate,
    protocol: { ...aggregate.protocol, isArchived, updatedAt: now },
  });
}

async function updateAggregateRow(
  legacyId: string,
  aggregate: CustomerProtocolAggregate,
  params: CustomerProtocolMutationParams = {},
): Promise<CustomerProtocolAggregate | null> {
  const client = requireClient();
  const { protocol } = aggregate;
  let query = client
    .from("customer_protocols")
    .update({
      company_legacy_id: protocol.companyId,
      customer_legacy_id: protocol.customerId,
      name: protocol.name,
      is_archived: protocol.isArchived,
      data: normalizeAggregate(aggregate),
      updated_at: protocol.updatedAt,
    })
    .eq("legacy_id", legacyId)
    .is("deleted_at", null);
  if (params.companyId !== undefined && params.companyId !== null) {
    query = query.eq("company_legacy_id", params.companyId);
  }
  if (params.customerId !== undefined && params.customerId !== null) {
    query = query.eq("customer_legacy_id", params.customerId);
  }
  const { data, error } = await query.select(CUSTOMER_PROTOCOL_COLUMNS).maybeSingle();
  if (error) throw new Error(`[customerProtocols] Supabase update failed: ${error.message}`);
  const updated = (data ?? null) as unknown as CustomerProtocolRow | null;
  return updated ? rowToAggregate(updated) : null;
}

/** Supabase source-of-truth boundary for customer protocol aggregates. */
export const supabaseCustomerProtocolRepository = {
  /** Lists non-deleted protocols for one company. Empty Supabase returns []. */
  async listByCompany(
    companyId: string,
    options: CustomerProtocolListOptions = {},
  ): Promise<CustomerProtocolAggregate[]> {
    const client = requireClient();
    const stop = perf.start("customerProtocols.list.supabase.repository.company");
    try {
      let query = client
        .from("customer_protocols")
        .select(CUSTOMER_PROTOCOL_COLUMNS)
        .eq("company_legacy_id", companyId)
        .is("deleted_at", null);
      if (options.includeArchived === false) query = query.eq("is_archived", false);
      const { data, error } = await query;
      if (error) throw new Error(`[customerProtocols] Supabase list failed: ${error.message}`);
      const rows = (data ?? []) as unknown as CustomerProtocolRow[];
      return rows
        .map(rowToAggregate)
        .filter((aggregate): aggregate is CustomerProtocolAggregate => Boolean(aggregate));
    } finally {
      stop();
    }
  },

  /** Lists non-deleted protocols for one customer within one company. */
  async listByCustomer(
    companyId: string,
    customerId: string,
    options: CustomerProtocolListOptions = {},
  ): Promise<CustomerProtocolAggregate[]> {
    const client = requireClient();
    let query = client
      .from("customer_protocols")
      .select(CUSTOMER_PROTOCOL_COLUMNS)
      .eq("company_legacy_id", companyId)
      .eq("customer_legacy_id", customerId)
      .is("deleted_at", null);
    if (options.includeArchived === false) query = query.eq("is_archived", false);
    const { data, error } = await query;
    if (error) throw new Error(`[customerProtocols] Supabase customer list failed: ${error.message}`);
    const rows = (data ?? []) as unknown as CustomerProtocolRow[];
    return rows
      .map(rowToAggregate)
      .filter((aggregate): aggregate is CustomerProtocolAggregate => Boolean(aggregate));
  },

  /** Looks up one non-deleted protocol by legacy id, optionally scoped. */
  async getByLegacyId(
    legacyId: string,
    params: CustomerProtocolDetailParams = {},
  ): Promise<CustomerProtocolAggregate | null> {
    const client = requireClient();
    const { data, error } = await client
      .from("customer_protocols")
      .select(CUSTOMER_PROTOCOL_COLUMNS)
      .eq("legacy_id", legacyId)
      .maybeSingle();
    if (error) throw new Error(`[customerProtocols] Supabase get failed: ${error.message}`);
    const row = (data ?? null) as unknown as CustomerProtocolRow | null;
    if (!isVisibleRow(row, params)) return null;
    return rowToAggregate(row);
  },

  /** Inserts a new customer-protocol aggregate. No upsert, no local fallback. */
  async createAggregate(
    aggregate: CustomerProtocolAggregate,
    params: CreateCustomerProtocolAggregateParams,
  ): Promise<CustomerProtocolAggregate> {
    const client = requireClient();
    const row = toCustomerProtocolUpsertRow(aggregate, params.companyUuid);
    const { data, error } = await client
      .from("customer_protocols")
      .insert(row)
      .select(CUSTOMER_PROTOCOL_COLUMNS)
      .maybeSingle();
    if (error) throw new Error(`[customerProtocols] Supabase create failed: ${error.message}`);
    const created = rowToAggregate(data as unknown as CustomerProtocolRow);
    if (!created) throw new Error("[customerProtocols] Supabase create returned an invalid row");
    return created;
  },

  /** Replaces the persisted aggregate for an existing protocol row. */
  async updateAggregate(
    aggregate: CustomerProtocolAggregate,
    params: CustomerProtocolMutationParams = {},
  ): Promise<CustomerProtocolAggregate | null> {
    return updateAggregateRow(aggregate.protocol.id, normalizeAggregate(aggregate), params);
  },

  /** Updates top-level protocol metadata inside both flat columns and JSON data. */
  async updateMetadata(
    legacyId: string,
    patch: CustomerProtocolMetadataPatch,
    params: CustomerProtocolMutationParams = {},
  ): Promise<CustomerProtocolAggregate | null> {
    const current = await this.getByLegacyId(legacyId, params);
    if (!current) return null;
    const now = params.now ?? nowIso();
    const next = normalizeAggregate({
      ...current,
      protocol: { ...current.protocol, ...patch, updatedAt: now },
    });
    return updateAggregateRow(legacyId, next, params);
  },

  /** Replaces section/item JSON aggregate content without touching browser storage. */
  async updateSectionsAndItems(
    legacyId: string,
    sections: CustomerProtocolSection[],
    items: CustomerProtocolItem[],
    params: CustomerProtocolMutationParams = {},
  ): Promise<CustomerProtocolAggregate | null> {
    const current = await this.getByLegacyId(legacyId, params);
    if (!current) return null;
    const next = withTimestamp({ ...current, sections, items }, params.now ?? nowIso());
    return updateAggregateRow(legacyId, next, params);
  },

  /** Archives a protocol by setting its domain archive flag. No hard delete. */
  async archive(
    legacyId: string,
    params: CustomerProtocolMutationParams = {},
  ): Promise<CustomerProtocolAggregate | null> {
    const current = await this.getByLegacyId(legacyId, { ...params, includeArchived: true });
    if (!current) return null;
    return updateAggregateRow(
      legacyId,
      withArchiveState(current, true, params.now ?? nowIso()),
      params,
    );
  },

  /** Restores a domain-archived protocol. */
  async restore(
    legacyId: string,
    params: CustomerProtocolMutationParams = {},
  ): Promise<CustomerProtocolAggregate | null> {
    const current = await this.getByLegacyId(legacyId, { ...params, includeArchived: true });
    if (!current) return null;
    return updateAggregateRow(
      legacyId,
      withArchiveState(current, false, params.now ?? nowIso()),
      params,
    );
  },

  /** Soft-deletes a protocol row by setting deleted_at. There is no hard-delete path. */
  async softDelete(
    legacyId: string,
    params: CustomerProtocolMutationParams = {},
  ): Promise<boolean> {
    const client = requireClient();
    let query = client
      .from("customer_protocols")
      .update({ deleted_at: params.now ?? nowIso() })
      .eq("legacy_id", legacyId)
      .is("deleted_at", null);
    if (params.companyId !== undefined && params.companyId !== null) {
      query = query.eq("company_legacy_id", params.companyId);
    }
    if (params.customerId !== undefined && params.customerId !== null) {
      query = query.eq("customer_legacy_id", params.customerId);
    }
    const { data, error } = await query.select("legacy_id").maybeSingle();
    if (error) throw new Error(`[customerProtocols] Supabase soft-delete failed: ${error.message}`);
    return Boolean(data);
  },
};

/** Company-scoped summary rows. Soft-deleted rows filtered out. */
export async function listCustomerProtocolSummariesFromSupabase(
  companyId?: string | null,
): Promise<CustomerProtocolSummary[]> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("customerProtocols.list.supabase.summaries");
  try {
    let query = supabase.from("customer_protocols").select(
      "legacy_id, company_legacy_id, customer_legacy_id, name, is_archived, deleted_at",
    );
    if (companyId !== undefined && companyId !== null) {
      query = query.eq("company_legacy_id", companyId);
    }
    const { data, error } = await query;
    if (error) {
      throw new Error(`[customer_protocols] Supabase list failed: ${error.message}`);
    }
    const rows = (data ?? []) as unknown as CustomerProtocolSummaryRow[];
    return rows.filter((r) => !r.deleted_at).map(rowToSummary);
  } finally {
    stop();
  }
}

/** FULL protocol aggregates (lossless `data` jsonb) for a company scope. */
export async function listFullCustomerProtocolsFromSupabase(
  companyId?: string | null,
): Promise<CustomerProtocolAggregate[]> {
  if (companyId !== undefined && companyId !== null) {
    return supabaseCustomerProtocolRepository.listByCompany(companyId, { includeArchived: true });
  }
  const client = requireClient();
  const stop = perf.start("customerProtocols.list.supabase.full");
  perf.count("customerProtocols.list.supabase.full.calls");
  try {
    const { data, error } = await client
      .from("customer_protocols")
      .select(CUSTOMER_PROTOCOL_COLUMNS)
      .is("deleted_at", null);
    if (error) {
      throw new Error(`[customer_protocols] Supabase full list failed: ${error.message}`);
    }
    const rows = (data ?? []) as unknown as CustomerProtocolRow[];
    return rows
      .map(rowToAggregate)
      .filter((aggregate): aggregate is CustomerProtocolAggregate => Boolean(aggregate));
  } finally {
    stop();
  }
}
