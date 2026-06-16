/**
 * Employees migration DESIGN & CONTRACT AUDIT (P7A). Design-only.
 *
 * Customers, Work Orders and the Schedule INPUT migration tracks are all closed
 * (wave1.closure / workorders.cutover / schedule.closure blueprints). Employees
 * are the next entity. Unlike Work Orders they are a FLAT, low-risk reference
 * entity: a single record per person with no nested schedule-critical
 * collections. The Schedule consumes employees as a NAME LOOKUP only — the
 * occurrence-driving assignment (assignedEmployeeIds / slots) already lives on
 * the migrated work_order_service_rows, NOT on the employee. That makes this the
 * cleanest track since Customers.
 *
 * This file is the single typed record of:
 *   • the current Employee model (core vs. detail vs. lookup-link fields),
 *   • every read and write path (incl. the linked-login User side-effect),
 *   • the EXACT Schedule dependency (lookup-only — no occurrence logic),
 *   • the Time Reports / Activity dependencies that stay DEFERRED,
 *   • the summary/detail contract status (DTOs already exist from Wave 0),
 *   • the future Supabase schema (single table + jsonb for the working schedule),
 *   • the migration wave plan + ranked risks.
 *
 * Nothing here runs, queries, creates tables, migrates data, or changes
 * behaviour. No UI is switched. Assignment logic, Schedule logic and employee
 * workflows are untouched. Activity Log and Time Reports are explicitly NOT
 * migrated here. This is the blueprint the EMP-0..EMP-6 waves build against.
 *
 * Grounded in the real code:
 *  - Domain model: `Employee`, `EmployeeWorkingScheduleDay` in `@/types`.
 *  - DTOs already exist: `EmployeeSummary` / `EmployeeDetail` (lib/data/types.ts),
 *    `EmployeeRepository` / `EmployeeListParams` (lib/data/contracts.ts).
 *  - localStorage adapter already implemented + parity-checked: the `employees`
 *    repository in `localStorageAdapters.ts`; `parity.ts` Employees block.
 *  - Single write seam: `persistEmployees` in `AppContext` (createEmployee,
 *    updateEmployee and the Employees-page active/inactive toggle all funnel
 *    here), with a bidirectional `persistUsers` side-effect for linked logins.
 *  - Schedule: employees enter `resolveScheduleProgram` only as id→name lookup
 *    (see schedule.closure.blueprint SCHEDULE_SOURCE_MAP "employees[] … lookup
 *    only; held constant until the Employees track lands").
 */

import type { RiskLevel } from "./wave1.readiness.blueprint";

// ── Part 1 — Current Employee model audit ─────────────────

/** Field classification for the Employee aggregate (single flat record). */
export type EmployeeFieldClass =
  | "core" // identity / lifecycle; needed in list + everywhere
  | "detail-only" // only the employee profile / edit dialog
  | "lookup-link" // FK-style reference to another entity (own track)
  | "schedule-availability"; // working-schedule baseline (NOT occurrence generation)

export interface EmployeeModelField {
  field: string;
  type: string;
  class: EmployeeFieldClass;
  note: string;
}

/**
 * Field-by-field audit of `Employee`. It is a single flat record — there are NO
 * nested schedule-critical collections (contrast Work Orders' service rows). The
 * only embedded structure is the optional weekly `workingSchedule`, which is an
 * availability baseline, never an occurrence source.
 */
