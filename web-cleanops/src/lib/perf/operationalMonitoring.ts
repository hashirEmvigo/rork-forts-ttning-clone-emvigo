/**
 * Operational monitoring registry (OP1).
 *
 * A typed, behaviour-neutral description of the operational surfaces most likely
 * to drive cost as CleanOps grows, plus the instrumentation labels each surface
 * emits today. It is documentation expressed as code: importable by the Super
 * Admin System Performance page so the monitoring layout is driven by one source
 * of truth, diffable in review, and ready to gain real numbers without UI churn.
 *
 * Nothing here runs work or changes behaviour. The `metricLabels` simply name the
 * `perf` counters/timers a surface already records (see `instrumentation.ts`), so
 * the dashboard can surface them under the right operational section.
 */

/** Where a surface's data currently lives. */
export type OperationalDataSource =
  | "in-memory"
  | "localStorage"
  | "derived-resolver"
  | "supabase"
  | "none-yet";

/** Expected dataset growth as the platform scales. */
export type GrowthRisk = "low" | "medium" | "high" | "critical";

/** Whether the surface is instrumented today or a planned placeholder. */
export type MonitoringStatus = "live" | "partial" | "planned";

/** What the surface's cost is expected to scale with. */
export type ScalingDimension =
  | "employees"
  | "customers"
  | "work-orders"
  | "bookings"
  | "date-range"
  | "events"
  | "media-assets"
  | "ai-calls"
  | "connections";

/** A single operational surface tracked by the monitoring layer. */
export interface OperationalSurface {
  /** Stable id, e.g. "schedule" | "activity" | "media". */
  id: string;
  /** Human-readable section name for the dashboard. */
  label: string;
  /** One-line description of what the surface does. */
  description: string;
  /** Current data source. */
  source: OperationalDataSource;
  /** Expected growth risk. */
  growth: GrowthRisk;
  /** What cost is expected to scale with. */
  scalesWith: ScalingDimension[];
  /** Instrumentation status today. */
  status: MonitoringStatus;
  /**
   * `perf` counter/timer labels this surface emits today. Empty when the surface
   * has no instrumentation yet (a `planned` placeholder). The dashboard reads
   * live values for these from the instrumentation snapshot.
   */
  metricLabels: string[];
  /** Why this surface matters for scaling — shown as a note. */
  note: string;
}

/**
 * The operational surfaces, ordered by the OP1 priority list. `metricLabels`
 * reference the exact labels recorded in code, so the dashboard never invents a
 * metric that isn't actually collected.
 */
export const OPERATIONAL_SURFACES: ReadonlyArray<OperationalSurface> = [
  {
    id: "schedule",
    label: "Schedule",
    description: "Employee planning board resolved over the shared Schedule Core.",
    source: "derived-resolver",
    growth: "critical",
    scalesWith: ["employees", "work-orders", "bookings", "date-range"],
    status: "live",
    metricLabels: [
      "Schedule.render",
      "schedule.interval", // cache hit/miss
      "schedule.interval.compute", // resolveScheduleProgram duration
      "schedule.entryTransform",
      "schedule.metrics",
      "schedule.board",
    ],
    note: "Cost scales with occurrences in the selected interval (rows × dates × service rows). Interval cache absorbs revisits; a real miss times resolveScheduleProgram + board assembly.",
  },
  {
    id: "active-jobs",
    label: "Active Jobs",
    description: "Protocol runs (checklist execution) and time-report check-out.",
    source: "localStorage",
    growth: "high",
    scalesWith: ["work-orders", "events"],
    status: "partial",
    metricLabels: [
      "ProtocolRuns.render",
      "protocolRuns.resolve",
      "TimeReportsTab.render",
    ],
    note: "Per-company protocol-run resolve and per-work-order time-report reads are timed. A dedicated live 'active visits' surface does not exist yet — runs/check-outs are the closest proxies today.",
  },
  {
    id: "activity",
    label: "Employee Activity & Activity Log",
    description: "Audit/activity events; attendance, visit history, check-in/out logs.",
    source: "in-memory",
    growth: "critical",
    scalesWith: ["events", "employees"],
    status: "live",
    metricLabels: [
      "AuditLogPanel.render",
      "activityLog.filter",
    ],
    note: "Activity Log is paginated + debounced (50/page) and now times each client-side filter pass over the in-memory array (hard-capped at 500 events today). Action grouping is derived safely from the action prefix, so new audit actions can never crash the log. The full event set is expected to become the largest dataset; server-side date/user/entity/severity filtering and cursor pagination are required at P4 (see activityLog.blueprint.ts).",
  },
  {
    id: "media",
    label: "Media",
    description: "Photos, damage reports, protocol images, employee/customer uploads.",
    source: "localStorage",
    growth: "critical",
    scalesWith: ["media-assets"],
    status: "planned",
    metricLabels: [],
    note: "Rendering already uses progressive layers (micro → hover → preview) and lazy decoding. The risk is storage/network: bytes are not yet attributable per company and large originals must move to object storage at P4.",
  },
  {
    id: "notifications",
    label: "Notifications & Realtime",
    description: "Status updates, active-job changes, schedule updates, notifications.",
    source: "none-yet",
    growth: "medium",
    scalesWith: ["connections", "events"],
    status: "planned",
    metricLabels: [],
    note: "All freshness today is manual-refresh / on-mount reads — there is no polling, websocket, or realtime channel. Realtime is an expensive resource to introduce selectively (schedule, active jobs, queue) at P5.",
  },
  {
    id: "ai",
    label: "AI Automation",
    description: "Future AI assistant, FAQ, booking assistance, support, reporting.",
    source: "none-yet",
    growth: "high",
    scalesWith: ["ai-calls"],
    status: "planned",
    metricLabels: [],
    note: "Not implemented. When added, every model call must be wrapped at the server boundary to attribute tokens/calls per company (see metering blueprint) — this is the dominant variable cost driver.",
  },
] as const;

/**
 * AI scalability blueprint — design-only risk assessment for future AI features.
 * No AI code exists yet; this anchors the cost model before anything is built.
 */
export interface AiFeatureRisk {
  feature: string;
  /** Rough call volume driver. */
  volumeDriver: string;
  /** Dominant cost driver. */
  costDriver: string;
  /** Relative scaling risk. */
  risk: GrowthRisk;
}

export const AI_FEATURE_RISKS: ReadonlyArray<AiFeatureRisk> = [
  {
    feature: "AI customer support / assistant",
    volumeDriver: "End-user messages × concurrent conversations",
    costDriver: "Input+output tokens per turn; context window growth",
    risk: "high",
  },
  {
    feature: "AI FAQ / knowledge answers",
    volumeDriver: "Question volume (cacheable for common questions)",
    costDriver: "Tokens per answer; embedding/index refresh",
    risk: "medium",
  },
  {
    feature: "AI booking assistance",
    volumeDriver: "Booking attempts requiring assistance",
    costDriver: "Multi-step tool calls; schedule context per request",
    risk: "high",
  },
  {
    feature: "AI reporting / summaries",
    volumeDriver: "Reports generated × data window size",
    costDriver: "Large input context (logs, visits) per generation",
    risk: "high",
  },
  {
    feature: "AI automation (background)",
    volumeDriver: "Triggered events × companies",
    costDriver: "Unbounded fan-out if not rate-limited per company",
    risk: "critical",
  },
] as const;
