/**
 * Supabase-backed CustomerRepository (P4D Wave 1A + CORE-WRITES-CUSTOMERS-A1.1).
 *
 * Reads plus authoritative create/update writes for the `customers` table created
 * in migration 0007. The table stores flat indexed columns plus the complete
 * Customer payload in `data` jsonb so UI shapes stay unchanged.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { evaluateSearchThreshold } from "@/lib/searchThreshold";
import { perf } from "@/lib/perf";
import { makeId } from "@/lib/store";
import { buildDefaultContact, normalizeCustomerContacts } from "@/lib/customerContacts";
import { segmentForCustomerType } from "@/lib/customerType";
import { normalizeAbsencePriority, normalizeSchedulingPreferencesV2 } from "@/types";
import type {
  CleaningDayPreference,
  Customer,
  CustomerAddress,
  CustomerCardNote,
  CustomerContact,
  CustomerNote,
  CustomerSchedulingPreferences,
  CustomerType,
} from "@/types";
import type { CustomerListParams, CustomerRepository } from "./contracts";
import { loadCompanyUuidMap } from "./customerMigration";
import type {
  CountParams,
  DetailParams,
  ListResult,
  CustomerSummary,
} from "./types";

/** Columns selected for a lightweight summary list (no `data` jsonb). */
const SUMMARY_COLUMNS =
  "legacy_id, company_legacy_id, customer_number, name, email, status, customer_type, area_id";

/**
 * Entity-kind key for the customer visible-number series in `number_counters`
 * (NUM-1). Each company owns an independent `customer` series; the database is
 * the single authority for the value.
 */
const CUSTOMER_NUMBER_ENTITY_KIND = "customer";

/** Shape of the flat summary columns returned by Supabase. */
interface CustomerSummaryRow {
  legacy_id: string;
  company_legacy_id: string;
  customer_number: string;
  name: string;
  email: string | null;
  status: string;
  customer_type: string | null;
  area_id: string | null;
}

/** Shape of a full customer row (summary columns + the lossless `data` jsonb). */
interface CustomerDetailRow {
  data: Customer;
  company_legacy_id: string;
  deleted_at?: string | null;
}

interface CustomerWriteResponse {
  error: { message: string } | null;
}

interface CustomerUpdateQueryBuilder extends PromiseLike<CustomerWriteResponse> {
  eq(column: string, value: string): CustomerUpdateQueryBuilder;
  is(column: string, value: null): CustomerUpdateQueryBuilder;
}

export interface CustomerListReadOptions {
  /** Include archived customer rows. Defaults to false for normal active surfaces. */
  includeArchived?: boolean;
}

/** A full upsert row written to the `customers` table. */
interface CustomerUpsertRow {
  legacy_id: string;
  company_id: string;
  company_legacy_id: string;
  customer_number: string;
  name: string;
  email: string;
  status: string;
  customer_type: string | null;
  area_id: string | null;
  deleted_at: string | null;
  data: Customer;
}

export interface SupabaseCustomerCreateInput {
  /** Company-scoped legacy company id. Global/null-company customers are not supported. */
  companyId: string;
  name: string;
  email: string;
  customerType: CustomerType;
  orgNumber?: string | null;
  phone?: string | null;
  areaId?: string | null;
  area?: string | null;
  postalCityId?: string | null;
  ownerId?: string | null;
  userIds?: string[];
  startOnboarding?: boolean;
}

export type SupabaseCustomerUpdatePatch = Partial<
  Pick<
    Customer,
    | "name"
    | "email"
    | "customerType"
    | "orgNumber"
    | "phone"
    | "areaId"
    | "area"
    | "postalCityId"
    | "ownerId"
    | "userIds"
    | "tags"
    | "mainContact"
    | "addresses"
    | "contacts"
    | "internalNotes"
    | "cardNotes"
    | "schedulingPreferences"
    | "cardLog"
  >
>;