export const EMPLOYEE_MODEL: ReadonlyArray<EmployeeModelField> = [
  { field: "id", type: "string", class: "core", note: "App-facing id (emp_…); becomes legacy_id. Referenced by service-row assignedEmployeeIds + time reports + activity." },
  { field: "companyId", type: "string", class: "core", note: "Tenant scope. Maps to company_id uuid (RLS) + company_legacy_id (query layer)." },
  { field: "name", type: "string", class: "core", note: "Display name; list + the schedule's id→name lookup. Search field." },
  { field: "email", type: "string", class: "core", note: "Unique-per-company (enforced in createEmployee/updateEmployee). Search field." },
  { field: "title", type: "string?", class: "core", note: "Job title; shown in list + summary." },
  { field: "status", type: "EntityStatus", class: "core", note: "active|inactive. Gates assignable employees (e.g. customer owners) — NOT a schedule occurrence gate." },
  { field: "teamIds", type: "string[]", class: "lookup-link", note: "Team membership. Summary carries teamCount only. Team is a separate (future) track." },
  { field: "userId", type: "string | null", class: "lookup-link", note: "Linked login account. Bidirectional sync with User.linkedEmployeeId via persistUsers — see write paths. User/auth is a separate track." },
  { field: "phone", type: "string?", class: "detail-only", note: "Free-text contact; profile only." },
  { field: "address", type: "string?", class: "detail-only", note: "Street line; profile only. Postal code not tracked here." },
  { field: "postalCityId", type: "string?", class: "lookup-link", note: "Controlled PostalCity reference (never free text). PostalCity is a separate reference-data track." },
  { field: "languageId", type: "string | null", class: "lookup-link", note: "Controlled EmployeeLanguage reference; falls back to company default. EmployeeLanguage is a separate track." },
  { field: "workingSchedule", type: "EmployeeWorkingScheduleDay[]?", class: "schedule-availability", note: "Sparse Mon→Sun availability/hours baseline for FUTURE planner checks. Does NOT generate or move bookings. Stays in data jsonb." },
  { field: "createdAt", type: "string", class: "core", note: "Creation timestamp; list ordering + drift checks." },
];

// ── Part 2 — Read path audit ──────────────────────────────

export type EmployeeReadShape = "summary" | "detail" | "lookup" | "count";

export interface EmployeeReadPath {
  surface: string;
  entryPoint: string;
  reads: string;
  shape: EmployeeReadShape;
  scheduleCritical: boolean;
  /** Must stay on in-memory AppContext until its read switch wave lands. */
  mustRemainTemporarily: boolean;
}

/**
 * Every place Employees are read. Today all reads come from the single in-memory
 * `employees` array in AppContext (hydrated by `getEmployees()` at boot);
 * cross-entity surfaces use `employees.find(...)` / a name map against it. None
 * of these reads drive occurrence generation — the Schedule + Booking Queue use
 * employees purely to resolve assignee NAMES for display.
 */
export const EMPLOYEE_READ_PATHS: ReadonlyArray<EmployeeReadPath> = [
  { surface: "Employees list (admin)", entryPoint: "Employees page → employees.filter(company) searched/paged", reads: "name, title, email, phone, address, city, area, language, status, login", shape: "summary", scheduleCritical: false, mustRemainTemporarily: true },
  { surface: "Employee profile / edit dialog", entryPoint: "EmployeeDialog → employee record", reads: "full Employee incl. workingSchedule + lookup links", shape: "detail", scheduleCritical: false, mustRemainTemporarily: true },
  { surface: "Schedule / Schedule Lab", entryPoint: "resolveScheduleProgram input — employees[] held constant", reads: "id → name only (denormalised assignee label)", shape: "lookup", scheduleCritical: false, mustRemainTemporarily: true },
  { surface: "Booking Queue", entryPoint: "employeeNameById map", reads: "id → name for occurrence rows", shape: "lookup", scheduleCritical: false, mustRemainTemporarily: true },
  { surface: "Assign Employees dialog", entryPoint: "AssignEmployeesDialog → active employees in company", reads: "id, name, status (assignable list)", shape: "lookup", scheduleCritical: false, mustRemainTemporarily: true },
  { surface: "Customer owner picker / Customer Card", entryPoint: "Customers + CustomerCard → active employees", reads: "id, name, status (owner candidates) + owner name resolution", shape: "lookup", scheduleCritical: false, mustRemainTemporarily: true },
  { surface: "View-as-employee (portal preview)", entryPoint: "AppContext.startViewAsEmployee → employees.find(id)", reads: "full employee + linked user", shape: "detail", scheduleCritical: false, mustRemainTemporarily: true },
  { surface: "Dashboard counts", entryPoint: "directory aggregates", reads: "employee count by company", shape: "count", scheduleCritical: false, mustRemainTemporarily: true },
  { surface: "Time Reports (DEFERRED track)", entryPoint: "report → employee name resolution", reads: "id → name only", shape: "lookup", scheduleCritical: false, mustRemainTemporarily: true },
];

