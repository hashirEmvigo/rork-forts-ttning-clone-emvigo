/**
 * Customer Agreement migration + shadow-read bridge (Phase 1 · shadow only).
 *
 * The validation bridge between the current localStorage source of truth and
 * the new Supabase Customer Agreement foundation (migration 0013). It mirrors
 * the proven `customerMigration.ts` pattern, with one important difference:
 * Customer Agreements have NO localStorage source yet, so this utility DERIVES
 * draft/synthetic agreements from current customer + work-order + service-row
 * data, then migrates and validates that shadow copy.
 *
 *   1. `migrateCustomerAgreements()` — derives synthetic draft agreements +
 *      lines and upserts them into the Supabase `customer_agreements` /
 *      `customer_agreement_lines` tables. Idempotent (deterministic ids +
 *      upsert on `legacy_id`), repeatable, and supports `dryRun`.
 *
 *   2. `shadowReadCustomerAgreements()` — rebuilds the synthetic agreements
 *      locally and diffs them against the Supabase shadow copy (headers,
 *      version chains, lines), producing a structured mismatch report.
 *
 *   3. `compareCustomerAgreementRows()` / `compareCustomerAgreementLines()` —
 *      pure field-level comparators used by the shadow read and exported for
 *      reuse/testing.
 *
 * SHADOW FOUNDATION ONLY — this changes NO business behaviour:
 *   * Current `WorkOrderServiceRow`s remain the operational source of truth.
 *   * No WorkOrders are generated from agreements.
 *   * No live flag / cut-over / activation happens.
 *   * Out of scope (nothing here): Invoice Basis, Time Bank, Agreement
 *     Templates, Pricing Engine, RUT, Customer Portal, UI.
 *
 * SAFETY — when current data is incomplete the derivation SKIPS safely and
 * reports a warning; it never invents commercial terms silently. Every
 * synthetic default (billing model, invoice interval, missing price) is
 * surfaced as a warning so reviewers can see exactly what was assumed.
 */
import { getCustomers, getServices, getWorkOrders } from "@/lib/store";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type {
  Customer,
  CustomerAgreement,
  CustomerAgreementLine,
  Service,
  WorkOrder,
  WorkOrderServiceRow,
} from "@/types";
import {
  supabaseCustomerAgreementRepository,
  toCustomerAgreementLineUpsertRow,
  toCustomerAgreementUpsertRow,
  type CustomerAgreementLineUpsertRow,
  type CustomerAgreementUpsertRow,
} from "./customerAgreementRepository";
import { loadCompanyUuidMap } from "./customerMigration";

// ── Synthetic derivation (shared by migrate + shadow read) ────

/**
 * A derived synthetic agreement plus its lines and any warnings raised while
 * building it. One synthetic agreement is derived per customer that has enough
 * data; `warnings` records every assumed/default commercial value.
 */
export interface SyntheticAgreementBuild {
  agreement: CustomerAgreement;
  lines: CustomerAgreementLine[];
  warnings: string[];
  /** Lines whose `sourceServiceId` could not be resolved in the catalog. */
  missingServiceCount: number;
}

/** Conservative default billing model for a derived agreement (NOT authoritative). */
const SYNTHETIC_BILLING_MODEL = "per_visit" as const;
/** Conservative default invoice cadence for a derived agreement (NOT authoritative). */
const SYNTHETIC_INVOICE_INTERVAL = "per_visit" as const;
/** Marks every record this utility derives, so it is never mistaken for a real agreement. */
const SYNTHETIC_NOTE =
  "SYNTHETIC shadow agreement derived from work-order service rows (Phase 1 validation bridge). Commercial terms are NOT authoritative.";

/** Deterministic version-chain key for a customer's synthetic agreement. */
export function syntheticAgreementGroupId(customerId: string): string {
  return `synthgrp-${customerId}`;
}

/** Deterministic version id for a customer's synthetic agreement (v1). */
export function syntheticAgreementId(customerId: string): string {
  return `synthagr-${customerId}-v1`;
}

