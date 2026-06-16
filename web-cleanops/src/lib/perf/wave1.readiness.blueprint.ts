/**
 * Wave 0 Validation & Wave 1 Readiness — Blueprint (P4C).
 *
 * Design-only. Nothing here runs, queries, creates tables, migrates data, or
 * changes behaviour. It records the outcome of validating the Wave 0 query layer
 * (contracts + DTOs + localStorage adapters in `lib/data`) and specifies the
 * exact future Wave 1 data model so Customers + Work Orders can move to Supabase
 * behind the existing, parity-tested interface.
 *
 * Grounded in the real code:
 *  - Parity is proven by `src/lib/data/parity.test.ts` (8 cases: count/id/field/
 *    detail parity, pagination, search, company-scope guard) — all passing
 *    against the seeded demo data, unscoped and company-scoped.
 *  - DTOs (`lib/data/types.ts`) and contracts (`lib/data/contracts.ts`) match the
 *    real domain types in `@/types` (`Customer`, `WorkOrder`, `WorkOrderServiceRow`).
 *  - The localStorage adapters wrap the existing store getters with no behaviour
 *    change; no UI is wired onto them yet.
 *
 * This blueprint does NOT: create tables, migrate data, switch any UI surface,
 * or change business logic / permissions / scheduling.
 */

import type { WaveId } from "./migration.blueprint";

// ── Part 1 — Parity validation results ────────────────────

export type ParityOutcome = "pass" | "fail" | "not-checked";

export interface ParityValidationResult {
  entity: string;
  outcome: ParityOutcome;
  /** What the parity check asserts for this entity. */
  asserts: string;
  notes: string;
}

/**
 * Outcome of running Wave 0 parity (`validateWave0Parity()` + the vitest suite
 * `parity.test.ts`). Customers/Employees/Work Orders assert count + id set +
 * key summary fields + detail lookup; the high-volume logs assert count + id set
 * (their summary mirrors the source record, so a field diff is redundant).
 */
export const PARITY_RESULTS: ReadonlyArray<ParityValidationResult> = [
  { entity: "Customers", outcome: "pass", asserts: "count, id set, name/customerNumber/status, getDetail, company-scope guard", notes: "Identifier search (customerNumber) bypasses the 5-char threshold — verified." },
  { entity: "Employees", outcome: "pass", asserts: "count, id set, name + teamCount, getDetail", notes: "teamCount/hasLogin derived from teamIds/userId; no extra resolution." },
  { entity: "Work Orders", outcome: "pass", asserts: "count, id set, number + serviceRowCount, getDetail", notes: "serviceRowCount = serviceRows.length; rows themselves stay detail-only." },
  { entity: "Schedule (booking queue)", outcome: "pass", asserts: "count, id set (visitId = booking id)", notes: "Derived from the persisted booking queue in Wave 0, not the live resolver." },
  { entity: "Activity Log", outcome: "pass", asserts: "count, id set", notes: "Summary mirrors AuditEvent; date/actor/action filters available on the contract." },
  { entity: "Time Reports", outcome: "pass", asserts: "count, id set", notes: "Deviation + audit history correctly excluded from the summary." },
];

// ── Part 2 — Contract completeness ────────────────────────

export type ContractStatus = "complete" | "extend-later";

export interface ContractCompleteness {
  repository: string;
  hasListSummaries: boolean;
  hasGetDetail: boolean;
  hasSearch: boolean;
  hasCount: boolean;
  status: ContractStatus;
  /** Methods/filters recommended for a LATER wave, not needed for Wave 1. */
  futureAdditions: ReadonlyArray<string>;
}

/**
 * Every repository already exposes the four core methods. Additions below are
 * deferred to the wave that needs them (schedule interval reads in Wave 2,
 * activity cursor paging in Wave 3) — adding them now would be speculative.
 */
export const CONTRACT_COMPLETENESS: ReadonlyArray<ContractCompleteness> = [
  { repository: "CustomerRepository", hasListSummaries: true, hasGetDetail: true, hasSearch: true, hasCount: true, status: "complete", futureAdditions: [] },
  { repository: "EmployeeRepository", hasListSummaries: true, hasGetDetail: true, hasSearch: true, hasCount: true, status: "complete", futureAdditions: [] },
  { repository: "WorkOrderRepository", hasListSummaries: true, hasGetDetail: true, hasSearch: true, hasCount: true, status: "complete", futureAdditions: ["listByCustomerId (detail-tab convenience, optional)"] },
  { repository: "ScheduleRepository", hasListSummaries: true, hasGetDetail: true, hasSearch: true, hasCount: true, status: "extend-later", futureAdditions: ["listOccurrencesByInterval(from,to)", "countOccurrences(interval)", "(already supports fromDate/toDate/employeeIds via params)"] },
  { repository: "ActivityLogRepository", hasListSummaries: true, hasGetDetail: true, hasSearch: true, hasCount: true, status: "extend-later", futureAdditions: ["cursor pagination (keyset)", "entityType + entityId filters", "severity filter"] },
  { repository: "TimeReportRepository", hasListSummaries: true, hasGetDetail: true, hasSearch: true, hasCount: true, status: "complete", futureAdditions: ["(employeeId + date-range filters already on params)"] },
];

