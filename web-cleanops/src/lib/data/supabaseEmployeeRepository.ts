/**
 * Supabase-backed EmployeeRepository (P7C · EMP-1).
 *
 * The THIRD real server implementation of a query-layer contract (after
 * customers + work orders). It reads the `employees` table created in migration
 * 0010 and returns the SAME DTOs the localStorage adapter returns, so a later
 * wave (EMP-2/EMP-3) can swap this in behind the {@link EmployeeRepository}
 * interface with no UI change.
 *
 * EMP-1 scope — this is NOT wired into any page, and the Schedule resolver /
 * assignment logic are untouched. localStorage remains the source of truth. This
 * repository exists so the migration utility and the shadow-read validator can
 * exercise the real server path and prove parity.
 *
 * Behaviour parity:
 *   To keep shadow-read diffs clean, scoping / search / pagination mirror the
 *   localStorage adapter exactly — scope by the app-facing `company_legacy_id`,
 *   apply the shared search-threshold policy over name/email/title, then
 *   paginate. Soft-deleted rows (`deleted_at` set) are filtered out (WO-5.6
 *   convention). Server-side `ilike`/range pagination is a cut-over-time
 *   optimisation, intentionally deferred so EMP-1 changes no observable
 *   behaviour.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { evaluateSearchThreshold } from "@/lib/searchThreshold";
import { perf } from "@/lib/perf";
import type { Employee } from "@/types";
import type { EmployeeListParams, EmployeeRepository } from "./contracts";
import { loadCompanyUuidMap } from "./customerMigration";
import type {
  CountParams,
  DetailParams,
  ListResult,
  EmployeeSummary,
} from "./types";

/** Columns selected for a lightweight summary list (no `data` jsonb). */
const SUMMARY_COLUMNS =
  "legacy_id, company_legacy_id, name, email, title, status, team_ids, user_legacy_id, deleted_at";

/**
 * Entity-kind key for the company-scoped STAFF visible-number series in
 * `number_counters` (NUM-1 Phase 3). The Employees/Team page shows one clean
 * numeric Staff ID per person; the database is the single authority for the
 * value via `allocate_number`. Employee records and profile-only logins share
 * this same series so the page never shows two people with the same number.
 */
const STAFF_NUMBER_ENTITY_KIND = "staff";

/** Shape of the flat summary columns returned by Supabase. */
interface EmployeeSummaryRow {
  legacy_id: string;
  company_legacy_id: string;
  name: string;
  email: string | null;
  title: string | null;
  status: string;
  team_ids: string[] | null;
  user_legacy_id: string | null;
  deleted_at: string | null;
}

/** Shape of a full employee row (the lossless `data` jsonb + scope/soft-delete). */
interface EmployeeDetailRow {
  data: Employee;
  company_legacy_id: string;
  deleted_at: string | null;
}

interface EmployeeUpsertRow {
  legacy_id: string;
  company_id: string | null;
  company_legacy_id: string;
  name: string;
  email: string;
  title: string | null;
  status: string;
  team_ids: string[];
  user_legacy_id: string | null;
  postal_city_id: string | null;
  language_id: string | null;
  deleted_at: string | null;
  data: Employee;
  /**
   * Bare-integer Staff ID, issued ONCE at create time by the allocator. Present
   * only on the create payload so an update upsert never overwrites it (the
   * column is omitted from the update SET clause when absent).
   */
  staff_number?: number;
}

export interface SupabaseEmployeeCreateInput {
  companyId: string;
  name: string;
  email: string;
  title?: string;
  phone?: string;
  iceNumber?: string;
  address?: string;
  postalCityId?: string;
  teamIds: string[];
  userId?: string | null;
  languageId?: string | null;
  secondLanguageId?: string | null;
  availability?: Employee["availability"];
  acceptableHours?: Employee["acceptableHours"];
  preferredHours?: Employee["preferredHours"];
}

export type SupabaseEmployeeUpdatePatch = Partial<
  Pick<
    Employee,
    | "name"
    | "email"
    | "title"
    | "phone"
    | "iceNumber"
    | "address"
    | "postalCityId"
    | "teamIds"
    | "userId"
    | "languageId"
    | "secondLanguageId"
    | "availability"
    | "acceptableHours"
    | "preferredHours"
  >
>;

function rowToSummary(row: EmployeeSummaryRow): EmployeeSummary {
  return {
    id: row.legacy_id,
    companyId: row.company_legacy_id,
    name: row.name,
    email: row.email ?? "",
    title: row.title ?? undefined,
    status: row.status as EmployeeSummary["status"],
    teamCount: row.team_ids?.length ?? 0,
    hasLogin: Boolean(row.user_legacy_id),
  };
}