/** Deterministic line id for a synthetic agreement line derived from a service row. */
export function syntheticLineId(rowId: string): string {
  return `synthln-${rowId}`;
}

/** Stable timestamp basis for a derived record, so re-runs produce identical rows. */
function syntheticTimestamp(customer: Customer): string {
  return customer.createdAt ?? customer.updatedAt ?? "1970-01-01T00:00:00.000Z";
}

/** Collects the non-archived service rows for a customer, ordered deterministically. */
function customerServiceRows(
  customer: Customer,
  workOrders: WorkOrder[],
): WorkOrderServiceRow[] {
  const rows: WorkOrderServiceRow[] = [];
  for (const wo of workOrders) {
    if (wo.customerId !== customer.id || wo.companyId !== customer.companyId) continue;
    for (const row of wo.serviceRows ?? []) {
      if (row.archived === true) continue;
      rows.push(row);
    }
  }
  // Deterministic order: sortOrder, then serviceDate, then id — independent of
  // work-order iteration order so migrate + shadow read agree byte-for-byte.
  return rows.sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    if (a.serviceDate !== b.serviceDate) return a.serviceDate < b.serviceDate ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Derives ONE synthetic draft agreement (+ lines) for a customer, or returns a
 * skip reason when there is not enough data to build commercial terms safely.
 * Pure — takes its inputs explicitly so it is deterministic and testable.
 */
export function buildSyntheticAgreement(
  customer: Customer,
  workOrders: WorkOrder[],
  serviceById: Map<string, Service>,
): SyntheticAgreementBuild | { skip: string } {
  const rows = customerServiceRows(customer, workOrders);
  if (rows.length === 0) {
    return { skip: "no work-order service rows to derive commercial terms from" };
  }

  const ts = syntheticTimestamp(customer);
  const groupId = syntheticAgreementGroupId(customer.id);
  const agreementId = syntheticAgreementId(customer.id);
  const warnings: string[] = [];
  let missingServiceCount = 0;

  const agreement: CustomerAgreement = {
    id: agreementId,
    agreementGroupId: groupId,
    companyId: customer.companyId,
    customerId: customer.id,
    version: 1,
    status: "draft",
    billingModel: SYNTHETIC_BILLING_MODEL,
    invoiceInterval: SYNTHETIC_INVOICE_INTERVAL,
    name: `Derived agreement — ${customer.name}`,
    supersedesVersionId: null,
    supersededById: null,
    sourceType: "imported",
    sourceReferenceId: null,
    notes: SYNTHETIC_NOTE,
    createdBy: null,
    createdAt: ts,
    updatedAt: ts,
  };

  // Every synthetic default is surfaced — never an invented term applied silently.
  warnings.push(
    `synthetic billingModel="${SYNTHETIC_BILLING_MODEL}" / invoiceInterval="${SYNTHETIC_INVOICE_INTERVAL}" assumed (not authoritative)`,
  );

  const lines: CustomerAgreementLine[] = rows.map((row, index) => {
    const sourceServiceId = row.sourceServiceId ?? null;
    const service = sourceServiceId ? serviceById.get(sourceServiceId) : undefined;
    if (sourceServiceId && !service) {
      missingServiceCount += 1;
      warnings.push(`line ${row.id}: source service "${sourceServiceId}" not found in catalog`);
    }
    if (row.price === undefined || row.price === null) {
      warnings.push(`line ${row.id}: no price on source row (agreedPrice left null)`);
    }
    return {
      id: syntheticLineId(row.id),
      agreementId,
      agreementGroupId: groupId,
      companyId: customer.companyId,
      sortOrder: index,
      pricingModel: "fixed",
      agreedPrice: row.price ?? null,
      quantity: row.quantity ?? null,
      unit: row.unit,
      vat: row.vat ?? null,
      sourceServiceId,
      serviceNameSnapshot: row.serviceName,
      categoryNameSnapshot: row.categoryName ?? null,
      // Service rows do not carry a stable category TYPE classification; left
      // null rather than guessed (a derived term must never be invented).
      categoryTypeSnapshot: null,
      serviceBasisTypeSnapshot: service?.serviceBasisType ?? null,
      createdAt: ts,
      updatedAt: ts,
    };
  });

  return { agreement, lines, warnings, missingServiceCount };
}

function scopeCustomersByCompany(
  customers: Customer[],
  companyId: string | null | undefined,
): Customer[] {
  if (companyId === undefined || companyId === null) return customers;
  return customers.filter((c) => c.companyId === companyId);
}

/** Builds the full set of in-scope synthetic agreements from current local data. */
function deriveSyntheticAgreements(companyId: string | null): {
  builds: SyntheticAgreementBuild[];
  skipped: Array<{ customerId: string; reason: string }>;
} {
  const customers = scopeCustomersByCompany(getCustomers(), companyId);
  const workOrders = getWorkOrders();
  const serviceById = new Map<string, Service>(getServices().map((s) => [s.id, s]));

  const builds: SyntheticAgreementBuild[] = [];
  const skipped: Array<{ customerId: string; reason: string }> = [];
  for (const customer of customers) {
    const result = buildSyntheticAgreement(customer, workOrders, serviceById);
    if ("skip" in result) {
      skipped.push({ customerId: customer.id, reason: result.skip });
    } else {
      builds.push(result);
    }
  }
  return { builds, skipped };
}

// ── Migration ─────────────────────────────────────────────

/** Structured outcome of a Customer Agreement migration run (or dry-run). */
export interface CustomerAgreementMigrationReport {
  ok: boolean;
  dryRun: boolean;
  /** Company scope this run was limited to, or null for all companies. */
  companyId: string | null;
  /** Customers in scope. */
  sourceCustomerCount: number;
  /** Synthetic agreements that would be / were written. */
  migratedCount: number;
  /** Synthetic agreement LINES that would be / were written. */
  migratedLineCount: number;
  /** Agreement rows actually written (0 on dry-run). */
  writtenCount: number;
  /** Line rows actually written (0 on dry-run). */
  writtenLineCount: number;
  /** Customers skipped (no data / unresolved company), with reasons. */
  skipped: Array<{ customerId: string; reason: string }>;
  /** Count of skipped customers. */
  skippedCount: number;
  /** Non-fatal derivation warnings (every assumed term + missing service/price). */
  warnings: string[];
  /** Count of warnings raised. */
  warningCount: number;
  /** Lines whose source service could not be resolved in the catalog. */
  missingServiceCount: number;
  /** Fatal error, if the run failed. */
  error?: string;
}

/**
 * Derives synthetic Customer Agreements from current local data and migrates
 * them into Supabase. Idempotent + repeatable (deterministic ids, upsert on
 * `legacy_id`). SHADOW ONLY — does not activate agreements or touch any UI.
 *
 * @param options.companyId Restrict to a single app-facing company id.
 * @param options.dryRun    When true, compute the plan + report but write nothing.
 */
export async function migrateCustomerAgreements(options?: {
  companyId?: string | null;
  dryRun?: boolean;
}): Promise<CustomerAgreementMigrationReport> {
  const companyId = options?.companyId ?? null;
  const dryRun = options?.dryRun ?? false;

  const customers = scopeCustomersByCompany(getCustomers(), companyId);
  const report: CustomerAgreementMigrationReport = {
    ok: false,
    dryRun,
    companyId,
    sourceCustomerCount: customers.length,
    migratedCount: 0,
    migratedLineCount: 0,
    writtenCount: 0,
    writtenLineCount: 0,
    skipped: [],
    skippedCount: 0,
    warnings: [],
    warningCount: 0,
    missingServiceCount: 0,
  };

  if (!isSupabaseConfigured || !supabase) {
    report.error = "Supabase is not configured.";
    return report;
  }

  const { builds, skipped } = deriveSyntheticAgreements(companyId);
  report.skipped = skipped;

  const companyMap = await loadCompanyUuidMap();
  const agreementRows: CustomerAgreementUpsertRow[] = [];
  const lineRows: CustomerAgreementLineUpsertRow[] = [];

  for (const build of builds) {
    const uuid = companyMap.get(build.agreement.companyId) ?? null;
    if (!uuid) {
      // No matching companies row — RLS would reject the write. Skip + report.
      report.skipped.push({
        customerId: build.agreement.customerId,
        reason: `No Supabase company found for legacy_id "${build.agreement.companyId}". Migrate companies first.`,
      });
      continue;
    }
    agreementRows.push(toCustomerAgreementUpsertRow(build.agreement, uuid));
    for (const line of build.lines) {
      lineRows.push(toCustomerAgreementLineUpsertRow(line, uuid));
    }
    report.warnings.push(...build.warnings);
    report.missingServiceCount += build.missingServiceCount;
  }

  report.migratedCount = agreementRows.length;
  report.migratedLineCount = lineRows.length;
  report.skippedCount = report.skipped.length;
  report.warningCount = report.warnings.length;

  if (dryRun) {
    report.ok = true;
    return report;
  }

  const CHUNK = 200;
  try {
    // Parents first (lines reference agreement_legacy_id), then children.
    for (let i = 0; i < agreementRows.length; i += CHUNK) {
      const chunk = agreementRows.slice(i, i + CHUNK);
      const { error } = await supabase
        .from("customer_agreements")
        .upsert(chunk, { onConflict: "legacy_id" });
      if (error) {
        report.error = `Agreement upsert failed at chunk ${i / CHUNK}: ${error.message}`;
        report.writtenCount = i;
        return report;
      }
    }
    report.writtenCount = agreementRows.length;

    for (let i = 0; i < lineRows.length; i += CHUNK) {
      const chunk = lineRows.slice(i, i + CHUNK);
      const { error } = await supabase
        .from("customer_agreement_lines")
        .upsert(chunk, { onConflict: "legacy_id" });
      if (error) {
        report.error = `Line upsert failed at chunk ${i / CHUNK}: ${error.message}`;
        report.writtenLineCount = i;
        return report;
      }
    }
    report.writtenLineCount = lineRows.length;

    report.ok = true;
    return report;
  } catch (err) {
    report.error = err instanceof Error ? err.message : "Unknown migration error.";
    return report;
  }
}

// ── Comparators (pure, exported for reuse + tests) ────────

/** A single field-level difference between a local and remote record. */
export interface FieldMismatch {
  field: string;
  local: string;
  remote: string;
}

/** Stable, comparison-friendly stringification of a scalar field. */
function norm(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value);
}