// ── Part 3 — Write path audit ─────────────────────────────

export interface EmployeeWritePath {
  action: string;
  entryPoint: string;
  affects: string;
  downstream: string;
  risk: RiskLevel;
}

/**
 * Every Employee write. CRITICAL FINDING (mirrors Customers/Work Orders): ALL
 * employee writes funnel through ONE seam — `persistEmployees(next)` in
 * AppContext (setState + saveEmployees). That single choke point is the
 * dual-write attach point. There is NO separate archive/restore/delete mutator:
 * deactivation is just a `status` patch via `updateEmployee` (the Employees-page
 * toggle). The only complication is the LINKED-LOGIN side-effect: changing
 * `userId` also writes Users via `persistUsers` to keep `User.linkedEmployeeId`
 * in sync — that secondary write belongs to the (separate) User/auth track and
 * must NOT be folded into the employee dual-write.
 */
export const EMPLOYEE_WRITE_PATHS: ReadonlyArray<EmployeeWritePath> = [
  { action: "Create employee", entryPoint: "AppContext.createEmployee → persistEmployees([emp, ...])", affects: "new employee row", downstream: "appears in list + assignable pickers; optional linked-login pointer write (persistUsers)", risk: "low" },
  { action: "Update employee (name/title/contact/teams/language/city/schedule)", entryPoint: "AppContext.updateEmployee → persistEmployees(map)", affects: "single employee row", downstream: "list + profile refresh; schedule/booking labels re-resolve by id→name", risk: "low" },
  { action: "Activate / deactivate (status toggle)", entryPoint: "Employees page toggleStatus → updateEmployee({ status }) → persistEmployees", affects: "status field", downstream: "removes/adds from assignable lists (owners, assign dialog); does NOT add/remove schedule occurrences", risk: "low" },
  { action: "Link / unlink login account (userId change)", entryPoint: "AppContext.updateEmployee → persistEmployees + persistUsers", affects: "employee.userId + User.linkedEmployeeId", downstream: "bidirectional pointer kept consistent; User side-effect stays on the User/auth track", risk: "medium" },
  { action: "Email uniqueness guard", entryPoint: "createEmployee / updateEmployee pre-check", affects: "validation only", downstream: "rejects duplicate email within a company before persist", risk: "low" },
];

// ── Part 4 — Schedule dependency map ──────────────────────

export interface EmployeeScheduleDependency {
  field: string;
  critical: boolean;
  consumedBy: string;
}

/**
 * The precise (and intentionally thin) contract between Employees and the
 * Schedule. `resolveScheduleProgram` does NOT read employee records to generate
 * occurrences — assignment lives on the service row (already migrated). The
 * resolver only maps an already-known `assignedEmployeeIds` entry to a display
 * NAME. Therefore NOTHING about an employee is schedule-CRITICAL: a missing or
 * renamed employee changes a label, never the set/time/staffing of occurrences.
 */