// ── Part 3 — DTO review ───────────────────────────────────

export type DtoFieldVerdict = "correct" | "questionable" | "move-to-detail" | "missing";

export interface DtoFieldReview {
  dto: string;
  field: string;
  verdict: DtoFieldVerdict;
  note: string;
}

/**
 * Field-level review of the summary DTOs most relevant to Wave 1/2. Conclusion:
 * the summaries are lightweight and carry no detail-heavy payloads. A few cheap
 * scalar additions are flagged `missing` only because list surfaces will want
 * them — they are counts/labels, never nested objects.
 */
export const DTO_REVIEW: ReadonlyArray<DtoFieldReview> = [
  // CustomerSummary
  { dto: "CustomerSummary", field: "name / customerNumber / email / status", verdict: "correct", note: "Core list columns + searchable identifiers." },
  { dto: "CustomerSummary", field: "customerType / areaId / area", verdict: "correct", note: "Cheap scalars used for list filtering/badges; label resolution stays in UI." },
  { dto: "CustomerSummary", field: "ownerId", verdict: "missing", note: "List shows account owner; add the id (label resolved by a lookup selector), not the Employee object." },
  { dto: "CustomerSummary", field: "activeWorkOrderCount", verdict: "missing", note: "Blueprint contract lists it; deferred — needs a join/aggregate, add when the server query exists (Wave 1)." },
  { dto: "CustomerSummary", field: "addresses / contacts / notes / cardLog / media", verdict: "correct", note: "Correctly absent — detail-only / never-in-list." },
  // WorkOrderSummary
  { dto: "WorkOrderSummary", field: "number / status / customerId / serviceRowCount", verdict: "correct", note: "List columns + cheap count badge." },
  { dto: "WorkOrderSummary", field: "title / startDate / endDate / updatedAt", verdict: "correct", note: "Lightweight scalars for sort/display." },
  { dto: "WorkOrderSummary", field: "customerDisplayName", verdict: "missing", note: "Lists show the customer name; today resolved via a lookup. Add a denormalized label in the server summary to avoid an N+1 join." },
  { dto: "WorkOrderSummary", field: "serviceRows / activity / notes / mediaPlacements", verdict: "correct", note: "Correctly absent — detail-only / never-in-list." },
  // ScheduleOccurrenceSummary
  { dto: "ScheduleOccurrenceSummary", field: "visitId / date / startTime / endTime / employeeIds", verdict: "correct", note: "Exactly the board/drag-drop fields." },
  { dto: "ScheduleOccurrenceSummary", field: "customerDisplayName / serviceLabel", verdict: "correct", note: "Denormalized labels — render without a lookup." },
  { dto: "ScheduleOccurrenceSummary", field: "assignmentStatus / scheduleStatus", verdict: "correct", note: "Drive board grouping/colour; cheap enums." },
  // ActivityEventSummary
  { dto: "ActivityEventSummary", field: "id / at / actorId / actorName / action / summary", verdict: "correct", note: "Mirrors AuditEvent; already summary-shaped." },
  { dto: "ActivityEventSummary", field: "entityType / entityId / severity", verdict: "missing", note: "Not stored today; add at the SERVER model (Wave 3) to enable entity-timeline + severity filters — not a Wave 0 adapter gap." },
];

// ── Part 4/5 — Customers & Work Orders migration readiness ─

export interface SurfaceReadiness {
  surface: string;
  needsFrom: string;
  currentSource: string;
  mustRemainTemporarily: ReadonlyArray<string>;
  firstServerQuery: string;
  firstIndexes: ReadonlyArray<string>;
}

/**
 * What each Customers / Work Orders surface needs from the new contracts, what
 * must stay on the existing store getters until Wave 1 lands, and the first
 * server query + indexes to create. No UI is switched in P4C.
 */
