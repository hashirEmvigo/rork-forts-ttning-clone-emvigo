/**
 * Customer migration + shadow-read tooling (P4D Wave 1A).
 *
 * Two development/admin utilities, both READ-ONLY against the running app's
 * localStorage source of truth:
 *
 *   1. `migrateCustomers()` — copies localStorage customers INTO the Supabase
 *      `customers` table. Idempotent (upsert on `legacy_id`), repeatable, and
 *      supports a `dryRun` mode that computes the plan + report WITHOUT writing.
 *
 *   2. `shadowReadCustomers()` — diffs localStorage vs Supabase for a company
 *      (count / id set / summary fields / detail), producing a structured
 *      mismatch report. Differences are surfaced, never silently ignored.
 *
 * Neither utility touches the UI or changes business behaviour. localStorage
 * stays the source of truth for the whole of Wave 1A; Supabase is the shadow
 * copy these tools populate and verify.
 */
import { getCustomers } from "@/lib/store";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { Customer } from "@/types";
import { localDataLayer } from "./localStorageAdapters";
import { supabaseCustomerRepository } from "./supabaseCustomerRepository";

// ── Migration ─────────────────────────────────────────────

/** A single upsert row written to (or planned for) the `customers` table. */
export interface CustomerUpsertRow {
  legacy_id: string;
  company_id: string | null;
  company_legacy_id: string;
  customer_number: string;
  name: string;
  email: string;
  status: string;
  customer_type: string | null;
  area_id: string | null;
  /** Soft-delete marker. Active upserts always clear it (re-create / restore). */
  deleted_at: string | null;
  data: Customer;
}

/** Structured outcome of a migration run (or dry-run). */
export interface CustomerMigrationReport {
  ok: boolean;
  dryRun: boolean;
  /** Company scope this run was limited to, or null for all companies. */
  companyId: string | null;
  /** Customers read from localStorage for the scope. */
  sourceCount: number;
  /** Rows that would be / were upserted. */
  plannedCount: number;
  /** Rows actually written (0 on dry-run). */
  writtenCount: number;
  /** Source customers skipped because their company_id could not be resolved. */
  skipped: Array<{ id: string; reason: string }>;
  /** Fatal error, if the run failed. */
  error?: string;
}

function scopeByCompany(customers: Customer[], companyId: string | null | undefined): Customer[] {
  if (companyId === undefined || companyId === null) return customers;
  return customers.filter((c) => c.companyId === companyId);
}

/**
 * Maps a localStorage {@link Customer} to a `customers` table upsert row. The
 * flat columns mirror {@link CustomerSummary}; the full record is preserved
 * losslessly in `data`. Shared by the migration utility and the Wave 1D
 * dual-write mirror so both write byte-identical rows.
 */
export function toCustomerUpsertRow(customer: Customer, companyUuid: string | null): CustomerUpsertRow {
  return {
    legacy_id: customer.id,
    company_id: companyUuid,
    company_legacy_id: customer.companyId,
    customer_number: customer.customerNumber,
    name: customer.name,
    email: customer.email ?? "",
    status: customer.status,
    customer_type: customer.customerType ?? null,
    area_id: customer.areaId ?? null,
    // Any active upsert UNDELETES the row: re-creating / reactivating a customer
    // with the same legacy_id atomically clears a prior soft-delete.
    deleted_at: null,
    data: customer,
  };
}

/**
 * Builds a map of app-facing company id (`legacy_id`) → Supabase `companies.id`
 * UUID, so each migrated customer can carry the real tenant FK that RLS checks.
 * Shared by the migration utility and the Wave 1D dual-write mirror.
 */
export async function loadCompanyUuidMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!isSupabaseConfigured || !supabase) return map;
  const { data, error } = await supabase.from("companies").select("id, legacy_id");
  if (error || !data) return map;
  for (const row of data as Array<{ id: string; legacy_id: string | null }>) {
    if (row.legacy_id) map.set(row.legacy_id, row.id);
  }
  return map;
}

/**
 * Migrates localStorage customers into Supabase.
 *
 * @param options.companyId Restrict to a single app-facing company id.
 * @param options.dryRun    When true, compute the plan + report but write nothing.
 */