function rowToSummary(row: CustomerSummaryRow): CustomerSummary {
  return {
    id: row.legacy_id,
    companyId: row.company_legacy_id,
    name: row.name,
    customerNumber: row.customer_number,
    email: row.email ?? "",
    status: row.status as CustomerSummary["status"],
    customerType: (row.customer_type as CustomerSummary["customerType"]) ?? undefined,
    areaId: row.area_id ?? undefined,
  };
}

/** Thrown when the repository is used but Supabase is not configured. */
class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "SupabaseCustomerRepository requires Supabase. Set EXPO_PUBLIC_SUPABASE_URL " +
        "and EXPO_PUBLIC_SUPABASE_ANON_KEY.",
    );
    this.name = "SupabaseNotConfiguredError";
  }
}

function applySearch(rows: CustomerSummaryRow[], rawSearch: string | undefined): CustomerSummaryRow[] {
  const { activeQuery, shouldSearch } = evaluateSearchThreshold(rawSearch ?? "");
  if (!shouldSearch) return rows;
  const needle = activeQuery.toLowerCase();
  return rows.filter((r) =>
    [r.name, r.customer_number, r.email].some((f) => (f ?? "").toLowerCase().includes(needle)),
  );
}

function paginate(
  all: CustomerSummary[],
  page?: number,
  pageSize?: number,
): ListResult<CustomerSummary> {
  const total = all.length;
  if (!pageSize || pageSize <= 0) {
    return { items: all, total, page: 1, pageSize: total };
  }
  const safePage = page && page > 0 ? page : 1;
  const start = (safePage - 1) * pageSize;
  return { items: all.slice(start, start + pageSize), total, page: safePage, pageSize };
}

function normalizeText(value: string): string {
  return value.trim();
}