/** Thrown when the repository is used but Supabase is not configured. */
class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "SupabaseEmployeeRepository requires Supabase. Set EXPO_PUBLIC_SUPABASE_URL " +
        "and EXPO_PUBLIC_SUPABASE_ANON_KEY.",
    );
    this.name = "SupabaseNotConfiguredError";
  }
}

function applySearch(
  rows: EmployeeSummaryRow[],
  rawSearch: string | undefined,
): EmployeeSummaryRow[] {
  const { activeQuery, shouldSearch } = evaluateSearchThreshold(rawSearch ?? "");
  if (!shouldSearch) return rows;
  const needle = activeQuery.toLowerCase();
  return rows.filter((r) =>
    [r.name, r.email, r.title].some((f) => (f ?? "").toLowerCase().includes(needle)),
  );
}

function paginate(
  all: EmployeeSummary[],
  page?: number,
  pageSize?: number,
): ListResult<EmployeeSummary> {
  const total = all.length;
  if (!pageSize || pageSize <= 0) {
    return { items: all, total, page: 1, pageSize: total };
  }
  const safePage = page && page > 0 ? page : 1;
  const start = (safePage - 1) * pageSize;
  return { items: all.slice(start, start + pageSize), total, page: safePage, pageSize };
}

function makeEmployeeId(): string {
  return `emp_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

function normalizeOptionalText(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeNullableRef(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeOptionalRef(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : undefined;
}

function employeeToUpsertRow(
  employee: Employee,
  companyUuid: string,
  staffNumber?: number,
): EmployeeUpsertRow {
  const row: EmployeeUpsertRow = {
    legacy_id: employee.id,
    company_id: companyUuid,
    company_legacy_id: employee.companyId,
    name: employee.name,
    email: employee.email ?? "",
    title: normalizeNullableRef(employee.title),
    status: employee.status,
    team_ids: employee.teamIds ?? [],
    user_legacy_id: normalizeNullableRef(employee.userId),
    postal_city_id: normalizeNullableRef(employee.postalCityId),
    language_id: normalizeNullableRef(employee.languageId),
    deleted_at: null,
    data: employee,
  };
  // Only set the column on create; omitting it on update keeps it out of the
  // upsert SET clause so an existing Staff ID is never clobbered.
  if (staffNumber !== undefined) row.staff_number = staffNumber;
  return row;
}

async function requireCompanyUuid(companyId: string): Promise<string> {
  const normalizedCompanyId = companyId.trim();
  if (!normalizedCompanyId) {
    throw new Error("Employee save requires a company context.");
  }
  const companyMap = await loadCompanyUuidMap();
  const uuid = companyMap.get(normalizedCompanyId) ?? null;
  if (!uuid) {
    throw new Error(`No Supabase company found for employee company "${normalizedCompanyId}".`);
  }
  return uuid;
}

async function assertUniqueEmail(
  companyId: string,
  email: string,
  excludeEmployeeId?: string,
): Promise<void> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return;
  const employees = await listFullEmployeesFromSupabase(companyId);
  const duplicate = employees.some(
    (employee) =>
      employee.id !== excludeEmployeeId &&
      employee.companyId === companyId &&
      employee.email.trim().toLowerCase() === normalized,
  );
  if (duplicate) {
    throw new Error("An employee with this email already exists.");
  }
}

async function upsertEmployee(
  employee: Employee,
  companyUuid: string,
  staffNumber?: number,
): Promise<Employee> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const { error } = await supabase
    .from("employees")
    .upsert([employeeToUpsertRow(employee, companyUuid, staffNumber)], { onConflict: "legacy_id" });
  if (error) {
    throw new Error(`[employees] Supabase employee write failed: ${error.message}`);
  }
  return employee;
}

/**
 * Allocates the next durable, company-scoped Staff ID from the database.
 *
 * The database is the SINGLE authority for visible staff numbers (NUM-1):
 * `allocate_number` atomically consumes and returns the next value of this
 * company's `staff` series, so there is no MAX(existing)+1, no read-then-write
 * race, and no localStorage/front-end calculation. A consumed number is never
 * reused — deleting or archiving an employee never frees its number. Stored as a
 * bare integer; the page displays it verbatim with no prefix.
 */
async function allocateStaffNumber(companyId: string): Promise<number> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const { data, error } = await supabase.rpc("allocate_number", {
    p_company_scope: companyId,
    p_entity_kind: STAFF_NUMBER_ENTITY_KIND,
  });
  if (error) {
    throw new Error(`[employees] Staff number allocation failed: ${error.message}`);
  }
  const issued = Number(data);
  if (!Number.isInteger(issued) || issued < 1) {
    throw new Error(
      `[employees] Staff number allocation returned an invalid value: ${String(data)}`,
    );
  }
  return issued;
}

/** Shape of the flat staff-number lookup row (Employees page Staff ID column). */
interface EmployeeStaffNumberRow {
  legacy_id: string;
  email: string | null;
  staff_number: number | null;
  deleted_at: string | null;
}

/** A resolved Staff ID for one employee, keyed for display lookups. */
export interface EmployeeStaffNumber {
  legacyId: string;
  email: string;
  staffNumber: number;
}

/**
 * Lists the issued Staff IDs for a company's active employee records so the
 * Employees/Team page can render a clean numeric Staff ID for every row without
 * pulling the full `data` jsonb. Read-only; soft-deleted and un-numbered rows
 * are skipped. Company scope mirrors the rest of this repository.
 */
export async function listEmployeeStaffNumbers(
  companyId?: string | null,
): Promise<EmployeeStaffNumber[]> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  let query = supabase.from("employees").select("legacy_id, email, staff_number, deleted_at");
  if (companyId !== undefined && companyId !== null) {
    query = query.eq("company_legacy_id", companyId);
  }
  const { data, error } = await query;
  if (error) {
    throw new Error(`[employees] Supabase staff-number list failed: ${error.message}`);
  }
  const rows = (data ?? []) as unknown as EmployeeStaffNumberRow[];
  return rows
    .filter((r) => !r.deleted_at && typeof r.staff_number === "number")
    .map((r) => ({
      legacyId: r.legacy_id,
      email: (r.email ?? "").trim().toLowerCase(),
      staffNumber: r.staff_number as number,
    }));
}

/**
 * Fetches the company-scoped summary rows. The optional company scope mirrors
 * the localStorage adapter: when `companyId` is omitted, all (RLS-visible) rows
 * are returned; otherwise only the matching `company_legacy_id`. Soft-deleted
 * rows are filtered out (WO-5.6 convention).
 */
async function fetchScopedSummaries(
  companyId: string | null | undefined,
): Promise<EmployeeSummaryRow[]> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  let query = supabase.from("employees").select(SUMMARY_COLUMNS);
  if (companyId !== undefined && companyId !== null) {
    query = query.eq("company_legacy_id", companyId);
  }
  const { data, error } = await query;
  if (error) {
    throw new Error(`[employees] Supabase list failed: ${error.message}`);
  }
  const rows = (data ?? []) as unknown as EmployeeSummaryRow[];
  // EMP-1: a soft-deleted (removed) employee never appears in active queries.
  return rows.filter((r) => !r.deleted_at);
}

export const supabaseEmployeeRepository: EmployeeRepository = {
  async listSummaries(params: EmployeeListParams = {}) {
    const stop = perf.start("employees.list.supabase.summaries");
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
      .from("employees")
      .select("data, company_legacy_id, deleted_at")
      .eq("legacy_id", id)
      .maybeSingle();
    if (error) {
      throw new Error(`[employees] Supabase detail failed: ${error.message}`);
    }
    if (!data) return null;
    const row = data as unknown as EmployeeDetailRow;
    // EMP-1: a soft-deleted (removed) employee reads as absent.
    if (row.deleted_at) return null;
    if (params.companyId !== undefined && row.company_legacy_id !== params.companyId) {
      return null;
    }
    return row.data ?? null;
  },

  async search(params: EmployeeListParams) {
    return this.listSummaries(params);
  },

  async count(params: CountParams = {}) {
    const rows = await fetchScopedSummaries(params.companyId);
    return applySearch(rows, params.search).length;
  },
};

/** Shape of a full employee row used for a future list read path (EMP-2). */
interface EmployeeFullRow {
  data: Employee;
  company_legacy_id: string;
  deleted_at: string | null;
}

/**
 * Lists FULL employee records (the lossless `data` jsonb) for a company scope.
 *
 * EMP-2 (future): the Employees list page renders rich fields (phone, address,
 * city, language) that are intentionally NOT part of {@link EmployeeSummary}. To
 * switch the list's READ source to Supabase without any visible behaviour
 * change, this returns the same full {@link Employee} objects the page reads from
 * localStorage today. Search/pagination/sorting stay in the page (unchanged);
 * this function only moves where the rows come from. Defined here in EMP-1 so the
 * shadow-read validator can exercise the real full-record path.
 *
 * Company scope mirrors the localStorage adapter: omit `companyId` for all
 * RLS-visible rows, or pass an app-facing id to filter on `company_legacy_id`.
 */
export async function listFullEmployeesFromSupabase(
  companyId?: string | null,
): Promise<Employee[]> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("employees.list.supabase.full");
  perf.count("employees.list.supabase.full.calls");
  try {
    let query = supabase.from("employees").select("data, company_legacy_id, deleted_at");
    if (companyId !== undefined && companyId !== null) {
      query = query.eq("company_legacy_id", companyId);
    }
    const { data, error } = await query;
    if (error) {
      throw new Error(`[employees] Supabase full list failed: ${error.message}`);
    }
    const rows = (data ?? []) as unknown as EmployeeFullRow[];
    return rows
      .filter((r) => !r.deleted_at)
      .map((r) => r.data)
      .filter((e): e is Employee => Boolean(e));
  } finally {
    stop();
  }
}

/** Creates one company-scoped employee row in Supabase and returns the saved record. */
export async function createEmployeeInSupabase(
  input: SupabaseEmployeeCreateInput,
): Promise<Employee> {
  const companyId = input.companyId.trim();
  const name = input.name.trim();
  const email = input.email.trim();
  if (!companyId) throw new Error("Employee save requires a company context.");
  if (!name || !email) throw new Error("Name and email are required.");

  const companyUuid = await requireCompanyUuid(companyId);
  await assertUniqueEmail(companyId, email);

  // Issue the durable Staff ID just before the insert (after validation), so a
  // failed validation never burns a number. The allocator is the sole authority.
  const staffNumber = await allocateStaffNumber(companyId);

  const employee: Employee = {
    id: makeEmployeeId(),
    companyId,
    name,
    email,
    title: normalizeOptionalText(input.title),
    phone: normalizeOptionalText(input.phone),
    iceNumber: normalizeOptionalText(input.iceNumber),
    address: normalizeOptionalText(input.address),
    postalCityId: normalizeOptionalRef(input.postalCityId),
    status: "active",
    teamIds: Array.isArray(input.teamIds) ? input.teamIds : [],
    userId: normalizeNullableRef(input.userId),
    languageId: normalizeNullableRef(input.languageId),
    secondLanguageId: normalizeNullableRef(input.secondLanguageId),
    availability: input.availability,
    acceptableHours: input.acceptableHours,
    preferredHours: input.preferredHours,
    createdAt: new Date().toISOString(),
  };

  return upsertEmployee(employee, companyUuid, staffNumber);
}

/** Updates one existing company-scoped employee row in Supabase and returns it. */
export async function updateEmployeeInSupabase(
  companyId: string,
  employeeId: string,
  patch: SupabaseEmployeeUpdatePatch,
): Promise<Employee> {
  const normalizedCompanyId = companyId.trim();
  const normalizedEmployeeId = employeeId.trim();
  if (!normalizedCompanyId) throw new Error("Employee save requires a company context.");
  if (!normalizedEmployeeId) throw new Error("Employee update requires an employee id.");

  const existing = await supabaseEmployeeRepository.getDetail(normalizedEmployeeId, {
    companyId: normalizedCompanyId,
  });
  if (!existing) {
    throw new Error("Employee not found in Supabase for this company.");
  }
  const companyUuid = await requireCompanyUuid(normalizedCompanyId);

  if (patch.email !== undefined) {
    const nextEmail = patch.email.trim();
    if (!nextEmail) throw new Error("Name and email are required.");
    await assertUniqueEmail(normalizedCompanyId, nextEmail, normalizedEmployeeId);
  }

  const normalizedPatch: SupabaseEmployeeUpdatePatch = { ...patch };
  if ("name" in normalizedPatch && normalizedPatch.name !== undefined) {
    normalizedPatch.name = normalizedPatch.name.trim();
    if (!normalizedPatch.name) throw new Error("Name and email are required.");
  }
  if ("email" in normalizedPatch && normalizedPatch.email !== undefined) {
    normalizedPatch.email = normalizedPatch.email.trim();
  }
  if ("title" in normalizedPatch) normalizedPatch.title = normalizeOptionalText(normalizedPatch.title);
  if ("phone" in normalizedPatch) normalizedPatch.phone = normalizeOptionalText(normalizedPatch.phone);
  if ("iceNumber" in normalizedPatch) {
    normalizedPatch.iceNumber = normalizeOptionalText(normalizedPatch.iceNumber);
  }
  if ("address" in normalizedPatch) {
    normalizedPatch.address = normalizeOptionalText(normalizedPatch.address);
  }
  if ("postalCityId" in normalizedPatch) {
    normalizedPatch.postalCityId = normalizeOptionalRef(normalizedPatch.postalCityId);
  }
  if ("userId" in normalizedPatch) normalizedPatch.userId = normalizeNullableRef(normalizedPatch.userId);
  if ("languageId" in normalizedPatch) {
    normalizedPatch.languageId = normalizeNullableRef(normalizedPatch.languageId);
  }
  if ("secondLanguageId" in normalizedPatch) {
    normalizedPatch.secondLanguageId = normalizeNullableRef(normalizedPatch.secondLanguageId);
  }
  if ("teamIds" in normalizedPatch) {
    normalizedPatch.teamIds = Array.isArray(normalizedPatch.teamIds) ? normalizedPatch.teamIds : [];
  }

  const updated: Employee = { ...existing, ...normalizedPatch, companyId: normalizedCompanyId };
  return upsertEmployee(updated, companyUuid);
}
