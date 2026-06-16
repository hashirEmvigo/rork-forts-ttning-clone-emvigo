/**
 * Supabase-backed Service repository (SVC-1 + CORE-WRITES-A1).
 *
 * Reads and authoritative create/update writes for the `services` table created
 * in migration 0018. The table stores flat indexed columns plus the complete
 * legacy Service payload in `data` jsonb so UI shapes stay unchanged.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import { normalizeServiceBasisType } from "@/lib/serviceBasis";
import type { Service } from "@/types";
import { loadCompanyUuidMap } from "./customerMigration";

/** Columns selected for a lightweight summary list (no `data` jsonb). */
const SUMMARY_COLUMNS = "legacy_id, company_legacy_id, name, status, deleted_at";

/** Lightweight service row for count / id-set parity checks. */
export interface ServiceSummary {
  id: string;
  companyId: string | null;
  name: string;
}

/** Shape of the flat summary columns returned by Supabase. */
interface ServiceSummaryRow {
  legacy_id: string;
  company_legacy_id: string | null;
  name: string;
  status: string;
  deleted_at: string | null;
}

/** Shape of a full service row (the lossless `data` jsonb + scope/soft-delete). */
interface ServiceFullRow {
  data: Service;
  company_legacy_id: string | null;
  deleted_at: string | null;
}

interface ServiceUpsertRow {
  legacy_id: string;
  company_id: string | null;
  company_legacy_id: string | null;
  category_legacy_id: string | null;
  name: string;
  status: string;
  deleted_at: string | null;
  data: Service;
}

export interface SupabaseServiceCreateInput
  extends Omit<Service, "id" | "companyId" | "status" | "createdBy" | "createdAt" | "updatedAt"> {
  /** null = Super Admin global catalog row; string = company-owned row. */
  companyId: string | null;
  createdBy?: string | null;
}

export type SupabaseServiceUpdatePatch = Partial<
  Omit<Service, "id" | "companyId" | "createdBy" | "createdAt" | "updatedAt">
>;

/** Thrown when the repository is used but Supabase is not configured. */
class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "SupabaseServiceRepository requires Supabase. Set EXPO_PUBLIC_SUPABASE_URL " +
        "and EXPO_PUBLIC_SUPABASE_ANON_KEY.",
    );
    this.name = "SupabaseNotConfiguredError";
  }
}

function rowToSummary(row: ServiceSummaryRow): ServiceSummary {
  return { id: row.legacy_id, companyId: row.company_legacy_id, name: row.name };
}

