/**
 * Work Orders migration DESIGN & CONTRACT AUDIT (P5A). Design-only.
 *
 * The Customer migration chain is closed (wave1.closure.blueprint.ts). Work
 * Orders are the next entity — but they are an order of magnitude more complex
 * than Customers: they own nested service rows + embedded variations, drive the
 * Schedule resolver, and link out to customers, employees, media, time reports,
 * activity and protocols. This file is the single typed record of:
 *   • the current Work Order model (what is core / schedule-critical / detail),
 *   • every read and write path,
 *   • the EXACT Schedule dependency (what resolveScheduleProgram consumes),
 *   • summary/detail contract proposals,
 *   • the future Supabase schema (parent + child tables, jsonb strategy),
 *   • the migration wave plan + ranked risks.
 *
 * Nothing here runs, queries, creates tables, migrates data, or changes
 * behaviour. No UI is switched. This is the blueprint the WO-0..WO-7 waves build
 * against.
 *
 * Grounded in the real code:
 *  - Domain model: `WorkOrder`, `WorkOrderServiceRow`, `RecurringVariation`,
 *    `WorkOrderActivity`, `WorkOrderNote`, `WorkOrderMediaPlacement`,
 *    `EmployeeTimeOverride` in `@/types`.
 *  - Single write seam: `persistWorkOrders` in `AppContext` (every create /
 *    update / archive / service-row / variation / staffing edit funnels here).
 *  - Schedule resolver: `resolveScheduleProgram` (scheduleCore.ts) over
 *    `ScheduleCoreInput`; see also `schedule.blueprint.ts`.
 *  - KEY CORRECTION vs. the Wave-0 readiness sketch: occurrence EXCEPTIONS
 *    (`BookingOccurrenceException`) are NOT embedded in work orders — they live
 *    in a SEPARATE store key (`getBookingOccurrenceExceptions`). VARIATIONS, by
 *    contrast, ARE embedded in `WorkOrderServiceRow.variations`.
 */

import type { RiskLevel } from "./wave1.readiness.blueprint";

// ── Part 1 — Current Work Order model audit ───────────────

/** Field classification used throughout the audit. */
export type FieldClass =
  | "core" // identity / lifecycle; needed everywhere
  | "schedule-critical" // consumed by resolveScheduleProgram / occurrence generation
  | "detail-only" // only WorkOrderDetails / card tabs
  | "history-activity" // activity / audit trail
  | "media-related" // image placement links
  | "future-operational"; // forward-compat data model, no live logic yet

export interface ModelField {
  entity: string;
  field: string;
  type: string;
  class: FieldClass;
  note: string;
}

/**
 * Field-by-field audit of the Work Order aggregate. The aggregate is the parent
 * `WorkOrder` plus four nested collections (`serviceRows`, `notes`, `activity`,
 * `mediaPlacements`) and the per-row `variations` / `employeeTimeOverrides`.
 */