function normalizeOptionalText(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeNullableRef(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeTags(tags: string[] | undefined): string[] | undefined {
  if (tags === undefined) return undefined;
  return tags.map((tag) => tag.trim()).filter(Boolean);
}

function normalizeAddresses(addresses: CustomerAddress[] | undefined): CustomerAddress[] | undefined {
  if (addresses === undefined) return undefined;
  return addresses
    .map<CustomerAddress>((address) => ({
      ...address,
      label: normalizeOptionalText(address.label),
      street: normalizeOptionalText(address.street),
      postalCode: normalizeOptionalText(address.postalCode),
      postalCityId: normalizeNullableRef(address.postalCityId),
      country: normalizeOptionalText(address.country),
      isInvoice: address.isInvoice === true,
      isDelivery: address.isDelivery === true,
    }))
    .filter(
      (address) =>
        Boolean(address.label) ||
        Boolean(address.street) ||
        Boolean(address.postalCode) ||
        Boolean(address.postalCityId) ||
        Boolean(address.country) ||
        address.isInvoice ||
        address.isDelivery,
    );
}

function normalizeContacts(contacts: CustomerContact[] | undefined): CustomerContact[] | undefined {
  if (contacts === undefined) return undefined;
  const cleaned = contacts
    .map<CustomerContact>((contact) => ({
      ...contact,
      name: normalizeText(contact.name),
      title: normalizeOptionalText(contact.title),
      email: normalizeOptionalText(contact.email),
      phone: normalizeOptionalText(contact.phone),
      isPrimary: contact.isPrimary === true,
      isContactPerson: contact.isContactPerson ?? true,
      isInvoiceResponsible: contact.isInvoiceResponsible === true,
      isAgreementResponsible: contact.isAgreementResponsible === true,
    }))
    .filter((contact) => contact.name.length > 0);
  return normalizeCustomerContacts(cleaned);
}

function normalizeInternalNotes(notes: CustomerNote[] | undefined): CustomerNote[] | undefined {
  if (notes === undefined) return undefined;
  return notes
    .map<CustomerNote>((note) => ({
      ...note,
      text: normalizeText(note.text),
      authorId: note.authorId ?? null,
      authorName: normalizeOptionalText(note.authorName) ?? "Admin",
    }))
    .filter((note) => note.text.length > 0);
}

function normalizeCardNotes(notes: CustomerCardNote[] | undefined): CustomerCardNote[] | undefined {
  if (notes === undefined) return undefined;
  return notes.map<CustomerCardNote>((note) => ({
    ...note,
    title: normalizeText(note.title) || "Untitled note",
    content: normalizeText(note.content),
    authorId: note.authorId ?? null,
    authorName: normalizeOptionalText(note.authorName) ?? "Admin",
    status: note.status ?? "active",
  }));
}

function normalizeCleaningDays(days: CleaningDayPreference[] | undefined): CleaningDayPreference[] {
  return (days ?? []).map<CleaningDayPreference>((day) => ({
    ...day,
    optimalStartTime: day.optimalStartTime ?? day.startTime ?? "09:00",
    optimalEndTime: day.optimalEndTime ?? day.endTime ?? "12:00",
    acceptableStartTime: day.acceptableStartTime ?? day.startTime ?? "08:00",
    acceptableEndTime: day.acceptableEndTime ?? day.endTime ?? "15:00",
  }));
}

function normalizeSchedulingPreferences(
  prefs: CustomerSchedulingPreferences | undefined,
): CustomerSchedulingPreferences | undefined {
  if (prefs === undefined) return undefined;
  return normalizeSchedulingPreferencesV2({
    ...prefs,
    preferredDays: normalizeCleaningDays(prefs.preferredDays),
    secondaryDays: normalizeCleaningDays(prefs.secondaryDays),
    absencePriority: normalizeAbsencePriority(prefs.absencePriority, prefs.absenceHandling),
    temporaryReschedulingPriority: normalizeAbsencePriority(
      prefs.temporaryReschedulingPriority ?? prefs.absencePriority,
      prefs.absenceHandling,
    ),
    schedulingNotes: normalizeText(prefs.schedulingNotes ?? ""),
    updatedAt: normalizeOptionalText(prefs.updatedAt) ?? new Date().toISOString(),
  });
}

async function requireCompanyUuid(companyId: string): Promise<string> {
  const normalizedCompanyId = companyId.trim();
  if (!normalizedCompanyId) throw new Error("Customer save requires a company context.");
  const companyMap = await loadCompanyUuidMap();
  const uuid = companyMap.get(normalizedCompanyId) ?? null;
  if (!uuid) {
    throw new Error(`No Supabase company found for customer company "${normalizedCompanyId}".`);
  }
  return uuid;
}

function customerToUpsertRow(customer: Customer, companyUuid: string): CustomerUpsertRow {
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
    deleted_at: null,
    data: customer,
  };
}

async function upsertCustomer(customer: Customer, companyUuid: string): Promise<Customer> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const { error } = await supabase
    .from("customers")
    .upsert([customerToUpsertRow(customer, companyUuid)], { onConflict: "legacy_id" });
  if (error) throw new Error(`[customers] Supabase customer write failed: ${error.message}`);
  return customer;
}

/**
 * Fetches the company-scoped summary rows. The optional company scope mirrors
 * the localStorage adapter: when `companyId` is omitted, all (RLS-visible) rows
 * are returned; otherwise only the matching `company_legacy_id`.
 */
async function fetchScopedSummaries(
  companyId: string | null | undefined,
  options: CustomerListReadOptions = {},
): Promise<CustomerSummaryRow[]> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  // Exclude soft-deleted rows (deleted_at set) so removed customers never
  // resurface under authoritative reads.
  let query = supabase.from("customers").select(SUMMARY_COLUMNS).is("deleted_at", null);
  if (companyId !== undefined && companyId !== null) {
    query = query.eq("company_legacy_id", companyId);
  }
  const { data, error } = await query;
  if (error) {
    throw new Error(`[customers] Supabase list failed: ${error.message}`);
  }
  const rows = (data ?? []) as unknown as CustomerSummaryRow[];
  return options.includeArchived ? rows : rows.filter((row) => row.status !== "archived");
}

