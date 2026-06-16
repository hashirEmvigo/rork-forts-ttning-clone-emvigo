/**
 * Activity Log & Employee Activity architecture blueprint (OP2).
 *
 * Design-only. Nothing here runs, queries, or changes behaviour. It is the
 * forward-looking server-side model for the two surfaces OP1 ranked as the
 * highest operational risk — the audit/activity log and employee activity —
 * expressed as typed, importable documentation so the future Supabase migration
 * (P4) has a concrete contract to build against and review can diff it.
 *
 * Current reality (audited OP2):
 *  - Audit events live in-memory + `localStorage` under `cleanops.auditEvents`,
 *    hard-capped at the newest 500 (`appendAudit` in AppContext, `saveAuditEvents`
 *    in store.ts). Older events are silently dropped — acceptable for a prototype,
 *    unacceptable for compliance once real companies onboard.
 *  - `AuditEvent` carries: id, at (ISO), actorId, actorName, actorRole, companyId,
 *    action, summary. It has NO entityType/entityId, NO severity, NO source.
 *  - The Activity Log UI (AuditLogPanel) is paginated (50/page) + debounced (350ms)
 *    and company-scoped in context (super_admin sees all). It still filters the
 *    full in-memory array client-side — fine at 500 rows, not at millions.
 *  - Employee activity has no single home: it is implied across TimeReport
 *    (check-out), work-order `activity[]` entries, protocol runs, and audit events.
 */

/** Logical column for the future `activity_events` table. */
export interface ActivityEventColumn {
  name: string;
  type: string;
  note: string;
}

/**
 * Target normalized schema for the server-side audit/activity log. Extends the
 * current `AuditEvent` shape with the dimensions OP2 Part 4 requires for
 * server-side filtering. New columns are additive — existing events backfill
 * with nulls.
 */
export const ACTIVITY_EVENT_COLUMNS: ReadonlyArray<ActivityEventColumn> = [
  { name: "id", type: "uuid pk", note: "Stable event id." },
  { name: "company_id", type: "uuid (nullable)", note: "Tenant scope; null for platform-level events. Always the first filter." },
  { name: "created_at", type: "timestamptz", note: "Event time. Sort key (newest first)." },
  { name: "actor_id", type: "uuid (nullable)", note: "Who performed the action; null for system." },
  { name: "actor_name", type: "text", note: "Snapshot of actor name at event time." },
  { name: "actor_role", type: "text", note: "Snapshot of actor role." },
  { name: "action", type: "text", note: "Existing AuditAction value, e.g. 'workorder.create'." },
  { name: "entity_type", type: "text (nullable)", note: "NEW: 'work_order' | 'customer' | 'employee' | 'booking' | ... Enables entity filtering." },
  { name: "entity_id", type: "uuid (nullable)", note: "NEW: id of the affected record. Enables 'history of X'." },
  { name: "severity", type: "text", note: "NEW: 'critical' | 'security' | 'admin' | 'operational' | 'debug'. Drives retention." },
  { name: "source", type: "text", note: "NEW: 'web' | 'mobile' | 'system' | 'import' | 'ai'." },
  { name: "summary", type: "text", note: "Human-readable description." },
];

/** A required query pattern with the index that should serve it. */
export interface ActivityQueryPattern {
  /** What the UI/API needs to ask. */
  pattern: string;
  /** Recommended Postgres index (composite, newest-first). */
  index: string;
}

/**
 * The query patterns the Activity Log must support server-side, each paired with
 * the index that keeps it cheap regardless of total row count. Every pattern is
 * company-scoped first (tenant isolation + index selectivity).
 */
export const ACTIVITY_QUERY_PATTERNS: ReadonlyArray<ActivityQueryPattern> = [
  { pattern: "Company feed, newest first, paginated", index: "(company_id, created_at desc)" },
  { pattern: "Company + actor (who did what)", index: "(company_id, actor_id, created_at desc)" },
  { pattern: "Company + entity history (one record's trail)", index: "(company_id, entity_type, entity_id, created_at desc)" },
  { pattern: "Company + action type", index: "(company_id, action, created_at desc)" },
  { pattern: "Company + severity (compliance views)", index: "(company_id, severity, created_at desc)" },
  { pattern: "Company + date range", index: "(company_id, created_at desc) — range scan on created_at" },
];

/**
 * Cursor-based pagination contract (preferred over OFFSET, which degrades on
 * large tables). Cursor = the last seen `created_at` + `id` tuple.
 */
export interface ActivityQueryRequest {
  companyId: string | null;
  /** Inclusive lower/upper ISO bounds; omit for "all time". */
  from?: string;
  to?: string;
  actorId?: string;
  entityType?: string;
  entityId?: string;
  action?: string;
  severity?: ActivitySeverity;
  /** Keyset cursor from the previous page; omit for the first page. */
  cursor?: { createdAt: string; id: string };
  /** Page size; server clamps to a safe maximum (e.g. 200). */
  limit: number;
}

/** Severity buckets that drive both UI grouping and retention. */
export type ActivitySeverity =
  | "critical"
  | "security"
  | "admin"
  | "operational"
  | "debug";