export const EMPLOYEE_SCHEDULE_DEPENDENCIES: ReadonlyArray<EmployeeScheduleDependency> = [
  { field: "Employee.id → name", critical: false, consumedBy: "denormalised assignee label on occurrences (lookup only)." },
  { field: "Employee.status", critical: false, consumedBy: "assignable-employee lists (owners, assign dialog) — NOT an occurrence gate." },
  { field: "ServiceRow.assignedEmployeeIds / unassignedEmployeeSlots", critical: true, consumedBy: "OWNED BY work_order_service_rows (already migrated) — the real staffing source, NOT the employee record." },
  { field: "Employee.workingSchedule", critical: false, consumedBy: "FUTURE planner availability checks; no current occurrence logic." },
  { field: "Employee.teamIds / userId / languageId / postalCityId", critical: false, consumedBy: "DETAIL/DIRECTORY only — never touched by the resolver." },
];

// ── Part 5 — Cross-entity dependency audit (deferred) ─────

export type EmployeeDependencyDisposition =
  | "lookup-constant" // held from local store until its own track lands
  | "deferred-track" // explicitly out of scope for the Employees migration
  | "side-effect-other-track"; // a write that belongs to another entity's seam

export interface EmployeeDependencyRow {
  dependency: string;
  disposition: EmployeeDependencyDisposition;
  note: string;
}

/**
 * What the Employees track must hold constant / defer. Activity Log and Time
 * Reports are explicitly NOT migrated in this track (per the prompt). Employees
 * are REFERENCED by them via id, so the legacy_id must remain stable so those
 * future tracks can FK-soft link to it.
 */
export const EMPLOYEE_DEPENDENCY_AUDIT: ReadonlyArray<EmployeeDependencyRow> = [
  { dependency: "Time Reports (employeeId)", disposition: "deferred-track", note: "Time Reports reference employees by id; migrated on their OWN later track. Stable employee legacy_id is the FK-soft link." },
  { dependency: "Activity Log (actor / subject employee)", disposition: "deferred-track", note: "Activity references actors/subjects by id; separate track. No employee-side change here." },
  { dependency: "Work Order service-row assignment (assignedEmployeeIds)", disposition: "lookup-constant", note: "Already migrated on the WO track; stores employee ids. Employee migration must preserve ids exactly so existing assignments keep resolving." },
  { dependency: "Schedule resolver employees[]", disposition: "lookup-constant", note: "Held constant from the local store today; switches to the employee read once EMP-2/3 land — name lookup only." },
  { dependency: "User / auth (userId ↔ linkedEmployeeId)", disposition: "side-effect-other-track", note: "Bidirectional login link. The User write stays on the auth track; the employee dual-write mirrors employee.userId only, never Users." },
  { dependency: "Team (teamIds)", disposition: "deferred-track", note: "Team membership ids stay in the employee row (array column or jsonb); Team entity migrates separately." },
  { dependency: "EmployeeLanguage (languageId)", disposition: "deferred-track", note: "Controlled language reference id preserved; EmployeeLanguage migrates separately." },
  { dependency: "PostalCity (postalCityId)", disposition: "deferred-track", note: "Controlled city reference id preserved; PostalCity reference-data migrates separately." },
];

// ── Part 6 — Summary / detail contract status ─────────────

export interface EmployeeContractProposal {
  contract: string;
  status: "exists" | "extend" | "new";
  fields: ReadonlyArray<string>;
  note: string;
}

/**
 * The DTOs Employees need ALREADY EXIST from Migration Wave 0 (lib/data/types.ts
 * + contracts.ts) and are parity-checked by parity.ts — a major head start over
 * the Work Order track. EMP-0 is therefore validation, not new contract design.
 */
export const EMPLOYEE_CONTRACT_PROPOSALS: ReadonlyArray<EmployeeContractProposal> = [
  { contract: "EmployeeSummary", status: "exists", fields: ["id", "companyId", "name", "email", "title", "status", "teamCount", "hasLogin"], note: "Lightweight list row; excludes workingSchedule/links. Already implemented + parity-checked." },
  { contract: "EmployeeDetail", status: "exists", fields: ["= full Employee incl. workingSchedule + lookup links"], note: "Reconstructed losslessly from data jsonb in later waves; profile/edit dialog." },
  { contract: "EmployeeRepository", status: "exists", fields: ["listSummaries", "getDetail", "search", "count"], note: "Read contract already defined; localStorage adapter implements it. Supabase adapter slots behind the SAME interface." },
  { contract: "EmployeeListParams", status: "exists", fields: ["= base ListParams (company, search, page)"], note: "Base params already sufficient; no status filter needed yet (list shows all, badges status)." },
];

