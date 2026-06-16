/**
 * Customer Agreement repository + row mappers (Phase 1 foundation).
 *
 * The first server-side surface for the commercial-agreement foundation. It
 * mirrors the proven `customers` (0007) / `work_orders` (0008) conventions:
 *
 *   * flat, indexed columns for list / scope / versioning, plus a lossless
 *     `data jsonb` carrying the COMPLETE domain record for detail rebuild;
 *   * `legacy_id` (app-facing version id) + `company_legacy_id` query scope;
 *   * the same row-mapper shape used by both migration and (future) dual-write,
 *     so both paths write byte-identical rows.
 *
 * Phase 1 status — infrastructure only: nothing in the UI reads or writes
 * through these tables yet. localStorage remains the source of truth; Supabase
 * is the shadow copy the future migration/dual-write tooling populates. No
 * cut-over happens here.
 *
 * Out of scope (no fields/methods here): Time Bank, Invoice Basis, Agreement
 * Templates, Pricing Engine, RUT, Customer Portal, PayrollBasis.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import type { CustomerAgreement, CustomerAgreementLine } from "@/types";
import type { DetailParams, ListResult } from "./types";

// ── Upsert row shapes (migration + future dual-write share these) ──

/** A single upsert row written to the `customer_agreements` table. */
export interface CustomerAgreementUpsertRow {
  legacy_id: string;
  agreement_group_id: string;
  company_id: string | null;
  company_legacy_id: string;
  customer_legacy_id: string;
  version: number;
  status: string;
  billing_model: string;
  invoice_interval: string;
  source_type: string;
  source_reference_id: string | null;
  supersedes_version_id: string | null;
  superseded_by_id: string | null;
  valid_from: string | null;
  valid_to: string | null;
  data: CustomerAgreement;
}

/** A single upsert row written to the `customer_agreement_lines` table. */
export interface CustomerAgreementLineUpsertRow {
  legacy_id: string;
  agreement_legacy_id: string;
  agreement_group_id: string;
  company_id: string | null;
  company_legacy_id: string;
  sort_order: number;
  billing_model_override: string | null;
  pricing_model: string;
  agreed_price: number | null;
  quantity: number | null;
  unit: string | null;
  vat: number | null;
  source_service_id: string | null;
  service_name_snapshot: string;
  category_name_snapshot: string | null;
  category_type_snapshot: string | null;
  service_basis_type_snapshot: string | null;
  data: CustomerAgreementLine;
}

/**
 * Maps a domain {@link CustomerAgreement} to a `customer_agreements` upsert row.
 * Flat columns mirror the indexed/queryable fields; the full record is kept
 * losslessly in `data`.
 */
export function toCustomerAgreementUpsertRow(
  agreement: CustomerAgreement,
  companyUuid: string | null,
): CustomerAgreementUpsertRow {
  return {
    legacy_id: agreement.id,
    agreement_group_id: agreement.agreementGroupId,
    company_id: companyUuid,
    company_legacy_id: agreement.companyId,
    customer_legacy_id: agreement.customerId,
    version: agreement.version,
    status: agreement.status,
    billing_model: agreement.billingModel,
    invoice_interval: agreement.invoiceInterval,
    source_type: agreement.sourceType,
    source_reference_id: agreement.sourceReferenceId ?? null,
    supersedes_version_id: agreement.supersedesVersionId ?? null,
    superseded_by_id: agreement.supersededById ?? null,
    valid_from: agreement.validFrom ?? null,
    valid_to: agreement.validTo ?? null,
    data: agreement,
  };
}

/**
 * Maps a domain {@link CustomerAgreementLine} to a `customer_agreement_lines`
 * upsert row. `companyLegacyId` is supplied by the parent agreement (lines do
 * not carry it on the flat column otherwise).
 */
export function toCustomerAgreementLineUpsertRow(
  line: CustomerAgreementLine,
  companyUuid: string | null,
): CustomerAgreementLineUpsertRow {
  return {
    legacy_id: line.id,
    agreement_legacy_id: line.agreementId,
    agreement_group_id: line.agreementGroupId,
    company_id: companyUuid,
    company_legacy_id: line.companyId,
    sort_order: line.sortOrder,
    billing_model_override: line.billingModelOverride ?? null,
    pricing_model: line.pricingModel,
    agreed_price: line.agreedPrice ?? null,
    quantity: line.quantity ?? null,
    unit: line.unit ?? null,
    vat: line.vat ?? null,
    source_service_id: line.sourceServiceId ?? null,
    service_name_snapshot: line.serviceNameSnapshot,
    category_name_snapshot: line.categoryNameSnapshot ?? null,
    category_type_snapshot: line.categoryTypeSnapshot ?? null,
    service_basis_type_snapshot: line.serviceBasisTypeSnapshot ?? null,
    data: line,
  };
}