export const WORK_ORDER_MODEL: ReadonlyArray<ModelField> = [
  // WorkOrder (parent)
  { entity: "WorkOrder", field: "id / companyId / customerId / number", type: "string", class: "core", note: "Identity + tenant + customer link + human number. company_id is the universal scope." },
  { entity: "WorkOrder", field: "title / service", type: "string?", class: "core", note: "Title; `service` is a legacy single-service label kept for back-compat." },
  { entity: "WorkOrder", field: "status", type: "WorkOrderStatus", class: "schedule-critical", note: "draft|planned|in_progress|completed|inactive. isLiveWorkOrder() gate — non-live WOs emit NO occurrences." },
  { entity: "WorkOrder", field: "startDate / endDate", type: "string?", class: "detail-only", note: "Header dates; not the occurrence source (service rows are)." },
  { entity: "WorkOrder", field: "assignedTo", type: "string?", class: "detail-only", note: "Legacy free-text assignee; rows carry real assignment now." },
  { entity: "WorkOrder", field: "createdBy / createdByName", type: "string?", class: "core", note: "Creator attribution snapshot." },
  { entity: "WorkOrder", field: "createdAt / updatedAt", type: "string", class: "core", note: "Timestamps; updatedAt drives list sort + drift checks." },
  { entity: "WorkOrder", field: "notes[]", type: "WorkOrderNote[]", class: "detail-only", note: "Admin notes, archivable; card tab only — never in list/schedule." },
  { entity: "WorkOrder", field: "serviceRows[]", type: "WorkOrderServiceRow[]", class: "schedule-critical", note: "THE occurrence source. Becomes a child table." },
  { entity: "WorkOrder", field: "activity[]", type: "WorkOrderActivity[]", class: "history-activity", note: "Immutable per-WO audit log; detail tab only." },
  { entity: "WorkOrder", field: "mediaPlacements[]", type: "WorkOrderMediaPlacement[]", class: "media-related", note: "Links to customer-owned MediaAsset; references only, never owns the image." },

  // WorkOrderServiceRow (child) — the planning unit
  { entity: "ServiceRow", field: "id / sortOrder / status / archived", type: "mixed", class: "schedule-critical", note: "Identity + ordering; isLiveSourceRow() skips archived/inactive rows in the resolver." },
  { entity: "ServiceRow", field: "serviceName / articleNumber / categoryName / serviceType", type: "string?", class: "detail-only", note: "Snapshot labels from the catalog at add-time (never live-linked). serviceName shows in the schedule label." },
  { entity: "ServiceRow", field: "quantity / unit / price / vat", type: "number?", class: "detail-only", note: "Commercial fields; not schedule-critical." },
  { entity: "ServiceRow", field: "serviceDate", type: "string (YYYY-MM-DD)", class: "schedule-critical", note: "First occurrence anchor. Required — generation needs it." },
  { entity: "ServiceRow", field: "serviceEndDate", type: "string?", class: "schedule-critical", note: "Inclusive recurrence bound; occurrences never generated past it." },
  { entity: "ServiceRow", field: "plannedStartTime / plannedEndTime", type: "string? (HH:MM)", class: "schedule-critical", note: "Planned window per occurrence; duration derived from these." },
  { entity: "ServiceRow", field: "recurrenceInterval", type: "RecurrenceInterval", class: "schedule-critical", note: "one_time|daily|weekly|… drives occurrence dates." },
  { entity: "ServiceRow", field: "assignedEmployeeIds[]", type: "string[]", class: "schedule-critical", note: "Assignees; resolver maps to employee names + staffing math." },
  { entity: "ServiceRow", field: "unassignedEmployeeSlots", type: "number", class: "schedule-critical", note: "Open staffing slots; drives Unassigned-row + staffing badges." },
  { entity: "ServiceRow", field: "employeeTimeOverrides[]", type: "EmployeeTimeOverride[]", class: "schedule-critical", note: "Sparse per-employee window overrides; consumed when resolving labour/times." },
  { entity: "ServiceRow", field: "totalLabourMinutesOverride", type: "number?", class: "schedule-critical", note: "Pinned total labour when headcount changes via redistribute." },
  { entity: "ServiceRow", field: "scheduleSource / schedulePreferences", type: "enum + obj", class: "schedule-critical", note: "customer_default vs override + the override prefs." },
  { entity: "ServiceRow", field: "variations[]", type: "RecurringVariation[]", class: "schedule-critical", note: "EMBEDDED recurring divergences (day/time/staff). Resolved per occurrence by the variation resolver." },
  { entity: "ServiceRow", field: "customerProtocolId / protocolRunId", type: "string?", class: "detail-only", note: "Reference links to protocol definition + executable run; no run data duplicated here." },
  { entity: "ServiceRow", field: "notes", type: "string?", class: "detail-only", note: "Per-row free text." },
  { entity: "ServiceRow", field: "createdAt / updatedAt", type: "string", class: "core", note: "Row timestamps." },

  // RecurringVariation (embedded in service row)
  { entity: "Variation", field: "id / name / type / status / chainOrder", type: "mixed", class: "schedule-critical", note: "Identity + lifecycle (getVariationStatus); chainOrder controls apply order when several stack." },
  { entity: "Variation", field: "frequency / interval / weekOfMonth / weekday / anchorOccurrenceIndex", type: "mixed", class: "schedule-critical", note: "Matching rule — which occurrences the variation applies to." },
  { entity: "Variation", field: "day / startTime / endTime / durationMinutes", type: "mixed?", class: "schedule-critical", note: "The actual overrides applied to a matched occurrence." },
  { entity: "Variation", field: "assignedEmployeeIds / unassignedSlotsDelta / employeeCount(dep)", type: "mixed", class: "schedule-critical", note: "Staffing overrides (absolute + additive delta); employeeCount is legacy." },
  { entity: "Variation", field: "appliesFrom / appliesUntil / enabled / archived", type: "mixed", class: "schedule-critical", note: "Validity window + legacy on/off; folded by getVariationStatus/getVariationDisplayState." },
  { entity: "Variation", field: "reason / internalNote / notes / replacedBy/replacesVariationId / replacedAt", type: "string?", class: "detail-only", note: "Provenance + supersession trace; not needed to resolve an occurrence." },

  // Occurrence exceptions — SEPARATE store, not embedded
  { entity: "OccurrenceException", field: "BookingOccurrenceException", type: "separate store", class: "schedule-critical", note: "CANCEL / RESCHEDULE / time-change overlay PER OCCURRENCE. Lives in BOOKING_OCCURRENCE_EXCEPTIONS_KEY, NOT inside work orders. Keyed by occurrenceKey (parentServiceRowId:occurrenceDate)." },

  // Nested detail collections
  { entity: "WorkOrderNote", field: "id/title/content/author/status/timestamps", type: "obj", class: "detail-only", note: "Card tab only." },
  { entity: "WorkOrderActivity", field: "id/action/summary/actor/at", type: "obj", class: "history-activity", note: "Immutable; newest-first; detail tab only." },
  { entity: "WorkOrderMediaPlacement", field: "id/mediaAssetId/placementType/serviceRowId/visibleToEmployee/sortOrder", type: "obj", class: "media-related", note: "Link to customer media; placement owned by WO, asset owned by customer." },
];