export async function migrateCustomers(options?: {
  companyId?: string | null;
  dryRun?: boolean;
}): Promise<CustomerMigrationReport> {
  const companyId = options?.companyId ?? null;
  const dryRun = options?.dryRun ?? false;

  const source = scopeByCompany(getCustomers(), companyId);
  const report: CustomerMigrationReport = {
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
  const rows: CustomerUpsertRow[] = [];
  for (const customer of source) {
    const uuid = companyMap.get(customer.companyId) ?? null;
    if (!uuid) {
      // No matching companies row — RLS would reject the write. Skip + report.
      report.skipped.push({
        id: customer.id,
        reason: `No Supabase company found for legacy_id "${customer.companyId}". Migrate companies first.`,
      });
      continue;
    }
    rows.push(toCustomerUpsertRow(customer, uuid));
  }
  report.plannedCount = rows.length;

  if (dryRun) {
    report.ok = report.skipped.length === 0;
    return report;
  }

  if (rows.length === 0) {
    report.ok = report.skipped.length === 0;
    return report;
  }

  // Idempotent + repeatable: upsert on the unique `legacy_id`. Re-running simply
  // refreshes existing rows. Chunked to keep request payloads reasonable.
  const CHUNK = 200;
  try {
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const { error } = await supabase
        .from("customers")
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

// ── Shadow-read validation ────────────────────────────────

/** Per-aspect outcome of a localStorage-vs-Supabase customer comparison. */
export interface CustomerShadowReport {
  ok: boolean;
  companyId: string | null;
  localCount: number;
  supabaseCount: number;
  countMatch: boolean;
  idsMatch: boolean;
  summaryMatch: boolean;
  detailMatch: boolean;
  /** Ids present locally but missing in Supabase (not yet migrated). */
  missingInSupabase: string[];
  /** Ids present in Supabase but absent locally (stale/extra). */
  extraInSupabase: string[];
  /** Human-readable mismatch notes — never empty when ok is false. */
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
 * Compares localStorage customers against the Supabase shadow copy for a scope.
 * Read-only on both sides; mutates nothing. Use this to confirm
 * "0 critical mismatches" before any future UI cut-over.
 */
export async function shadowReadCustomers(
  companyId?: string | null,
): Promise<CustomerShadowReport> {
  // Label-only normalisation. The ADAPTER scope must stay `companyId` (which is
  // `undefined` for the all-companies case): the localStorage adapter filters on
  // an explicit `null`, whereas the Supabase repository treats `null` as "all".
  // Coercing to `null` here would make the unscoped shadow read disagree by
  // construction, so we keep `companyId` for the queries and only label with `scope`.
  const scope = companyId ?? null;
  const queryScope = companyId ?? undefined;
  const notes: string[] = [];

  const local = await localDataLayer.customers.listSummaries({ companyId: queryScope });

  const report: CustomerShadowReport = {
    ok: false,
    companyId: scope,
    localCount: local.total,
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

  let remote: Awaited<ReturnType<typeof supabaseCustomerRepository.listSummaries>>;
  try {
    remote = await supabaseCustomerRepository.listSummaries({ companyId: queryScope });
  } catch (err) {
    notes.push(err instanceof Error ? err.message : "Supabase read failed.");
    return report;
  }

  report.supabaseCount = remote.total;
  report.countMatch = local.total === remote.total;
  if (!report.countMatch) notes.push(`count mismatch: local ${local.total} vs supabase ${remote.total}`);

  const { onlyA, onlyB } = idSetDiff(
    local.items.map((c) => c.id),
    remote.items.map((c) => c.id),
  );
  report.missingInSupabase = onlyA;
  report.extraInSupabase = onlyB;
  report.idsMatch = onlyA.length === 0 && onlyB.length === 0;
  if (onlyA.length > 0) notes.push(`${onlyA.length} customer(s) not yet in Supabase`);
  if (onlyB.length > 0) notes.push(`${onlyB.length} extra customer(s) in Supabase`);

  // Summary field spot-check on the shared ids.
  const remoteById = new Map(remote.items.map((c) => [c.id, c] as const));
  let summaryMatch = true;
  for (const l of local.items) {
    const r = remoteById.get(l.id);
    if (!r) continue;
    if (
      r.name !== l.name ||
      r.customerNumber !== l.customerNumber ||
      r.status !== l.status ||
      r.email !== l.email
    ) {
      summaryMatch = false;
      notes.push(`summary mismatch for ${l.id}`);
      break;
    }
  }
  report.summaryMatch = summaryMatch;

  // Detail parity on a single sample id present in both.
  let detailMatch = true;
  const sample = local.items.find((l) => remoteById.has(l.id));
  if (sample) {
    try {
      const [localDetail, remoteDetail] = await Promise.all([
        localDataLayer.customers.getDetail(sample.id, { companyId: queryScope }),
        supabaseCustomerRepository.getDetail(sample.id, { companyId: queryScope }),
      ]);
      detailMatch =
        Boolean(remoteDetail) &&
        remoteDetail?.id === localDetail?.id &&
        remoteDetail?.customerNumber === localDetail?.customerNumber &&
        remoteDetail?.name === localDetail?.name;
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

// ── Detail shadow-read validation (P4G · Wave 1C) ─────────

/** Outcome of a single-customer localStorage-vs-Supabase DETAIL comparison. */
export interface CustomerDetailShadowReport {
  ok: boolean;
  id: string;
  /** Viewer scope applied to the Supabase read (null = unscoped / super admin). */
  companyId: string | null;
  localFound: boolean;
  supabaseFound: boolean;
  /** Detail fields confirmed equal across both sources. */
  matchedFields: string[];
  /** Detail fields that differ (or are missing on one side). */
  mismatchedFields: string[];
  /** Human-readable notes — never empty when ok is false. */
  notes: string[];
}

/** Detail fields that back the Customer Card's visible content. */
const DETAIL_FIELDS: ReadonlyArray<keyof Customer> = [
  "id",
  "customerNumber",
  "name",
  "email",
  "phone",
  "status",
  "customerType",
  "customerSegment",
  "areaId",
  "area",
  "ownerId",
  "postalCityId",
  "mainContact",
];

/** Stable, comparison-friendly stringification of a scalar/array detail field. */
function normaliseField(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return JSON.stringify(value);
  return String(value);
}

/**
 * Order-insensitive, comparison-friendly stringification of an id collection.
 * Sorts + de-duplicates so two sources holding the same ids in a different
 * order compare equal — only genuine membership drift is surfaced.
 */
function normaliseIdSet(value: readonly string[] | undefined | null): string {
  if (!value || value.length === 0) return "";
  return [...new Set(value)].sort().join(",");
}

/**
 * Compares one customer's localStorage detail against its Supabase shadow copy
 * for the fields the Customer Card renders. Read-only on both sides; mutates
 * nothing. Backs the Wave 1C (P4G) Customer Card detail-read switch — surfaces
 * field-level drift, never silently ignored. Also compares the count of nested
 * collections (addresses / contacts) which the card lists.
 *
 * @param id        App-facing customer id.
 * @param companyId Viewer scope (null / undefined = unscoped, e.g. super admin).
 */
export async function shadowReadCustomerDetail(
  id: string,
  companyId?: string | null,
): Promise<CustomerDetailShadowReport> {
  const scope = companyId ?? null;
  const queryScope = companyId ?? undefined;
  const notes: string[] = [];
  const matchedFields: string[] = [];
  const mismatchedFields: string[] = [];

  const report: CustomerDetailShadowReport = {
    ok: false,
    id,
    companyId: scope,
    localFound: false,
    supabaseFound: false,
    matchedFields,
    mismatchedFields,
    notes,
  };

  if (!isSupabaseConfigured || !supabase) {
    notes.push("Supabase is not configured.");
    return report;
  }

  let local: Customer | null;
  let remote: Customer | null;
  try {
    [local, remote] = await Promise.all([
      localDataLayer.customers.getDetail(id, { companyId: queryScope }),
      supabaseCustomerRepository.getDetail(id, { companyId: queryScope }),
    ]);
  } catch (err) {
    notes.push(err instanceof Error ? err.message : "detail read failed");
    return report;
  }

  report.localFound = Boolean(local);
  report.supabaseFound = Boolean(remote);
  if (!local) notes.push("customer not found in localStorage");
  if (!remote) notes.push("customer not found in Supabase");
  if (!local || !remote) return report;

  for (const field of DETAIL_FIELDS) {
    if (normaliseField(local[field]) === normaliseField(remote[field])) {
      matchedFields.push(field);
    } else {
      mismatchedFields.push(field);
      notes.push(`field mismatch: ${field}`);
    }
  }

  // Nested collections the card lists — compare counts (cheap, drift-revealing).
  if ((local.addresses?.length ?? 0) !== (remote.addresses?.length ?? 0)) {
    mismatchedFields.push("addresses.length");
    notes.push("address count mismatch");
  } else {
    matchedFields.push("addresses.length");
  }
  if ((local.contacts?.length ?? 0) !== (remote.contacts?.length ?? 0)) {
    mismatchedFields.push("contacts.length");
    notes.push("contact count mismatch");
  } else {
    matchedFields.push("contacts.length");
  }

  // Linked customer-portal logins (userIds). Critical for Customer Portal,
  // customer authentication and future customer-user relationships — drift here
  // means a login round-trips to the wrong (or no) customer. Compared as an
  // order-insensitive set so a different array order isn't reported as drift.
  const localUserIds = normaliseIdSet(local.userIds);
  const remoteUserIds = normaliseIdSet(remote.userIds);
  if (localUserIds !== remoteUserIds) {
    mismatchedFields.push("userIds");
    notes.push("userIds mismatch (customer-portal login drift)");
  } else {
    matchedFields.push("userIds");
  }

  report.ok = mismatchedFields.length === 0;
  return report;
}

// Expose console handles in development for manual migration + verification.
// Merges with the parity handle already attached in `parity.ts`.
if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as {
    __cleanopsData?: Record<string, unknown>;
  };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    migrateCustomers,
    shadowReadCustomers,
    shadowReadCustomerDetail,
  };
}