/**
 * Allocates the next durable, company-scoped customer number from the database.
 *
 * The database is the SINGLE authority for visible customer numbers (NUM-1):
 * `allocate_number` atomically consumes and returns the next value of this
 * company's `customer` series, so there is no MAX(existing)+1, no read-then-write
 * race, and no localStorage/front-end calculation. A consumed number is never
 * reused — deleting or archiving a customer never frees its number — so the
 * returned value only ever moves forward and gaps are intentional. The stored
 * format stays `C-<number>` (e.g. "C-1"); display strips the prefix.
 *
 * Allocation is performed just before the insert, after the company and inputs
 * are validated, to minimise burned numbers. If the subsequent insert fails the
 * number is still consumed (never reissued) — the correct no-reuse behaviour.
 */
async function allocateCustomerNumber(companyId: string): Promise<string> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const { data, error } = await supabase.rpc("allocate_number", {
    p_company_scope: companyId,
    p_entity_kind: CUSTOMER_NUMBER_ENTITY_KIND,
  });
  if (error) {
    throw new Error(`[customers] Customer number allocation failed: ${error.message}`);
  }
  const issued = Number(data);
  if (!Number.isInteger(issued) || issued < 1) {
    throw new Error(
      `[customers] Customer number allocation returned an invalid value: ${String(data)}`,
    );
  }
  return `C-${issued}`;
}

async function getCustomerFromSupabaseForExactScope(
  customerId: string,
  companyId: string,
): Promise<Customer | null> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const { data, error } = await supabase
    .from("customers")
    .select("data, company_legacy_id, deleted_at")
    .eq("legacy_id", customerId)
    .maybeSingle();
  if (error) throw new Error(`[customers] Supabase detail failed: ${error.message}`);
  if (!data) return null;
  const row = data as unknown as CustomerDetailRow;
  if (row.deleted_at) return null;
  if (row.company_legacy_id !== companyId) return null;
  return row.data ?? null;
}

export const supabaseCustomerRepository: CustomerRepository = {
  async listSummaries(params: CustomerListParams = {}) {
    const stop = perf.start("customers.list.supabase.summaries");
    try {
      const rows = await fetchScopedSummaries(params.companyId);
      const searched = applySearch(rows, params.search).map(rowToSummary);
      return paginate(searched, params.page, params.pageSize);
    } finally {
      stop();
    }
  },

  async getDetail(id: string, params: DetailParams = {}) {
    if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
    const { data, error } = await supabase
      .from("customers")
      .select("data, company_legacy_id")
      .eq("legacy_id", id)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) {
      throw new Error(`[customers] Supabase detail failed: ${error.message}`);
    }
    if (!data) return null;
    const row = data as unknown as CustomerDetailRow;
    if (params.companyId !== undefined && row.company_legacy_id !== params.companyId) {
      return null;
    }
    return row.data;
  },

  async search(params: CustomerListParams) {
    return this.listSummaries(params);
  },

  async count(params: CountParams = {}) {
    const rows = await fetchScopedSummaries(params.companyId);
    return applySearch(rows, params.search).length;
  },
};

/** Shape of a full customer row used for the Wave 1B list read path. */
interface CustomerFullRow {
  data: Customer;
  company_legacy_id: string;
}

/**
 * Lists FULL customer records (the lossless `data` jsonb) for a company scope.
 *
 * Company scope mirrors the localStorage adapter: omit `companyId` for all
 * RLS-visible rows, or pass an app-facing id to filter on `company_legacy_id`.
 */