// ── Read DTOs + repository ────────────────────────────────

/** Lightweight agreement row for list surfaces (no `data` jsonb, no lines). */
export interface CustomerAgreementSummary {
  id: string;
  agreementGroupId: string;
  companyId: string;
  customerId: string;
  version: number;
  status: CustomerAgreement["status"];
  billingModel: CustomerAgreement["billingModel"];
  invoiceInterval: CustomerAgreement["invoiceInterval"];
  validFrom?: string;
  validTo?: string | null;
}

/** Params for listing agreements — scope by company and optionally customer. */
export interface CustomerAgreementListParams {
  /** App-facing company id scope. Omit for all RLS-visible companies. */
  companyId?: string | null;
  /** Restrict to a single customer's agreements. */
  customerId?: string;
  /** Restrict to a set of statuses (e.g. live board vs history). */
  statuses?: CustomerAgreement["status"][];
}

const SUMMARY_COLUMNS =
  "legacy_id, agreement_group_id, company_legacy_id, customer_legacy_id, version, status, billing_model, invoice_interval, valid_from, valid_to";

interface CustomerAgreementSummaryRow {
  legacy_id: string;
  agreement_group_id: string;
  company_legacy_id: string;
  customer_legacy_id: string;
  version: number;
  status: string;
  billing_model: string;
  invoice_interval: string;
  valid_from: string | null;
  valid_to: string | null;
}

interface CustomerAgreementDetailRow {
  data: CustomerAgreement;
  company_legacy_id: string;
}

interface CustomerAgreementLineDetailRow {
  data: CustomerAgreementLine;
}

class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "customerAgreementRepository requires Supabase. Set EXPO_PUBLIC_SUPABASE_URL " +
        "and EXPO_PUBLIC_SUPABASE_ANON_KEY.",
    );
    this.name = "SupabaseNotConfiguredError";
  }
}

function rowToSummary(row: CustomerAgreementSummaryRow): CustomerAgreementSummary {
  return {
    id: row.legacy_id,
    agreementGroupId: row.agreement_group_id,
    companyId: row.company_legacy_id,
    customerId: row.customer_legacy_id,
    version: row.version,
    status: row.status as CustomerAgreement["status"],
    billingModel: row.billing_model as CustomerAgreement["billingModel"],
    invoiceInterval: row.invoice_interval as CustomerAgreement["invoiceInterval"],
    validFrom: row.valid_from ?? undefined,
    validTo: row.valid_to ?? undefined,
  };
}

/**
 * Upsert chunk size — bounds payload size for large version chains, matching
 * the migration bridge's chunking.
 */
const WRITE_CHUNK = 200;

/**
 * Server (Supabase) read + version-persistence surface for Customer Agreements.
 * List + version-chain + detail (with lines) reads, plus the foundation write
 * path used by the Agreement Versioning persistence layer ({@link upsertVersions}
 * / {@link upsertLines}). The write path is foundation only — it is NOT wired to
 * any UI and performs no activation or production-authoritative flip.
 */