/**
 * Compares two agreement HEADERS field by field. Covers the version chain,
 * scope (customer/company), commercial model, status and validity. Returns the
 * list of differing fields — empty when the headers match.
 */
export function compareCustomerAgreementRows(
  local: CustomerAgreement,
  remote: CustomerAgreement,
): FieldMismatch[] {
  const mismatches: FieldMismatch[] = [];
  const fields: Array<keyof CustomerAgreement> = [
    "id",
    "agreementGroupId",
    "customerId",
    "companyId",
    "version",
    "status",
    "billingModel",
    "invoiceInterval",
    "sourceType",
    "supersedesVersionId",
    "supersededById",
    "validFrom",
    "validTo",
  ];
  for (const field of fields) {
    const l = norm(local[field]);
    const r = norm(remote[field]);
    if (l !== r) mismatches.push({ field: String(field), local: l, remote: r });
  }
  return mismatches;
}

/**
 * Compares two ordered sets of agreement LINES. Surfaces a count difference and,
 * for lines paired by id, the service snapshot, agreed price, VAT, pricing model,
 * quantity/unit and active fields. Returns the list of differing fields — empty
 * when the line sets match.
 */
export function compareCustomerAgreementLines(
  localLines: CustomerAgreementLine[],
  remoteLines: CustomerAgreementLine[],
): FieldMismatch[] {
  const mismatches: FieldMismatch[] = [];
  if (localLines.length !== remoteLines.length) {
    mismatches.push({
      field: "lineCount",
      local: String(localLines.length),
      remote: String(remoteLines.length),
    });
  }

  const remoteById = new Map(remoteLines.map((l) => [l.id, l]));
  const fields: Array<keyof CustomerAgreementLine> = [
    "sortOrder",
    "pricingModel",
    "agreedPrice",
    "quantity",
    "unit",
    "vat",
    "sourceServiceId",
    "serviceNameSnapshot",
    "categoryNameSnapshot",
    "serviceBasisTypeSnapshot",
    "billingModelOverride",
  ];
  for (const local of localLines) {
    const remote = remoteById.get(local.id);
    if (!remote) {
      mismatches.push({ field: `line ${local.id}`, local: "present", remote: "missing" });
      continue;
    }
    for (const field of fields) {
      const l = norm(local[field]);
      const r = norm(remote[field]);
      if (l !== r) {
        mismatches.push({ field: `line ${local.id}.${String(field)}`, local: l, remote: r });
      }
    }
  }
  // Remote lines with no local counterpart (stale / extra).
  const localIds = new Set(localLines.map((l) => l.id));
  for (const remote of remoteLines) {
    if (!localIds.has(remote.id)) {
      mismatches.push({ field: `line ${remote.id}`, local: "missing", remote: "present" });
    }
  }
  return mismatches;
}