// ── Part 6b — EMP-0 local-adapter parity result (P7B) ─────

export type EmployeeParityVerdict = "validated" | "gap";

export interface EmployeeParityDimension {
  dimension: string;
  verdict: EmployeeParityVerdict;
  note: string;
}

/**
 * EMP-0 result: the dimensions asserted by `validateEmployeeParity()`
 * (lib/data/employeeParity.ts + employeeParity.test.ts) against the existing
 * localStorage adapter. Confirms NO new contract surface is required before the
 * Supabase schema/repository wave (EMP-1). The headline guarantee is `id`
 * stability — existing service-row `assignedEmployeeIds` and the deferred Time
 * Reports / Activity tracks soft-reference the employee by this id.
 */
export const EMPLOYEE_EMP0_PARITY: ReadonlyArray<EmployeeParityDimension> = [
  { dimension: "count", verdict: "validated", note: "listSummaries.total === count() === getEmployees() count (company-scoped + unscoped)." },
  { dimension: "id-set", verdict: "validated", note: "Exact id-set equality — the stability guarantee for service-row assignments + deferred Time Reports." },
  { dimension: "summary fields", verdict: "validated", note: "name / email / title / status / teamCount / hasLogin projected verbatim from the source record." },
  { dimension: "detail (lossless)", verdict: "validated", note: "getDetail deep-equals the full Employee incl. workingSchedule + every lookup-link field." },
  { dimension: "company scope", verdict: "validated", note: "Unknown company → empty; foreign company getDetail → null; no cross-company leak." },
  { dimension: "search", verdict: "validated", note: "Adapter search === reference free-text search over name/email/title (shared threshold policy)." },
  { dimension: "pagination", verdict: "validated", note: "Pages cover every row exactly once; total is the pre-pagination match count." },
  { dimension: "status coverage", verdict: "validated", note: "No implicit status filter — inactive employees stay in the list (status badged, not dropped)." },
];

// ── Part 6c — EMP-1 schema / repository / migration status (P7C) ─

export type EmployeeEmp1Verdict = "ready" | "pending";

export interface EmployeeEmp1Deliverable {
  deliverable: string;
  verdict: EmployeeEmp1Verdict;
  note: string;
}

/**
 * EMP-1 result: the Supabase FOUNDATION for Employees — schema, read repository,
 * migration utility and shadow read — all proven by employeeMigration.test.ts
 * against an in-memory Supabase fake. Single table (mirrors customers 0007) with
 * the WO-5.6 `deleted_at` soft-delete for consistency. NO UI switch, NO Schedule
 * change, NO assignment-logic change; localStorage remains authoritative.
 */
export const EMPLOYEE_EMP1_DELIVERABLES: ReadonlyArray<EmployeeEmp1Deliverable> = [
  { deliverable: "Schema (0010_employees_table.sql)", verdict: "ready", note: "Single table; UUID PK + legacy_id + company_id uuid (RLS) + company_legacy_id; flat name/email/title/status + soft-FK team_ids/user_legacy_id/postal_city_id/language_id; data jsonb (workingSchedule + detail); deleted_at soft-delete." },
  { deliverable: "Indexes", verdict: "ready", note: "(company_id, name) · (company_id, lower(email)) · (company_id, status) · (company_id, created_at desc) · (company_legacy_id, name) · partial active idx where deleted_at is null." },
  { deliverable: "RLS", verdict: "ready", note: "anon none; authenticated own-company read/write (company_id = current_company_id()); super_admin all; no DELETE policy (soft-delete only). Mirrors customers." },
  { deliverable: "SupabaseEmployeeRepository", verdict: "ready", note: "listSummaries / getDetail / search / count — returns EmployeeSummary/EmployeeDetail; scope + search + pagination mirror the localStorage adapter; soft-deleted rows filtered." },
  { deliverable: "migrateEmployees()", verdict: "ready", note: "Dry-run, idempotent (upsert on legacy_id), repeatable; reuses the company uuid map; skips/reports unmapped companies; preserves legacy ids + full payload; surfaces per-company duplicate emails." },
  { deliverable: "shadowReadEmployees()", verdict: "ready", note: "Diffs count / id set / summary (teamCount + hasLogin + status) / lossless detail. Differences surfaced, never ignored." },
];