export const supabaseCustomerAgreementRepository = {
  /** Company-scoped agreement summaries, optionally filtered by customer/status. */
  async listSummaries(
    params: CustomerAgreementListParams = {},
  ): Promise<ListResult<CustomerAgreementSummary>> {
    if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
    const stop = perf.start("customerAgreements.list.supabase.summaries");
    try {
      let query = supabase.from("customer_agreements").select(SUMMARY_COLUMNS);
      if (params.companyId !== undefined && params.companyId !== null) {
        query = query.eq("company_legacy_id", params.companyId);
      }
      if (params.customerId) {
        query = query.eq("customer_legacy_id", params.customerId);
      }
      if (params.statuses && params.statuses.length > 0) {
        query = query.in("status", params.statuses);
      }
      const { data, error } = await query;
      if (error) {
        throw new Error(`[customer_agreements] Supabase list failed: ${error.message}`);
      }
      const rows = (data ?? []) as unknown as CustomerAgreementSummaryRow[];
      const items = rows.map(rowToSummary);
      return { items, total: items.length, page: 1, pageSize: items.length };
    } finally {
      stop();
    }
  },

  /** Full ordered version chain (oldest → newest) for one agreement group. */
  async listVersionChain(
    agreementGroupId: string,
    params: DetailParams = {},
  ): Promise<CustomerAgreement[]> {
    if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
    let query = supabase
      .from("customer_agreements")
      .select("data, company_legacy_id")
      .eq("agreement_group_id", agreementGroupId)
      .order("version", { ascending: true });
    if (params.companyId !== undefined && params.companyId !== null) {
      query = query.eq("company_legacy_id", params.companyId);
    }
    const { data, error } = await query;
    if (error) {
      throw new Error(`[customer_agreements] Supabase chain read failed: ${error.message}`);
    }
    const rows = (data ?? []) as unknown as CustomerAgreementDetailRow[];
    return rows.map((r) => r.data).filter((a): a is CustomerAgreement => Boolean(a));
  },

  /** A single agreement version by id, or null when missing / out of scope. */
  async getDetail(
    id: string,
    params: DetailParams = {},
  ): Promise<CustomerAgreement | null> {
    if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
    const { data, error } = await supabase
      .from("customer_agreements")
      .select("data, company_legacy_id")
      .eq("legacy_id", id)
      .maybeSingle();
    if (error) {
      throw new Error(`[customer_agreements] Supabase detail failed: ${error.message}`);
    }
    if (!data) return null;
    const row = data as unknown as CustomerAgreementDetailRow;
    if (params.companyId !== undefined && row.company_legacy_id !== params.companyId) {
      return null;
    }
    return row.data;
  },

  /**
   * Upserts agreement VERSION rows (parents) on `legacy_id`, chunked. Each row
   * is mapped through {@link toCustomerAgreementUpsertRow} so the write path and
   * the migration bridge produce byte-identical rows. Idempotent: re-running
   * overwrites the same `legacy_id` rather than duplicating, so a re-persist
   * heals drift. Historical versions are only ever touched by the supersede
   * operation (status/supersededById/updatedAt flip on the prior version) — the
   * caller is responsible for passing already-superseded copies.
   *
   * @returns the number of version rows written.
   */
  async upsertVersions(
    agreements: CustomerAgreement[],
    companyUuid: string | null,
  ): Promise<number> {
    if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
    if (agreements.length === 0) return 0;
    const stop = perf.start("customerAgreements.write.supabase.versions");
    try {
      const rows = agreements.map((a) => toCustomerAgreementUpsertRow(a, companyUuid));
      for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
        const chunk = rows.slice(i, i + WRITE_CHUNK);
        const { error } = await supabase
          .from("customer_agreements")
          .upsert(chunk, { onConflict: "legacy_id" });
        if (error) {
          throw new Error(
            `[customer_agreements] Supabase version upsert failed at chunk ${i / WRITE_CHUNK}: ${error.message}`,
          );
        }
      }
      return rows.length;
    } finally {
      stop();
    }
  },

  /**
   * Upserts agreement LINE snapshots (children) on `legacy_id`, chunked. Lines
   * are immutable snapshots — a new version creates NEW line ids, so this never
   * mutates a prior version's historical lines.
   *
   * @returns the number of line rows written.
   */
  async upsertLines(
    lines: CustomerAgreementLine[],
    companyUuid: string | null,
  ): Promise<number> {
    if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
    if (lines.length === 0) return 0;
    const stop = perf.start("customerAgreements.write.supabase.lines");
    try {
      const rows = lines.map((l) => toCustomerAgreementLineUpsertRow(l, companyUuid));
      for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
        const chunk = rows.slice(i, i + WRITE_CHUNK);
        const { error } = await supabase
          .from("customer_agreement_lines")
          .upsert(chunk, { onConflict: "legacy_id" });
        if (error) {
          throw new Error(
            `[customer_agreement_lines] Supabase line upsert failed at chunk ${i / WRITE_CHUNK}: ${error.message}`,
          );
        }
      }
      return rows.length;
    } finally {
      stop();
    }
  },

  /** Ordered lines (by sortOrder) for one agreement version. */
  async listLines(agreementId: string): Promise<CustomerAgreementLine[]> {
    if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
    const { data, error } = await supabase
      .from("customer_agreement_lines")
      .select("data")
      .eq("agreement_legacy_id", agreementId)
      .order("sort_order", { ascending: true });
    if (error) {
      throw new Error(`[customer_agreement_lines] Supabase read failed: ${error.message}`);
    }
    const rows = (data ?? []) as unknown as CustomerAgreementLineDetailRow[];
    return rows.map((r) => r.data).filter((l): l is CustomerAgreementLine => Boolean(l));
  },
};