// ── Part 2 — Read path audit ──────────────────────────────

export type ReadShape = "summary" | "detail" | "occurrence" | "count";

export interface ReadPath {
  surface: string;
  entryPoint: string;
  reads: string;
  shape: ReadShape;
  scheduleCritical: boolean;
  /** Must stay on localStorage / in-memory AppContext until its wave lands. */
  mustRemainTemporarily: boolean;
}

/**
 * Every place Work Orders are read. Today all reads come from the single
 * in-memory `workOrders` array in AppContext (hydrated by `getWorkOrders()` at
 * boot); cross-entity lookups use `workOrders.find(...)` against that array.
 */
export const WORK_ORDER_READ_PATHS: ReadonlyArray<ReadPath> = [
  { surface: "Work Orders list (admin)", entryPoint: "WorkOrders page → workOrders array filtered/searched/paged", reads: "number, title, status, customerId(→name), serviceRowCount, dates, updatedAt", shape: "summary", scheduleCritical: false, mustRemainTemporarily: true },
  { surface: "WorkOrderDetails", entryPoint: "WorkOrderDetails → workOrders.find(id)", reads: "full aggregate incl. serviceRows / notes / activity / mediaPlacements", shape: "detail", scheduleCritical: false, mustRemainTemporarily: true },
  { surface: "Schedule / Schedule Lab", entryPoint: "resolveScheduleProgram(workOrders, …)", reads: "LIVE work orders → live service rows → recurrence + embedded variations + exceptions overlay", shape: "occurrence", scheduleCritical: true, mustRemainTemporarily: true },
  { surface: "Booking Queue", entryPoint: "booking queue derivation over service rows", reads: "service-row occurrences + assignment/schedule status", shape: "occurrence", scheduleCritical: true, mustRemainTemporarily: true },
  { surface: "Customer Card · Work Orders tab", entryPoint: "workOrders.filter(customerId === id)", reads: "summary rows for one customer", shape: "summary", scheduleCritical: false, mustRemainTemporarily: true },
  { surface: "Dashboard metrics / counts", entryPoint: "workOrders aggregates", reads: "counts by status", shape: "count", scheduleCritical: false, mustRemainTemporarily: true },
  { surface: "Time Reports", entryPoint: "report → workOrder/serviceRow lookup", reads: "WO number + service-row label resolution", shape: "summary", scheduleCritical: false, mustRemainTemporarily: true },
  { surface: "Activity Log (global)", entryPoint: "audit events reference workOrderId", reads: "id/number for label", shape: "summary", scheduleCritical: false, mustRemainTemporarily: true },
];

// ── Part 3 — Write path audit ─────────────────────────────