export const SURFACE_READINESS: ReadonlyArray<SurfaceReadiness> = [
  {
    surface: "Customers list",
    needsFrom: "CustomerSummary (paged, company-scoped, identifier-aware search)",
    currentSource: "getCustomers() filtered/searched/paged in-page (P1)",
    mustRemainTemporarily: ["getCustomers() until the server adapter is wired", "area/owner label resolution in the UI"],
    firstServerQuery: "customers.listSummaries({ companyId, search, page, pageSize })",
    firstIndexes: ["(company_id, name)", "(company_id, customer_number)", "(company_id, created_at desc)"],
  },
  {
    surface: "Customer Card",
    needsFrom: "CustomerDetail by id; heavy tabs (notes, media, work orders, activity) stay lazy",
    currentSource: "getCustomers().find(id) + lazy Radix tabs (P2)",
    mustRemainTemporarily: ["lazy tab mounting", "media/protocol getters (already lazy)"],
    firstServerQuery: "customers.getDetail(id, { companyId })",
    firstIndexes: ["primary key (id)", "(company_id) scope guard"],
  },
  {
    surface: "Work Orders list",
    needsFrom: "WorkOrderSummary (company + status scoped, paged)",
    currentSource: "getWorkOrders() filtered in-page",
    mustRemainTemporarily: ["getWorkOrders() until adapter wired", "customer name lookup"],
    firstServerQuery: "workOrders.listSummaries({ companyId, statuses, page, pageSize })",
    firstIndexes: ["(company_id, status, created_at desc)", "(company_id, customer_id)"],
  },
  {
    surface: "WorkOrderDetails",
    needsFrom: "WorkOrderDetail incl. service rows; variations/exceptions/activity stay detail-only & lazy",
    currentSource: "getWorkOrders().find(id) + lazy tabs (P2)",
    mustRemainTemporarily: ["lazy tabs", "booking/occurrence resolver reads"],
    firstServerQuery: "workOrders.getDetail(id, { companyId })",
    firstIndexes: ["primary key (id)", "(work_order_id) on child tables"],
  },
  {
    surface: "Schedule (dependency)",
    needsFrom: "Work-order service rows as the occurrence source (read-only)",
    currentSource: "resolveScheduleProgram() over in-memory work orders + booking queue",
    mustRemainTemporarily: ["client resolver + IntervalCache (P3) until Wave 2"],
    firstServerQuery: "(Wave 2) schedule.listSummaries({ companyId, fromDate, toDate })",
    firstIndexes: ["(company_id, scheduled_date)", "(company_id, employee_id, scheduled_date)"],
  },
];

// ── Part 6 — Wave 1 data-model proposal ───────────────────

export interface TableProposal {
  table: string;
  purpose: string;
  requiredFields: ReadonlyArray<string>;
  companyScoped: boolean;
  relationships: ReadonlyArray<string>;
  indexes: ReadonlyArray<string>;
  queryPatterns: ReadonlyArray<string>;
}

/**
 * Future Wave 1 tables (blueprint only — NOT created here). The work order's
 * nested arrays (`serviceRows`, `notes`, `activity`, `mediaPlacements`) become
 * child tables so list queries never ship them and detail tabs can page
 * independently. Every operational table leads with `company_id`.
 */
export const WAVE1_TABLES: ReadonlyArray<TableProposal> = [
  {
    table: "customers",
    purpose: "Customer master record; list + detail.",
    requiredFields: ["id", "company_id", "name", "customer_number", "email", "status", "customer_type", "area_id", "owner_id", "created_at", "updated_at"],
    companyScoped: true,
    relationships: ["area_id → areas.id", "owner_id → employees.id", "1:N work_orders"],
    indexes: ["(company_id, name)", "(company_id, customer_number)", "(company_id, created_at desc)", "(company_id, area_id)"],
    queryPatterns: ["paged company list", "identifier/name search", "by id detail", "count for pagination"],
  },
  {
    table: "work_orders",
    purpose: "Work-order container; list + detail; schedule source.",
    requiredFields: ["id", "company_id", "customer_id", "number", "title", "status", "start_date", "end_date", "created_by", "created_at", "updated_at"],
    companyScoped: true,
    relationships: ["customer_id → customers.id", "1:N work_order_service_rows / variations / exceptions"],
    indexes: ["(company_id, status, created_at desc)", "(company_id, customer_id)", "(company_id, number)"],
    queryPatterns: ["company+status paged list", "by id detail", "by customer_id (card tab)", "count"],
  },
  {
    table: "work_order_service_rows",
    purpose: "Per-service planning rows; the schedule occurrence source.",
    requiredFields: ["id", "company_id", "work_order_id", "source_service_id", "service_name", "service_type", "quantity", "status", "service_date", "service_end_date", "planned_start_time", "planned_end_time", "recurrence_interval", "assigned_employee_ids", "unassigned_employee_slots", "created_at", "updated_at"],
    companyScoped: true,
    relationships: ["work_order_id → work_orders.id"],
    indexes: ["(company_id, work_order_id)", "(company_id, service_date)", "(company_id, status, service_date)"],
    queryPatterns: ["rows for a work order (detail)", "interval scan for schedule (Wave 2)", "status/date filtered planning"],
  },
  {
    table: "work_order_variations",
    purpose: "Per-occurrence divergences from a recurring row (detail-only).",
    requiredFields: ["id", "company_id", "work_order_id", "service_row_id", "occurrence_key", "fields_json", "created_at"],
    companyScoped: true,
    relationships: ["service_row_id → work_order_service_rows.id"],
    indexes: ["(company_id, work_order_id)", "(company_id, service_row_id, occurrence_key)"],
    queryPatterns: ["variations for a row (overlay)", "by occurrence_key during schedule resolve"],
  },
  {
    table: "work_order_exceptions",
    purpose: "Occurrence exceptions (skip/move/cancel) — overlay, detail-only.",
    requiredFields: ["id", "company_id", "work_order_id", "service_row_id", "occurrence_key", "exception_type", "payload_json", "created_at"],
    companyScoped: true,
    relationships: ["service_row_id → work_order_service_rows.id"],
    indexes: ["(company_id, work_order_id)", "(company_id, service_row_id, occurrence_key)"],
    queryPatterns: ["exceptions for a row", "by occurrence_key during schedule resolve"],
  },
];