// ── Shadow-read validation ────────────────────────────────

/** Structured outcome of a Customer Agreement shadow read. */
export interface CustomerAgreementShadowReport {
  ok: boolean;
  companyId: string | null;
  /** Synthetic agreements derived from current local data (the expected set). */
  localAgreementCount: number;
  /** Agreements found in the Supabase shadow copy for the scope. */
  supabaseAgreementCount: number;
  /** Agreement headers compared and found equal. */
  matchedCount: number;
  /** Agreement headers with at least one differing field. */
  mismatchCount: number;
  /** Local agreement ids absent from Supabase (not yet migrated). */
  missingInSupabase: string[];
  /** Supabase agreement ids absent locally (stale / extra). */
  extraInSupabase: string[];
  /** Supabase agreements whose customer no longer exists locally. */
  missingCustomerCount: number;
  /** Lines whose source service could not be resolved in the local catalog. */
  missingServiceCount: number;
  /** Agreements whose line sets differ between local and Supabase. */
  lineMismatchCount: number;
  /** Customers skipped during derivation (insufficient data). */
  skippedCount: number;
  /** Count of Supabase reads that failed (header / chain / lines). */
  supabaseReadFailures: number;
  /** Human-readable notes — never empty when ok is false. */
  notes: string[];
}

function idSetDiff(a: string[], b: string[]): { onlyA: string[]; onlyB: string[] } {
  const setB = new Set(b);
  const setA = new Set(a);
  return {
    onlyA: a.filter((id) => !setB.has(id)),
    onlyB: b.filter((id) => !setA.has(id)),
  };
}