export interface WritePath {
  action: string;
  entryPoint: string;
  affects: string;
  downstream: string;
  risk: RiskLevel;
}

/**
 * Every Work Order write. CRITICAL FINDING: like Customers, ALL work-order
 * writes funnel through ONE seam — `persistWorkOrders(next)` in AppContext
 * (setState + saveWorkOrders). That single choke point is where dual-write will
 * later attach, exactly as `persistCustomers` did. There is no scattered direct
 * `saveWorkOrders` in any page.
 */
export const WORK_ORDER_WRITE_PATHS: ReadonlyArray<WritePath> = [
  { action: "Create work order", entryPoint: "AppContext.createWorkOrder → persistWorkOrders([order, ...])", affects: "parent row", downstream: "appears in list + customer card tab", risk: "low" },
  { action: "Update work order (title/status/dates)", entryPoint: "AppContext.updateWorkOrder → persistWorkOrders", affects: "parent row + activity", downstream: "status change can add/remove ALL its occurrences (isLiveWorkOrder)", risk: "high" },
  { action: "Archive / inactivate work order", entryPoint: "AppContext (inactivate/archive) → persistWorkOrders", affects: "parent status", downstream: "non-live WO emits no occurrences → schedule board changes", risk: "high" },
  { action: "Delete work order", entryPoint: "AppContext.deleteWorkOrder → persistWorkOrders(filter)", affects: "removes parent (+ related-data guard)", downstream: "occurrences + bookings vanish; rare admin action", risk: "high" },
  { action: "Service row add/edit/archive/reorder", entryPoint: "AppContext service-row mutators → persistWorkOrders", affects: "serviceRows[]", downstream: "regenerates the row's whole occurrence series", risk: "critical" },
  { action: "Variation add/edit/disable/archive/replace", entryPoint: "AppContext variation mutators → persistWorkOrders", affects: "serviceRow.variations[]", downstream: "alters matched occurrences' day/time/staff", risk: "high" },
  { action: "Staffing edit (assign/unassign/slots/overrides/redistribute)", entryPoint: "AppContext staffing mutators → persistWorkOrders", affects: "assignedEmployeeIds / unassignedEmployeeSlots / employeeTimeOverrides / totalLabourMinutesOverride", downstream: "occurrence staffing + labour math", risk: "high" },
  { action: "Exception create (cancel/reschedule/time-change)", entryPoint: "AppContext → saveBookingOccurrenceExceptions (SEPARATE store)", affects: "BookingOccurrenceException overlay", downstream: "moves/cancels a single occurrence; NOT a work-order write", risk: "high" },
  { action: "Media placement add/remove", entryPoint: "AppContext media mutators → persistWorkOrders", affects: "mediaPlacements[]", downstream: "card media tab only; no schedule effect", risk: "low" },
  { action: "Note add/edit/archive", entryPoint: "AppContext note mutators → persistWorkOrders", affects: "notes[]", downstream: "card notes tab only", risk: "low" },
  { action: "Activity append", entryPoint: "buildActivity → persistWorkOrders", affects: "activity[]", downstream: "audit trail only", risk: "low" },
];

// ── Part 4 — Schedule dependency map ──────────────────────

export interface ScheduleFieldDependency {
  field: string;
  critical: boolean;
  consumedBy: string;
}

/**
 * The precise contract between Work Orders and the Schedule. `resolveScheduleProgram`
 * iterates LIVE work orders → LIVE service rows → generates occurrences from the
 * recurrence rule, applies EMBEDDED variations (variation resolver), then overlays
 * the SEPARATE `BookingOccurrenceException`s. Anything not listed `critical` is
 * detail-only and must never enter a schedule query payload.
 */