export async function listFullCustomersFromSupabase(
  companyId?: string | null,
  options: CustomerListReadOptions = {},
): Promise<Customer[]> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("customers.list.supabase.full");
  perf.count("customers.list.supabase.full.calls");
  try {
    let query = supabase
      .from("customers")
      .select("data, company_legacy_id")
      .is("deleted_at", null);
    if (companyId !== undefined && companyId !== null) {
      query = query.eq("company_legacy_id", companyId);
    }
    const { data, error } = await query;
    if (error) {
      throw new Error(`[customers] Supabase full list failed: ${error.message}`);
    }
    const rows = (data ?? []) as unknown as CustomerFullRow[];
    const customers = rows.map((r) => r.data).filter((c): c is Customer => Boolean(c));
    return options.includeArchived
      ? customers
      : customers.filter((customer) => customer.status !== "archived");
  } finally {
    stop();
  }
}

/** Creates one company-scoped Supabase-authoritative customer row. */
export async function createCustomerInSupabase(
  input: SupabaseCustomerCreateInput,
): Promise<Customer> {
  const companyId = normalizeText(input.companyId);
  const companyUuid = await requireCompanyUuid(companyId);
  const name = normalizeText(input.name);
  const email = normalizeText(input.email);
  if (!name) throw new Error("Customer name is required.");
  if (!email) throw new Error("Customer email is required.");
  if (!input.customerType) throw new Error("Customer type is required.");

  const now = new Date().toISOString();
  const customer: Customer = {
    id: makeId("cust"),
    companyId,
    name,
    customerNumber: await allocateCustomerNumber(companyId),
    email,
    status: "active",
    customerType: input.customerType,
    customerSegment: segmentForCustomerType(input.customerType),
    orgNumber: normalizeOptionalText(input.orgNumber),
    phone: normalizeOptionalText(input.phone),
    onboardingStatus: input.startOnboarding ? "in_progress" : undefined,
    onboardingStartedAt: input.startOnboarding ? now : undefined,
    areaId: normalizeNullableRef(input.areaId),
    area: normalizeOptionalText(input.area),
    postalCityId: normalizeNullableRef(input.postalCityId),
    ownerId: normalizeNullableRef(input.ownerId),
    userIds: [...(input.userIds ?? [])],
    createdAt: now,
    updatedAt: now,
  };
  customer.contacts = [buildDefaultContact(customer, makeId("con"))];

  return upsertCustomer(customer, companyUuid);
}

/** Updates one existing company-scoped Supabase-authoritative customer row. */
export async function updateCustomerInSupabase(
  companyId: string,
  customerId: string,
  patch: SupabaseCustomerUpdatePatch,
): Promise<Customer> {
  const normalizedCompanyId = normalizeText(companyId);
  const normalizedCustomerId = normalizeText(customerId);
  if (!normalizedCustomerId) throw new Error("Customer update requires a customer id.");
  const companyUuid = await requireCompanyUuid(normalizedCompanyId);
  const existing = await getCustomerFromSupabaseForExactScope(
    normalizedCustomerId,
    normalizedCompanyId,
  );
  if (!existing) throw new Error("Customer not found in Supabase for this scope.");

  const normalizedPatch: SupabaseCustomerUpdatePatch = { ...patch };
  if (normalizedPatch.name !== undefined) {
    normalizedPatch.name = normalizeText(normalizedPatch.name);
    if (!normalizedPatch.name) throw new Error("Customer name is required.");
  }
  if (normalizedPatch.email !== undefined) {
    normalizedPatch.email = normalizeText(normalizedPatch.email);
    if (!normalizedPatch.email) throw new Error("Customer email is required.");
  }
  if ("orgNumber" in normalizedPatch) normalizedPatch.orgNumber = normalizeOptionalText(normalizedPatch.orgNumber);
  if ("phone" in normalizedPatch) normalizedPatch.phone = normalizeOptionalText(normalizedPatch.phone);
  if ("areaId" in normalizedPatch) normalizedPatch.areaId = normalizeNullableRef(normalizedPatch.areaId);
  if ("area" in normalizedPatch) normalizedPatch.area = normalizeOptionalText(normalizedPatch.area);
  if ("postalCityId" in normalizedPatch) normalizedPatch.postalCityId = normalizeNullableRef(normalizedPatch.postalCityId);
  if ("ownerId" in normalizedPatch) normalizedPatch.ownerId = normalizeNullableRef(normalizedPatch.ownerId);
  if ("mainContact" in normalizedPatch) normalizedPatch.mainContact = normalizeOptionalText(normalizedPatch.mainContact);
  if ("tags" in normalizedPatch) normalizedPatch.tags = normalizeTags(normalizedPatch.tags);
  if ("addresses" in normalizedPatch) normalizedPatch.addresses = normalizeAddresses(normalizedPatch.addresses);
  if ("contacts" in normalizedPatch) normalizedPatch.contacts = normalizeContacts(normalizedPatch.contacts);
  if ("internalNotes" in normalizedPatch) normalizedPatch.internalNotes = normalizeInternalNotes(normalizedPatch.internalNotes);
  if ("cardNotes" in normalizedPatch) normalizedPatch.cardNotes = normalizeCardNotes(normalizedPatch.cardNotes);
  if ("schedulingPreferences" in normalizedPatch) {
    normalizedPatch.schedulingPreferences = normalizeSchedulingPreferences(
      normalizedPatch.schedulingPreferences,
    );
  }

  const updated: Customer = {
    ...existing,
    ...normalizedPatch,
    companyId: normalizedCompanyId,
    id: existing.id,
    customerNumber: existing.customerNumber,
    status: existing.status,
    customerSegment:
      normalizedPatch.customerType !== undefined
        ? segmentForCustomerType(normalizedPatch.customerType)
        : existing.customerSegment,
    userIds: normalizedPatch.userIds !== undefined ? [...normalizedPatch.userIds] : existing.userIds,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };

  return upsertCustomer(updated, companyUuid);
}