/**
 * Employee Activity model recommendation (OP2 Part 5).
 *
 * Recommendation: **C — Hybrid.** Do NOT build a second physical store that
 * duplicates time reports / protocol runs (write amplification, sync drift,
 * double the retention cost). Instead expose Employee Activity as a server-side
 * VIEW that UNION-projects the already-authoritative sources into one feed shape,
 * filtered by `(company_id, employee_id, created_at)`. Promote to a materialized
 * view only if read latency demands it after measurement.
 *
 * Rationale: the source tables (time_reports, work_order_activity, audit_events,
 * protocol_runs, media) are already the system of record and already carry
 * company_id + a timestamp. A derived feed keeps a single source of truth and
 * stays correct by construction.
 */
export const EMPLOYEE_ACTIVITY_RECOMMENDATION =
  "Hybrid (option C): derive a unified employee-activity feed via a server-side view over the authoritative source tables, keyed (company_id, employee_id, created_at desc). Materialize only if measurement proves read latency requires it." as const;

/** One contributing source for the derived employee-activity feed. */
export interface EmployeeActivitySource {
  /** Future table/source name. */
  source: string;
  /** Activity types it contributes to the unified feed. */
  contributes: string;
  /** Whether it already carries the dimension today. */
  hasEmployeeId: boolean;
  hasCompanyId: boolean;
  hasTimestamp: boolean;
  /** Gaps to close during migration. */
  gap: string;
}

export const EMPLOYEE_ACTIVITY_SOURCES: ReadonlyArray<EmployeeActivitySource> = [
  {
    source: "time_reports",
    contributes: "Check-out, worked time, deviations, approvals",
    hasEmployeeId: true,
    hasCompanyId: true,
    hasTimestamp: true,
    gap: "employeeId is nullable today; enforce non-null once auth-backed mobile check-out exists.",
  },
  {
    source: "work_order_activity",
    contributes: "Notes, service edits, status changes per work order",
    hasEmployeeId: false,
    hasCompanyId: true,
    hasTimestamp: true,
    gap: "Activity entries record actor name but not a structured employeeId/visitId — add both.",
  },
  {
    source: "audit_events",
    contributes: "Admin actions, auth, impersonation attributable to a user",
    hasEmployeeId: false,
    hasCompanyId: true,
    hasTimestamp: true,
    gap: "actorId maps to a user, not necessarily an employee; add entity_type/entity_id (above).",
  },
  {
    source: "protocol_runs",
    contributes: "Checklist execution: started, progressed, completed",
    hasEmployeeId: false,
    hasCompanyId: true,
    hasTimestamp: true,
    gap: "Runs need an explicit executing employeeId + visitId for attribution.",
  },
  {
    source: "media",
    contributes: "Employee photo/file uploads (damage reports, protocol images)",
    hasEmployeeId: false,
    hasCompanyId: false,
    hasTimestamp: true,
    gap: "Add company_id + uploader employeeId so uploads attribute to a company and employee.",
  },
  {
    source: "schedule_visits",
    contributes: "Check-in / check-out / assignment history (future)",
    hasEmployeeId: true,
    hasCompanyId: true,
    hasTimestamp: true,
    gap: "No persisted check-in event exists yet; today only check-out (time report) is recorded.",
  },
];

/** Retention class for an event category (OP2 Part 6). */
export interface RetentionClass {
  category: string;
  severity: ActivitySeverity;
  /** How long it stays in the hot/queryable store. */
  hotRetention: string;
  /** Whether it is moved to cold/archive storage afterwards rather than deleted. */
  archive: boolean;
  note: string;
}

/**
 * Retention & archiving strategy. Hot = indexed Postgres for fast querying;
 * cold = cheaper append-only archive (object storage / partition detach) kept
 * searchable for compliance. High-volume low-value events expire fastest.
 */
export const RETENTION_CLASSES: ReadonlyArray<RetentionClass> = [
  { category: "Auth / security (login, password reset, impersonation)", severity: "security", hotRetention: "2 years", archive: true, note: "Compliance-sensitive; never silently dropped." },
  { category: "Admin changes (roles, entitlements, settings, company)", severity: "admin", hotRetention: "2 years", archive: true, note: "Governance trail; long retention." },
  { category: "Critical financial / billing actions", severity: "critical", hotRetention: "indefinite", archive: true, note: "Legal/financial record." },
  { category: "Operational visit events (work orders, bookings, time reports)", severity: "operational", hotRetention: "12 months hot", archive: true, note: "Bulk of volume; archive after the hot window." },
  { category: "High-volume status / progress events", severity: "operational", hotRetention: "90 days hot", archive: true, note: "Sample or roll up before archiving." },
  { category: "Debug / performance events", severity: "debug", hotRetention: "30 days", archive: false, note: "Disposable; never archived." },
];

/**
 * Usage / performance metering counters for these surfaces (OP2 Part 7).
 * Blueprint only — no storage, no billing. Every counter is attributable to a
 * `companyId` and feeds the metering model documented in `metering.blueprint.ts`.
 */
export const ACTIVITY_METERING_COUNTERS: ReadonlyArray<{ key: string; description: string }> = [
  { key: "events_written_count", description: "Audit/activity events written, per company." },
  { key: "events_read_count", description: "Events returned by activity queries, per company." },
  { key: "activity_log_queries", description: "Activity-log query executions, per company." },
  { key: "employee_activity_queries", description: "Employee-activity feed query executions, per company." },
  { key: "activity_export_count", description: "Activity/audit export operations, per company." },
];