// ── Part 7 — Future Supabase schema proposal ──────────────

export interface EmployeeTableProposal {
  table: string;
  purpose: string;
  keyFields: ReadonlyArray<string>;
  companyScoped: boolean;
  legacyId: boolean;
  relationships: ReadonlyArray<string>;
  indexes: ReadonlyArray<string>;
  jsonbAcceptable: boolean;
  rls: string;
}

/**
 * Future table (blueprint only — NOT created). Mirrors the customers-table
 * convention exactly (0007_customers_table.sql): UUID PK + `legacy_id` (app id)
 * + real `company_id uuid` FK for RLS + `company_legacy_id` for cheap query-layer
 * scoping, flat indexed columns for list/search, and `data jsonb` for the
 * working schedule + sparse detail. A SINGLE table — Employees have no
 * schedule-critical child rows, so no child tables (contrast Work Orders).
 */
export const EMPLOYEE_TABLES: ReadonlyArray<EmployeeTableProposal> = [
  {
    table: "employees",
    purpose: "Employee directory record; list + profile + the schedule's id→name lookup.",
    keyFields: ["id uuid", "legacy_id text unique", "company_id uuid", "company_legacy_id text", "name", "email", "title", "status", "team_ids text[]", "user_legacy_id text", "postal_city_id text", "language_id text", "data jsonb (workingSchedule + phone/address + sparse detail)", "created_at"],
    companyScoped: true,
    legacyId: true,
    relationships: ["company_id → companies.id", "user_legacy_id → user/profile (soft, auth track)", "postal_city_id / language_id / team_ids → reference entities (soft, own tracks)"],
    indexes: ["(company_id, name)", "(company_id, status, created_at desc)", "(company_id, email)", "(company_legacy_id, name)"],
    jsonbAcceptable: true,
    rls: "Own company read/write (company_id = current_company_id()); super_admin all; no DELETE policy (mirror customers — employee deletion stays blocked under RLS).",
  },
];

/** Child tables explicitly NONE — Employees are a flat record. */
export const EMPLOYEE_DEFERRED_TABLES: ReadonlyArray<{ table: string; reason: string }> = [
  { table: "employee_working_schedule (relational)", reason: "Sparse Mon→Sun availability stays in data jsonb; read/written with the row, no standalone query. Promote only if cross-employee availability queries appear." },
  { table: "employee_teams (junction)", reason: "teamIds is a small array stored as text[]/jsonb; promote to a junction only when team-membership queries/joins are needed (Team track)." },
];

// ── Part 8 — JSONB strategy ───────────────────────────────

export type EmployeeJsonbVerdict = "relational-early" | "jsonb-temporarily";

export interface EmployeeJsonbDecision {
  field: string;
  verdict: EmployeeJsonbVerdict;
  reason: string;
}

/**
 * What is promoted to flat/relational columns early (list / search / RLS / id
 * resolution depend on them) vs. what stays inside `data jsonb` for lossless
 * detail without premature normalisation.
 */