/** Archives one existing company-scoped customer while preserving every dependent record. */
async function updateCustomerLifecycleInSupabase(params: {
  companyId: string;
  customerId: string;
  nextStatus: "active" | "archived";
  actionLabel: "archive" | "restore";
}): Promise<Customer> {
  const normalizedCompanyId = normalizeText(params.companyId);
  const normalizedCustomerId = normalizeText(params.customerId);
  if (!normalizedCustomerId) throw new Error(`Customer ${params.actionLabel} requires a customer id.`);
  const companyUuid = await requireCompanyUuid(normalizedCompanyId);
  const existing = await getCustomerFromSupabaseForExactScope(
    normalizedCustomerId,
    normalizedCompanyId,
  );
  if (!existing) throw new Error("Customer not found in Supabase for this scope.");

  const now = new Date().toISOString();
  const changed: Customer = {
    ...existing,
    companyId: normalizedCompanyId,
    id: existing.id,
    status: params.nextStatus,
    archivedAt: params.nextStatus === "archived" ? now : null,
    updatedAt: now,
  };
  const row = customerToUpsertRow(changed, companyUuid);
  const { error } = await (supabase!
    .from("customers")
    .update(row)
    .eq("legacy_id", normalizedCustomerId)
    .eq("company_legacy_id", normalizedCompanyId)
    .is("deleted_at", null) as unknown as CustomerUpdateQueryBuilder);
  if (error) {
    throw new Error(
      `[customers] Supabase customer ${params.actionLabel} failed: ${error.message}`,
    );
  }
  return changed;
}

/** Archives one existing company-scoped customer while preserving every dependent record. */
export async function archiveCustomerInSupabase(
  companyId: string,
  customerId: string,
): Promise<Customer> {
  return updateCustomerLifecycleInSupabase({
    companyId,
    customerId,
    nextStatus: "archived",
    actionLabel: "archive",
  });
}

/** Restores one archived company-scoped customer without changing dependent records. */
export async function restoreCustomerInSupabase(
  companyId: string,
  customerId: string,
): Promise<Customer> {
  return updateCustomerLifecycleInSupabase({
    companyId,
    customerId,
    nextStatus: "active",
    actionLabel: "restore",
  });
}