// ── Part 7 — Risks before Wave 1 ──────────────────────────

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface PreWaveRisk {
  risk: string;
  level: RiskLevel;
  mitigation: string;
}

export const PRE_WAVE1_RISKS: ReadonlyArray<PreWaveRisk> = [
  { risk: "Nested work-order structure (rows/variations/exceptions) is complex for a first migration.", level: "high", mitigation: "Split into child tables; migrate the parent + service rows first, keep variations/exceptions as overlay tables loaded on detail open." },
  { risk: "Schedule resolver depends on in-memory work orders; migrating work orders could destabilise Schedule.", level: "high", mitigation: "Keep the client resolver + IntervalCache reading through the adapter; do NOT migrate Schedule until Wave 2. Work-order reads stay parity-checked." },
  { risk: "Customer Card needs many sections; over-eager detail query could refetch heavy data.", level: "medium", mitigation: "getDetail returns the core record only; tabs (notes/media/activity) stay lazy as today (P2)." },
  { risk: "Summary DTOs missing denormalized labels (customerDisplayName, ownerId) cause N+1 joins.", level: "medium", mitigation: "Add denormalized label columns to the server summary projection; resolve via lookup selectors client-side until then." },
  { risk: "LocalStorage adapter / server result drift during dual-run.", level: "medium", mitigation: "Reuse validateWave0Parity() as a shadow-read diff (server vs local) before cut-over; gate behind a flag." },
  { risk: "Rollback complexity once UI is switched.", level: "low", mitigation: "Adapter seam means flipping localDataLayer ↔ supabaseDataLayer; localStorage data remains during the dual-write window." },
];

// ── Part 8/9 — Recommended Wave 1 sequence ────────────────

export type Wave1Option = "customers-only" | "customers-and-work-orders" | "work-orders-only" | "other";

export interface Wave1Recommendation {
  recommended: Wave1Option;
  rationale: ReadonlyArray<string>;
  firstStep: string;
  /** Wave this recommendation feeds. */
  feedsWave: WaveId;
}

/**
 * Recommendation: start Wave 1 with **Customers only**. Customers are a flat,
 * self-contained record with no downstream resolver dependency, so they are the
 * safest possible first real migration and prove the full path (table, server
 * adapter, parity shadow-read, UI swap) end-to-end before the riskier nested
 * Work Order + Schedule chain.
 */
export const WAVE1_RECOMMENDATION: Wave1Recommendation = {
  recommended: "customers-only",
  rationale: [
    "Customers are flat and self-contained — no service rows, no recurrence, no resolver consumes them.",
    "Lowest blast radius: nothing else (Schedule, Booking Queue, Time Reports) breaks if the customer query misbehaves.",
    "Proves the end-to-end path (Supabase table + indexes → SupabaseCustomerRepository → parity shadow-read → UI swap) on the easy case.",
    "Work Orders carry the nested rows/variations/exceptions + the Schedule dependency — migrate them in a focused Wave 1b once the customer path is validated in production.",
  ],
  firstStep:
    "Create the `customers` table with the recommended indexes, implement SupabaseCustomerRepository.listSummaries/getDetail/search/count, and run validateWave0Parity()-style shadow-read (server vs local) behind a flag — no UI switch until parity holds.",
  feedsWave: "wave-1",
};