export const EMPLOYEE_JSONB_STRATEGY: ReadonlyArray<EmployeeJsonbDecision> = [
  { field: "company_id / company_legacy_id", verdict: "relational-early", reason: "RLS + every scoped query. Never jsonb." },
  { field: "name / email / status / title", verdict: "relational-early", reason: "List ordering, search, uniqueness guard, assignable-list filtering." },
  { field: "legacy_id", verdict: "relational-early", reason: "The stable id every service-row assignment + future time report references." },
  { field: "team_ids / user_legacy_id / postal_city_id / language_id", verdict: "relational-early", reason: "Cheap FK-soft columns kept flat so future tracks can join without rewriting jsonb." },
  { field: "workingSchedule[]", verdict: "jsonb-temporarily", reason: "Availability baseline resolved with the row; no standalone query yet." },
  { field: "phone / address + sparse detail", verdict: "jsonb-temporarily", reason: "Profile/edit surfaces only; not list/search-critical." },
];

// ── Part 9 — Migration wave plan ──────────────────────────

export interface EmployeeWave {
  id: string;
  title: string;
  scope: string;
  uiSwitch: boolean;
  dependsOn: string;
}

/**
 * The Employee migration waves — the proven Customer pattern (contracts →
 * schema/repository → list read → detail read → dual write → authoritative →
 * closure), with a head start: contracts + the localStorage adapter + parity
 * already exist (Wave 0). Each read/write switch is flag-gated (default OFF)
 * with a localStorage fallback. No Schedule or assignment logic is touched at
 * any wave; the Schedule only ever read employees as an id→name lookup.
 */
export const EMPLOYEE_WAVES: ReadonlyArray<EmployeeWave> = [
  { id: "EMP-0", title: "Contracts + local adapter validation", scope: "VALIDATE the already-existing EmployeeSummary/Detail DTOs + localStorage adapter + parity (count/id/summary-field/detail). Confirm no new contract surface is needed. No schema, no UI.", uiSwitch: false, dependsOn: "P7A (this audit)" },
  { id: "EMP-1", title: "Supabase schema + read repository", scope: "employees table (single, mirrors customers convention), indexes, RLS; SupabaseEmployeeRepository (listSummaries/getDetail/search/count); migration tool (legacy_id↔uuid, reuse company map) + shadow read. No UI switch.", uiSwitch: false, dependsOn: "EMP-0" },
  { id: "EMP-2", title: "Employee list read switch", scope: "Flag-gated list reads from Supabase; localStorage fallback; shadow-read parity.", uiSwitch: true, dependsOn: "EMP-1" },
  { id: "EMP-3", title: "Employee detail read switch", scope: "Flag-gated detail reads (full record incl. workingSchedule from jsonb); edit dialog stays lossless.", uiSwitch: true, dependsOn: "EMP-2" },
  { id: "EMP-4", title: "Employee dual write", scope: "Mirror persistEmployees → Supabase (incl. status toggle + soft-delete fields from the WO-5.6 pattern); localStorage authoritative; drift detection. The linked-login User write stays on the auth track.", uiSwitch: false, dependsOn: "EMP-3" },
  { id: "EMP-5", title: "Employees authoritative + soak", scope: "Supabase source of truth for employee reads + writes; localStorage backout copy; staging soak (create/update/activate-deactivate/link-login + assignable-list + schedule-label parity).", uiSwitch: true, dependsOn: "EMP-4" },
  { id: "EMP-6", title: "Employees migration closure", scope: "Closure audit: flag map, source map, rollback drill, retained-localStorage rationale, cleanup candidates, verdict + next entity.", uiSwitch: false, dependsOn: "EMP-5" },
];

// ── Part 10 — Risk assessment ─────────────────────────────

export interface EmployeeRisk {
  rank: number;
  risk: string;
  level: RiskLevel;
  mitigation: string;
}