export const SCHEDULE_FIELD_DEPENDENCIES: ReadonlyArray<ScheduleFieldDependency> = [
  { field: "WorkOrder.status (isLiveWorkOrder)", critical: true, consumedBy: "resolver gate — skips non-live WOs entirely" },
  { field: "ServiceRow.status / archived (isLiveSourceRow)", critical: true, consumedBy: "resolver gate — skips dead rows" },
  { field: "ServiceRow.serviceDate / serviceEndDate", critical: true, consumedBy: "occurrence date generation + bound" },
  { field: "ServiceRow.recurrenceInterval", critical: true, consumedBy: "generateServiceRowOccurrences base rule" },
  { field: "ServiceRow.plannedStartTime / plannedEndTime", critical: true, consumedBy: "occurrence window + duration" },
  { field: "ServiceRow.assignedEmployeeIds / unassignedEmployeeSlots", critical: true, consumedBy: "staffing math + employee-row placement" },
  { field: "ServiceRow.employeeTimeOverrides / totalLabourMinutesOverride", critical: true, consumedBy: "per-employee window + labour totals" },
  { field: "ServiceRow.variations[] (embedded)", critical: true, consumedBy: "variation resolver — per-occurrence overrides" },
  { field: "BookingOccurrenceException[] (separate store)", critical: true, consumedBy: "cancel / reschedule / time-change overlay" },
  { field: "Customer.id/name/addresses", critical: true, consumedBy: "denormalised customer name + delivery address" },
  { field: "Employee.id/name", critical: true, consumedBy: "denormalised assignee names" },
  { field: "PostalCity[]", critical: true, consumedBy: "structured city label for the address" },
  { field: "WorkOrder.notes / activity / mediaPlacements", critical: false, consumedBy: "DETAIL-ONLY — never touched by the resolver" },
  { field: "ServiceRow.price / vat / quantity / protocol links", critical: false, consumedBy: "DETAIL-ONLY — commercial / protocol surfaces" },
];

// ── Part 5 — Summary / detail contract proposal ───────────

export interface ContractProposal {
  contract: string;
  status: "exists" | "extend" | "new";
  fields: ReadonlyArray<string>;
  note: string;
}

/**
 * The DTOs Work Orders need. `WorkOrderSummary` / `WorkOrderDetail` already exist
 * (lib/data/types.ts) and stay; the schedule already has its own
 * `ScheduleOccurrenceSummary`. The service-row / variation / exception summaries
 * are NEW lightweight shapes for the detail tabs + schedule resolve, so list
 * queries never ship the full nested arrays.
 */
export const CONTRACT_PROPOSALS: ReadonlyArray<ContractProposal> = [
  { contract: "WorkOrderSummary", status: "extend", fields: ["id", "companyId", "customerId", "customerDisplayName (NEW — denormalised, avoids N+1)", "number", "title", "status", "startDate", "endDate", "serviceRowCount", "updatedAt"], note: "Add customerDisplayName so the list/customer-card tab renders without a lookup." },
  { contract: "WorkOrderDetail", status: "exists", fields: ["= full WorkOrder incl. serviceRows/notes/activity/mediaPlacements"], note: "Reconstructed losslessly from data jsonb in early waves; tabs stay lazy." },
  { contract: "WorkOrderServiceRowSummary", status: "new", fields: ["id", "workOrderId", "serviceName", "status", "serviceDate", "serviceEndDate", "recurrenceInterval", "plannedStartTime", "plannedEndTime", "assignedEmployeeIds", "unassignedEmployeeSlots", "variationCount"], note: "The schedule-critical projection — exactly what occurrence generation needs, no commercial/protocol fields." },
  { contract: "WorkOrderServiceRowDetail", status: "new", fields: ["= full WorkOrderServiceRow incl. variations / overrides / prefs / protocol links"], note: "Detail tab + edit form." },
  { contract: "WorkOrderVariationSummary", status: "new", fields: ["id", "serviceRowId", "name", "type", "status", "frequency", "appliesFrom", "appliesUntil"], note: "Variation chip list; matching rule fields lazy-loaded on edit." },
  { contract: "WorkOrderExceptionSummary", status: "new", fields: ["occurrenceKey", "serviceRowId", "status (cancelled|rescheduled|active)", "occurrenceDate", "overrideOccurrenceDate", "overrideStartTime", "overrideEndTime"], note: "From the SEPARATE exception store — overlay for the resolver + schedule badges." },
];

// ── Part 6 — Future Supabase schema proposal ──────────────