/**
 * Diffs the synthetic Customer Agreements derived from current local data
 * against the Supabase shadow copy. Read-only on both sides; mutates nothing.
 * Compares headers, version chains and lines; differences are surfaced, never
 * silently ignored. Use this to confirm "0 critical mismatches" before any
 * future activation work.
 *
 * @param companyId App-facing company scope (null/undefined = all visible).
 */
export async function shadowReadCustomerAgreements(
  companyId?: string | null,
): Promise<CustomerAgreementShadowReport> {
  const scope = companyId ?? null;
  const queryScope = companyId ?? undefined;
  const notes: string[] = [];

  const { builds, skipped } = deriveSyntheticAgreements(scope);
  const localById = new Map(builds.map((b) => [b.agreement.id, b]));
  const knownCustomerIds = new Set(getCustomers().map((c) => c.id));

  const report: CustomerAgreementShadowReport = {
    ok: false,
    companyId: scope,
    localAgreementCount: builds.length,
    supabaseAgreementCount: 0,
    matchedCount: 0,
    mismatchCount: 0,
    missingInSupabase: [],
    extraInSupabase: [],
    missingCustomerCount: 0,
    missingServiceCount: builds.reduce((sum, b) => sum + b.missingServiceCount, 0),
    lineMismatchCount: 0,
    skippedCount: skipped.length,
    supabaseReadFailures: 0,
    notes,
  };

  if (!isSupabaseConfigured || !supabase) {
    notes.push("Supabase is not configured.");
    return report;
  }

  let remoteSummaries;
  try {
    remoteSummaries = await supabaseCustomerAgreementRepository.listSummaries({
      companyId: queryScope,
    });
  } catch (err) {
    report.supabaseReadFailures += 1;
    notes.push(err instanceof Error ? err.message : "Supabase agreement list failed.");
    return report;
  }

  report.supabaseAgreementCount = remoteSummaries.total;

  const remoteIds = remoteSummaries.items.map((s) => s.id);
  const { onlyA, onlyB } = idSetDiff([...localById.keys()], remoteIds);
  report.missingInSupabase = onlyA;
  report.extraInSupabase = onlyB;
  if (onlyA.length > 0) notes.push(`${onlyA.length} synthetic agreement(s) not yet in Supabase`);
  if (onlyB.length > 0) notes.push(`${onlyB.length} extra agreement(s) in Supabase`);

  // Supabase agreements whose customer no longer exists locally.
  for (const summary of remoteSummaries.items) {
    if (!knownCustomerIds.has(summary.customerId)) report.missingCustomerCount += 1;
  }
  if (report.missingCustomerCount > 0) {
    notes.push(`${report.missingCustomerCount} Supabase agreement(s) reference a missing customer`);
  }

  // Header + version-chain + line comparison on the shared ids.
  for (const summary of remoteSummaries.items) {
    const localBuild = localById.get(summary.id);
    if (!localBuild) continue;

    let remoteDetail: CustomerAgreement | null;
    let remoteLines: CustomerAgreementLine[];
    try {
      [remoteDetail, remoteLines] = await Promise.all([
        supabaseCustomerAgreementRepository.getDetail(summary.id, { companyId: queryScope }),
        supabaseCustomerAgreementRepository.listLines(summary.id),
      ]);
    } catch (err) {
      report.supabaseReadFailures += 1;
      notes.push(err instanceof Error ? err.message : `read failed for ${summary.id}`);
      continue;
    }

    if (!remoteDetail) {
      report.supabaseReadFailures += 1;
      notes.push(`agreement ${summary.id} summary present but detail missing`);
      continue;
    }

    const headerDiffs = compareCustomerAgreementRows(localBuild.agreement, remoteDetail);
    const lineDiffs = compareCustomerAgreementLines(localBuild.lines, remoteLines);

    if (headerDiffs.length === 0 && lineDiffs.length === 0) {
      report.matchedCount += 1;
    } else {
      if (headerDiffs.length > 0) {
        report.mismatchCount += 1;
        notes.push(`header mismatch for ${summary.id}: ${headerDiffs.map((d) => d.field).join(", ")}`);
      }
      if (lineDiffs.length > 0) {
        report.lineMismatchCount += 1;
        notes.push(`line mismatch for ${summary.id}: ${lineDiffs.map((d) => d.field).join(", ")}`);
      }
    }

    // Verify the version chain reads back as the single-version chain we derived.
    try {
      const chain = await supabaseCustomerAgreementRepository.listVersionChain(
        summary.agreementGroupId,
        { companyId: queryScope },
      );
      if (chain.length !== 1 || chain[0]?.id !== summary.id) {
        report.mismatchCount += 1;
        notes.push(`version chain unexpected for ${summary.agreementGroupId}`);
      }
    } catch (err) {
      report.supabaseReadFailures += 1;
      notes.push(err instanceof Error ? err.message : `chain read failed for ${summary.agreementGroupId}`);
    }
  }

  report.ok =
    report.missingInSupabase.length === 0 &&
    report.extraInSupabase.length === 0 &&
    report.mismatchCount === 0 &&
    report.lineMismatchCount === 0 &&
    report.missingCustomerCount === 0 &&
    report.supabaseReadFailures === 0;
  return report;
}

// Expose console handles in development for manual migration + verification.
if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as {
    __cleanopsData?: Record<string, unknown>;
  };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    migrateCustomerAgreements,
    shadowReadCustomerAgreements,
  };
}