/** Ranked Employee migration risks, highest first. Far lower ceiling than WO. */
export const EMPLOYEE_RISKS: ReadonlyArray<EmployeeRisk> = [
  { rank: 1, risk: "Employee id (legacy_id) drift would orphan existing service-row assignments + future time reports.", level: "high", mitigation: "Preserve legacy_id exactly through migration (reuse the validated id-stable pattern); parity asserts id-set equality before any read/write switch." },
  { rank: 2, risk: "Linked-login (userId ↔ linkedEmployeeId) desync if the User side-effect is wrongly folded into employee dual-write.", level: "medium", mitigation: "Mirror employee.userId only; the User write stays on the auth track's seam (persistUsers). Document the boundary; drift-check the userId field, not Users." },
  { rank: 3, risk: "Email uniqueness-per-company enforced in app code, not the DB — duplicate emails could slip in via direct writes.", level: "medium", mitigation: "Keep the app-level guard; consider a (company_id, lower(email)) unique index in EMP-1; verify in the migration report." },
  { rank: 4, risk: "Schedule label regression (assignee name shows blank) if the id→name lookup source switches before employees are present in Supabase.", level: "low", mitigation: "Schedule keeps employees as a lookup-constant; only switch the lookup source after EMP-2/3 parity. A miss degrades to a blank label, never a wrong occurrence." },
  { rank: 5, risk: "workingSchedule lost/garbled in jsonb round-trip.", level: "low", mitigation: "Keep workingSchedule whole in data jsonb (no flattening); detail parity asserts lossless reconstruction." },
  { rank: 6, risk: "Reference-link ids (team/language/postalCity) break when those tracks migrate later.", level: "low", mitigation: "Store ids as flat soft-FK columns; preserve values verbatim; later tracks join by legacy_id." },
  { rank: 7, risk: "Rollback complexity once writes are mirrored.", level: "low", mitigation: "Per-wave default-OFF flags; localStorage authoritative through EMP-4; backout copy at EMP-5 (mirror customers/work orders)." },
];

// ── Part 11 — Verdict + recommended next prompt ───────────

export interface EmployeeDesignVerdict {
  verdict: "design-complete";
  summary: string;
  singleWriteSeam: string;
  keyFinding: string;
  recommendedFirstWave: string;
  recommendedNextPrompt: string;
}

export const EMPLOYEE_DESIGN_VERDICT: EmployeeDesignVerdict = {
  verdict: "design-complete",
  summary:
    "Employees are the cleanest track since Customers: a single FLAT record with no schedule-critical child rows. The Schedule reads employees only as an id→name lookup — the occurrence-driving assignment already lives on the migrated work_order_service_rows — so nothing about an employee is schedule-critical. All reads come from the in-memory AppContext array; all writes funnel through ONE persistEmployees seam (with a linked-login User side-effect that belongs to the auth track). The EmployeeSummary/Detail DTOs, the EmployeeRepository contract, the localStorage adapter and its parity check ALREADY exist from Wave 0, so EMP-0 is validation rather than new design.",
  singleWriteSeam: "AppContext.persistEmployees — the dual-write attach point (createEmployee / updateEmployee / status toggle).",
  keyFinding:
    "Employee assignment is NOT stored on the employee — it lives on work_order_service_rows.assignedEmployeeIds (already migrated). Employees are therefore a lookup-only dependency of the Schedule, making this a low-risk track. Activity Log and Time Reports remain DEFERRED; they reference employees by a legacy_id that must stay stable.",
  recommendedFirstWave:
    "EMP-0 — validate the existing Employee DTOs + localStorage adapter parity (count / id / summary-field / detail). No schema, no migration, no UI.",
  recommendedNextPrompt:
    "P7B – EMP-0: EMPLOYEE CONTRACTS & LOCAL ADAPTER VALIDATION — confirm EmployeeSummary/EmployeeDetail + EmployeeRepository are sufficient (no new fields), assert the localStorage employees adapter parity (count / id-set / summary fields incl. teamCount + hasLogin / detail lossless) in a dedicated test, and document the id-stability guarantee for downstream service-row assignment + deferred Time Reports — all behind the existing repository contract, NO Supabase schema, NO migration, NO UI switch.",
};