export interface WorkOrderTableProposal {
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
 * Future tables (blueprint only — NOT created). Mirrors the customers-table
 * convention: UUID PK + `legacy_id` (app-facing id) + real `company_id uuid` FK
 * for RLS + `company_legacy_id` for cheap query-layer scoping, with flat indexed
 * columns for list/search/schedule and `data jsonb` for lossless detail.
 *
 * DECISION — exceptions get their OWN table, NOT a service-row child:
 * `BookingOccurrenceException` is a separate store today, keyed by occurrenceKey
 * across all rows. Modelling it as `work_order_occurrence_exceptions` keyed by
 * (company_id, occurrence_key) matches reality and keeps the schedule overlay a
 * single scoped scan (this corrects the earlier `work_order_exceptions` sketch).
 *
 * DECISION — variations stay EMBEDDED in the service row jsonb initially:
 * they are read/written together with the row and only matter at resolve time,
 * so a dedicated table is deferred (promote later only if variation-level
 * queries are needed).
 */
export const WORK_ORDER_TABLES: ReadonlyArray<WorkOrderTableProposal> = [
  {
    table: "work_orders",
    purpose: "Work-order container; list + detail + schedule live-gate.",
    keyFields: ["id uuid", "legacy_id text", "company_id uuid", "company_legacy_id text", "customer_legacy_id text", "number", "title", "status", "start_date", "end_date", "created_by", "data jsonb (full aggregate: notes/activity/mediaPlacements)", "created_at", "updated_at"],
    companyScoped: true,
    legacyId: true,
    relationships: ["company_id → companies.id", "customer → customers (legacy_id link)", "1:N work_order_service_rows"],
    indexes: ["(company_id, status, created_at desc)", "(company_id, customer_legacy_id)", "(company_id, number)", "(company_legacy_id, status, created_at desc)"],
    jsonbAcceptable: true,
    rls: "Own company read/write; super_admin all; no DELETE policy (mirror customers).",
  },
  {
    table: "work_order_service_rows",
    purpose: "Per-service planning rows — THE schedule occurrence source.",
    keyFields: ["id uuid", "legacy_id text", "company_id uuid", "company_legacy_id text", "work_order_legacy_id text", "service_name", "status", "service_date", "service_end_date", "planned_start_time", "planned_end_time", "recurrence_interval", "assigned_employee_ids text[]", "unassigned_employee_slots int", "sort_order", "archived bool", "data jsonb (variations/overrides/prefs/protocol links/commercial)", "created_at", "updated_at"],
    companyScoped: true,
    legacyId: true,
    relationships: ["work_order_legacy_id → work_orders.legacy_id"],
    indexes: ["(company_id, work_order_legacy_id)", "(company_id, service_date)", "(company_id, status, service_date)"],
    jsonbAcceptable: true,
    rls: "Inherit company scope; same policies as work_orders.",
  },
  {
    table: "work_order_occurrence_exceptions",
    purpose: "Cancel / reschedule / time-change overlay per occurrence (separate store today).",
    keyFields: ["id uuid", "legacy_id text", "company_id uuid", "company_legacy_id text", "service_row_legacy_id text", "occurrence_key text", "occurrence_date", "status (active|cancelled|rescheduled)", "override_occurrence_date", "override_start_time", "override_end_time", "data jsonb", "created_at", "updated_at"],
    companyScoped: true,
    legacyId: true,
    relationships: ["service_row_legacy_id → work_order_service_rows.legacy_id (soft)"],
    indexes: ["(company_id, occurrence_key)", "(company_id, service_row_legacy_id, occurrence_date)"],
    jsonbAcceptable: true,
    rls: "Inherit company scope; same policies.",
  },
];

/** Tables explicitly DEFERRED (promote only when a query needs them). */
export const DEFERRED_TABLES: ReadonlyArray<{ table: string; reason: string }> = [
  { table: "work_order_variations", reason: "Embedded in service-row jsonb; read/written with the row, only matters at resolve time. Promote if variation-level reporting/queries appear." },
  { table: "work_order_activity", reason: "Detail-tab audit trail; lives in parent jsonb until an activity-timeline query is needed (shares the Activity Log wave thinking)." },
  { table: "work_order_media_links", reason: "Placement links in parent jsonb; promote when media queries/joins are needed." },
  { table: "work_order_protocol_links", reason: "Reference ids in service-row jsonb; protocol migration is a separate entity track." },
];

// ── Part 7 — JSONB strategy ───────────────────────────────

export type JsonbVerdict = "relational-early" | "jsonb-temporarily";

export interface JsonbDecision {
  field: string;
  verdict: JsonbVerdict;
  reason: string;
}

/**
 * What is promoted to flat/relational columns early (because list / search /
 * RLS / schedule resolve depend on them) vs. what stays inside `data jsonb` for
 * lossless detail without premature normalisation.
 */
export const JSONB_STRATEGY: ReadonlyArray<JsonbDecision> = [
  { field: "company_id / company_legacy_id", verdict: "relational-early", reason: "RLS + every scoped query. Never jsonb." },
  { field: "customer link / status / number", verdict: "relational-early", reason: "List filtering, the live-gate, identifier search." },
  { field: "serviceRows.service_date / recurrence / planned times / assignment", verdict: "relational-early", reason: "Schedule interval scan + occurrence generation (Wave WO-4/7)." },
  { field: "serviceRows.status / archived", verdict: "relational-early", reason: "isLiveSourceRow gate must be index-backed." },
  { field: "occurrence exceptions: occurrence_key / status / dates", verdict: "relational-early", reason: "Resolver overlay lookup by key + date." },
  { field: "variations[]", verdict: "jsonb-temporarily", reason: "Resolved with the row at compute time; no standalone query yet." },
  { field: "notes / activity / mediaPlacements", verdict: "jsonb-temporarily", reason: "Detail-tab only; lazy-loaded; no list/scope dependency." },
  { field: "commercial (price/vat/quantity/unit) + protocol links + prefs", verdict: "jsonb-temporarily", reason: "Detail/edit surfaces only; not list/schedule-critical." },
];

// ── Part 8 — Migration wave plan ──────────────────────────

export interface WorkOrderWave {
  id: string;
  title: string;
  scope: string;
  uiSwitch: boolean;
  dependsOn: string;
}

/**
 * The WO migration waves — the proven Customer pattern, but split so the nested
 * structure + Schedule dependency move in safe, reversible steps. Each read/write
 * switch is flag-gated (default OFF) with a localStorage fallback, exactly like
 * Customers. Schedule moves LAST and only after service rows are validated.
 */
export const WORK_ORDER_WAVES: ReadonlyArray<WorkOrderWave> = [
  { id: "WO-0", title: "Contracts + local adapter validation", scope: "New service-row/variation/exception DTOs; localStorage adapter parity (count/id/detail) for parent + rows.", uiSwitch: false, dependsOn: "P5A (this audit)" },
  { id: "WO-1", title: "Supabase schema + read repository", scope: "work_orders + work_order_service_rows + work_order_occurrence_exceptions tables, indexes, RLS; SupabaseWorkOrderRepository (listSummaries/getDetail/search/count); migration tool + shadow read. No UI switch.", uiSwitch: false, dependsOn: "WO-0" },
  { id: "WO-2", title: "Work Order list read switch", scope: "Flag-gated list reads from Supabase; localStorage fallback; shadow-read parity.", uiSwitch: true, dependsOn: "WO-1" },
  { id: "WO-3", title: "WorkOrderDetails read switch", scope: "Flag-gated detail reads (full aggregate from jsonb); tabs stay lazy.", uiSwitch: true, dependsOn: "WO-2" },
  { id: "WO-4", title: "Service rows + schedule dependency validation", scope: "Validate service-row projection feeds the resolver identically (read-only); NO schedule source switch yet. Parity on generated occurrences.", uiSwitch: false, dependsOn: "WO-3" },
  { id: "WO-5", title: "Work Order dual write", scope: "Mirror persistWorkOrders → Supabase (parent + rows + exceptions); localStorage authoritative; drift detection.", uiSwitch: false, dependsOn: "WO-4" },
  { id: "WO-6", title: "Work Orders authoritative", scope: "Supabase source of truth for WO reads + writes; localStorage backout copy; soak + cutover.", uiSwitch: true, dependsOn: "WO-5" },
  { id: "WO-7", title: "Schedule interval query migration", scope: "Move resolveScheduleProgram source to a company+date-scoped server query (schedule.blueprint.ts); interval cache per-interval token.", uiSwitch: true, dependsOn: "WO-6" },
];

// ── Part 9 — Risk assessment ──────────────────────────────

export interface WorkOrderRisk {
  rank: number;
  risk: string;
  level: RiskLevel;
  mitigation: string;
}

/** Ranked Work Order migration risks, highest first. */
export const WORK_ORDER_RISKS: ReadonlyArray<WorkOrderRisk> = [
  { rank: 1, risk: "Schedule regression — resolver reads work orders; a bad projection silently drops/duplicates occurrences.", level: "critical", mitigation: "Keep the client resolver reading through the adapter until WO-7; occurrence-level parity (WO-4) comparing local vs Supabase-sourced generation before any schedule switch." },
  { rank: 2, risk: "Service-row normalisation mistakes (dates/recurrence/staffing) corrupt occurrence generation.", level: "critical", mitigation: "Promote ONLY schedule-critical fields to columns; keep the row's full record in jsonb for lossless detail; shadow-read every generated occurrence." },
  { rank: 3, risk: "Variation loss/misorder — embedded chain (chainOrder, replace links) flattened incorrectly.", level: "high", mitigation: "Keep variations embedded in service-row jsonb (no flattening); resolver logic unchanged; parity asserts variation-applied occurrences." },
  { rank: 4, risk: "Exception overlay mismatch — exceptions are a SEPARATE store, easy to forget in dual-write/migration.", level: "high", mitigation: "Dedicated work_order_occurrence_exceptions table + its own migration/dual-write path; keyed by occurrence_key; explicit in WO-1/WO-5." },
  { rank: 5, risk: "Recurrence rule change invalidates a huge future occurrence series across intervals.", level: "high", mitigation: "Treat recurrence/status edits as all-interval cache invalidation (schedule.blueprint rules); WO-7 only." },
  { rank: 6, risk: "Customer relation mismatch (customer link by legacy id vs uuid).", level: "medium", mitigation: "Reuse the validated customer legacy_id↔uuid map; FK-soft link by legacy id; verify in migration report." },
  { rank: 7, risk: "Staffing/assignment drift (assignedEmployeeIds, slots, overrides) during dual write.", level: "medium", mitigation: "Write validation compares assignment + staffing fields; surfaced as drift, never silently ignored." },
  { rank: 8, risk: "Customer Card Work Orders tab over-fetches (N+1) without denormalised customer label.", level: "medium", mitigation: "Add customerDisplayName to WorkOrderSummary; lookup selector client-side until the server projection exists." },
  { rank: 9, risk: "Media/protocol link drift (references to customer-owned assets).", level: "low", mitigation: "Keep placements in parent jsonb; reference-only; no asset copy; media migration is a later track." },
  { rank: 10, risk: "Rollback complexity once nested writes are mirrored.", level: "low", mitigation: "Per-wave default-OFF flags; localStorage stays authoritative through WO-5; backout copy at WO-6 (mirror customers)." },
];

// ── Part 10 — Verdict + recommended next prompt ───────────

export interface WorkOrderDesignVerdict {
  verdict: "design-complete";
  summary: string;
  singleWriteSeam: string;
  keyCorrection: string;
  recommendedFirstWave: string;
  recommendedNextPrompt: string;
}

export const WORK_ORDER_DESIGN_VERDICT: WorkOrderDesignVerdict = {
  verdict: "design-complete",
  summary:
    "Work Orders are fully mapped: parent + service-row child + a separate occurrence-exception store, with variations embedded in rows. All reads come from the in-memory AppContext array; all writes funnel through a single persistWorkOrders seam (exactly like persistCustomers). Schedule criticality is isolated to a known field set, so the riskier Schedule switch can be deferred to the last wave.",
  singleWriteSeam: "AppContext.persistWorkOrders — the dual-write attach point.",
  keyCorrection:
    "Occurrence exceptions (BookingOccurrenceException) are a SEPARATE store, not embedded in work orders — they get their own table. Variations ARE embedded in service rows and stay in jsonb initially.",
  recommendedFirstWave: "WO-0 — contracts + localStorage adapter parity for parent + service rows (no schema, no UI).",
  recommendedNextPrompt:
    "P5B – WO-0: WORK ORDER CONTRACTS & LOCAL ADAPTER VALIDATION — add the WorkOrderServiceRowSummary/Detail, WorkOrderVariationSummary and WorkOrderExceptionSummary DTOs beside the existing types; extend WorkOrderSummary with customerDisplayName; implement/extend the localStorage adapter for parent + service rows + the separate exception store; and add a parity suite (count / id / detail / generated-occurrence parity) — all behind the existing repository contract, NO Supabase schema, NO migration, NO UI switch.",
};