function makeServiceId(): string {
  return `svc_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

function normalizeOptionalText(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeNullableRef(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

async function requireCompanyUuid(companyId: string | null): Promise<string | null> {
  if (companyId === null) return null;
  const normalizedCompanyId = companyId.trim();
  if (!normalizedCompanyId) throw new Error("Service save requires a company context.");
  const companyMap = await loadCompanyUuidMap();
  const uuid = companyMap.get(normalizedCompanyId) ?? null;
  if (!uuid) {
    throw new Error(`No Supabase company found for service company "${normalizedCompanyId}".`);
  }
  return uuid;
}

function serviceToUpsertRow(service: Service, companyUuid: string | null): ServiceUpsertRow {
  return {
    legacy_id: service.id,
    company_id: companyUuid,
    company_legacy_id: service.companyId,
    category_legacy_id: service.categoryId,
    name: service.name,
    status: service.status,
    deleted_at: null,
    data: service,
  };
}

async function upsertService(service: Service, companyUuid: string | null): Promise<Service> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const { error } = await supabase
    .from("services")
    .upsert([serviceToUpsertRow(service, companyUuid)], { onConflict: "legacy_id" });
  if (error) throw new Error(`[services] Supabase service write failed: ${error.message}`);
  return service;
}

/**
 * Applies the company scope to a `services` query, mirroring the current read
 * visibility: scope supplied → that company's rows OR global rows; scope omitted
 * → all RLS-visible rows (super admin).
 */
function applyScope<T extends { or: (f: string) => T }>(
  query: T,
  companyId: string | null | undefined,
): T {
  if (companyId === undefined || companyId === null) return query;
  return query.or(`company_legacy_id.eq.${companyId},company_legacy_id.is.null`);
}

/** Company-scoped (+ global) summary rows. Soft-deleted rows filtered out. */
export async function listServiceSummariesFromSupabase(
  companyId?: string | null,
): Promise<ServiceSummary[]> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("services.list.supabase.summaries");
  try {
    const query = applyScope(supabase.from("services").select(SUMMARY_COLUMNS), companyId);
    const { data, error } = await query;
    if (error) throw new Error(`[services] Supabase list failed: ${error.message}`);
    const rows = (data ?? []) as unknown as ServiceSummaryRow[];
    return rows.filter((r) => !r.deleted_at).map(rowToSummary);
  } finally {
    stop();
  }
}

/** FULL service records (lossless `data` jsonb) for a company scope (+ globals). */
export async function listFullServicesFromSupabase(
  companyId?: string | null,
): Promise<Service[]> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("services.list.supabase.full");
  perf.count("services.list.supabase.full.calls");
  try {
    const query = applyScope(
      supabase.from("services").select("data, company_legacy_id, deleted_at"),
      companyId,
    );
    const { data, error } = await query;
    if (error) throw new Error(`[services] Supabase full list failed: ${error.message}`);
    const rows = (data ?? []) as unknown as ServiceFullRow[];
    return rows
      .filter((r) => !r.deleted_at)
      .map((r) => r.data)
      .filter((s): s is Service => Boolean(s));
  } finally {
    stop();
  }
}

async function getServiceFromSupabaseForExactScope(
  serviceId: string,
  companyId: string | null,
): Promise<Service | null> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const { data, error } = await supabase
    .from("services")
    .select("data, company_legacy_id, deleted_at")
    .eq("legacy_id", serviceId)
    .maybeSingle();
  if (error) throw new Error(`[services] Supabase detail failed: ${error.message}`);
  if (!data) return null;
  const row = data as unknown as ServiceFullRow;
  if (row.deleted_at) return null;
  if ((row.company_legacy_id ?? null) !== companyId) return null;
  return row.data ?? null;
}

/** Creates one Supabase-authoritative service row and returns the saved record. */
export async function createServiceInSupabase(input: SupabaseServiceCreateInput): Promise<Service> {
  const name = input.name.trim();
  if (!name) throw new Error("Service name is required.");

  const companyId = input.companyId === null ? null : input.companyId.trim();
  const companyUuid = await requireCompanyUuid(companyId);
  const now = new Date().toISOString();
  const service: Service = {
    ...input,
    id: makeServiceId(),
    companyId,
    categoryId: normalizeNullableRef(input.categoryId),
    name,
    description: normalizeOptionalText(input.description),
    articleNumber: normalizeOptionalText(input.articleNumber),
    serviceType: normalizeOptionalText(input.serviceType),
    timeCodeId: normalizeNullableRef(input.timeCodeId),
    timeCode: normalizeOptionalText(input.timeCode),
    unit: normalizeOptionalText(input.unit),
    serviceBasisType: normalizeServiceBasisType(input.serviceBasisType),
    payrollGroupId: normalizeNullableRef(input.payrollGroupId),
    status: "active",
    createdBy: input.createdBy ?? null,
    createdAt: now,
    updatedAt: now,
  };

  return upsertService(service, companyUuid);
}

/** Updates one existing Supabase-authoritative service row and returns it. */
export async function updateServiceInSupabase(
  companyId: string | null,
  serviceId: string,
  patch: SupabaseServiceUpdatePatch,
): Promise<Service> {
  const normalizedServiceId = serviceId.trim();
  if (!normalizedServiceId) throw new Error("Service update requires a service id.");
  const normalizedCompanyId = companyId === null ? null : companyId.trim();
  const existing = await getServiceFromSupabaseForExactScope(normalizedServiceId, normalizedCompanyId);
  if (!existing) throw new Error("Service not found in Supabase for this scope.");
  const companyUuid = await requireCompanyUuid(normalizedCompanyId);

  const normalizedPatch: SupabaseServiceUpdatePatch = { ...patch };
  if ("name" in normalizedPatch && normalizedPatch.name !== undefined) {
    normalizedPatch.name = normalizedPatch.name.trim();
    if (!normalizedPatch.name) throw new Error("Service name is required.");
  }
  if ("description" in normalizedPatch) normalizedPatch.description = normalizeOptionalText(normalizedPatch.description);
  if ("articleNumber" in normalizedPatch) normalizedPatch.articleNumber = normalizeOptionalText(normalizedPatch.articleNumber);
  if ("serviceType" in normalizedPatch) normalizedPatch.serviceType = normalizeOptionalText(normalizedPatch.serviceType);
  if ("timeCodeId" in normalizedPatch) normalizedPatch.timeCodeId = normalizeNullableRef(normalizedPatch.timeCodeId);
  if ("timeCode" in normalizedPatch) normalizedPatch.timeCode = normalizeOptionalText(normalizedPatch.timeCode);
  if ("unit" in normalizedPatch) normalizedPatch.unit = normalizeOptionalText(normalizedPatch.unit);
  if ("serviceBasisType" in normalizedPatch && normalizedPatch.serviceBasisType !== undefined) {
    normalizedPatch.serviceBasisType = normalizeServiceBasisType(normalizedPatch.serviceBasisType);
  }
  if ("payrollGroupId" in normalizedPatch) normalizedPatch.payrollGroupId = normalizeNullableRef(normalizedPatch.payrollGroupId);

  const updated: Service = {
    ...existing,
    ...normalizedPatch,
    companyId: normalizedCompanyId,
    categoryId:
      patch.categoryId !== undefined ? normalizeNullableRef(patch.categoryId) : existing.categoryId,
    updatedAt: new Date().toISOString(),
  };
  return upsertService(updated, companyUuid);
}

/**
 * Permanently DELETEs a single GLOBAL catalog service row from Supabase (SVCCAT).
 *
 * This is the authoritative hard delete for the Super Admin master catalog. The
 * delete is pinned to GLOBAL templates only — the filter requires BOTH
 * `company_id is null` AND `company_legacy_id is null` — so even if a
 * company-owned service's id were passed it could never be reached. The
 * migration-0049 RLS policy independently enforces super-admin + global-only, so
 * this is defence in depth: company-owned copies are protected at the database
 * level regardless of the caller.
 *
 * Returns the number of rows actually removed. A result of 0 means the row was
 * not a global template, was already gone, or RLS blocked the delete — callers
 * MUST treat that as a failure and keep the service visible (no local-only or
 * mirror fallback). Performs no browser storage I/O.
 */
export async function hardDeleteGlobalServiceInSupabase(serviceId: string): Promise<number> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const normalizedServiceId = serviceId.trim();
  if (!normalizedServiceId) throw new Error("Service delete requires a service id.");
  const stop = perf.start("services.hardDelete.supabase");
  try {
    const { data, error } = await supabase
      .from("services")
      .delete()
      .eq("legacy_id", normalizedServiceId)
      .is("company_id", null)
      .is("company_legacy_id", null)
      .select("legacy_id");
    if (error) throw new Error(`[services] Supabase hard delete failed: ${error.message}`);
    return (data ?? []).length;
  } finally {
    stop();
  }
}
