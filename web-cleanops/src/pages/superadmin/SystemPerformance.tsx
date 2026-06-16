import { useCallback, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bot,
  CalendarRange,
  CheckCircle2,
  CircleDashed,
  Cpu,
  Database,
  Gauge,
  Globe,
  HardDrive,
  Info,
  Layers,
  ListChecks,
  PackageOpen,
  Plug,
  RefreshCw,
  Radio,
  RotateCcw,
  ShieldCheck,
  Timer,
  Workflow,
} from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { AccessDenied } from "@/components/AccessDenied";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useApp } from "@/context/AppContext";
import { perf } from "@/lib/perf";
import { buildBudgetReport, type BudgetGrade, type BudgetReportRow } from "@/lib/perf";
import {
  OPERATIONAL_SURFACES,
  AI_FEATURE_RISKS,
  SCHEDULE_SCALING,
  SCHEDULE_RISKS,
  SCHEDULE_INVALIDATION_RULES,
  SCHEDULE_REALTIME_EVENTS,
  type GrowthRisk,
  type MonitoringStatus,
  type ScheduleScalingGrade,
  type ScheduleInvalidationScope,
  type ScheduleRealtimeClass,
} from "@/lib/perf";
import {
  DATA_TIERS,
  STARTUP_BUDGETS,
  MIGRATION_READINESS,
  HYDRATION_RISKS,
  type DataTier,
} from "@/lib/perf";
import {
  MIGRATION_WAVES,
  ENTITY_MIGRATIONS,
  WAVE_RISKS,
  type WaveId,
} from "@/lib/perf";
import { validateWave0Parity, type ParityReport } from "@/lib/data";
import {
  validateWorkOrderParity,
  shadowReadWorkOrders,
  RESOLVER_INPUT_COVERAGE,
  getWorkOrderDualWriteState,
  getWorkOrderCutoverState,
  getWorkOrderBackoutMeta,
  getScheduleCutoverState,
  getEmployeeCutoverState,
  listScheduleSoakCompanies,
  type WorkOrderParityReport,
  type WorkOrderShadowReport,
  type WorkOrderDualWriteState,
  type WorkOrderCutoverState,
  type WorkOrderBackoutMeta,
  type ScheduleCutoverState,
  type EmployeeCutoverState,
  type ScheduleSoakReport,
} from "@/lib/data";
import {
  shadowReadCustomers,
  shadowReadCustomerDetail,
  getCustomerDualWriteState,
  getCustomerCutoverState,
  getCustomerBackoutMeta,
  type CustomerShadowReport,
  type CustomerDetailShadowReport,
  type CustomerDualWriteState,
  type CustomerSoakReport,
  type CustomerCutoverState,
  type CustomerBackoutMeta,
} from "@/lib/data";
import {
  SOAK_FLAGS,
  CUTOVER_CRITERIA,
  SOAK_READINESS,
  CUTOVER_EXIT_CRITERIA,
  CUSTOMER_MIGRATION_FINAL_STATUS,
  WRITE_STRATEGY,
  CUSTOMER_FLAG_AUDIT,
  CUSTOMER_DATA_SOURCE_MAP,
  ROLLBACK_DRILL,
  LIVE_STAGING_CHECKLIST,
  CUSTOMER_CLOSURE_AUDIT,
  WORK_ORDER_WAVES,
  WORK_ORDER_RISKS,
  WORK_ORDER_TABLES,
  SCHEDULE_FIELD_DEPENDENCIES,
  WORK_ORDER_DESIGN_VERDICT,
  WO_SOAK_FLAGS,
  WO_CUTOVER_CRITERIA,
  WO_SOAK_LIMITATIONS,
  WO_SOAK_READINESS,
  WO_AUTHORITY_MODEL,
  WO_WRITE_STRATEGY,
  WO_ROLLBACK_PLAN,
  WO_CUTOVER_EXIT_CRITERIA,
  WORK_ORDER_MIGRATION_FINAL_STATUS,
  SCHEDULE_INPUT_AUDIT,
  SCHEDULE_CONTRACT_DECISION,
  SCHEDULE_FETCH_CLASSES,
  SCHEDULE_CACHE_INVALIDATION,
  SCHEDULE_SHADOW_DIMENSIONS,
  SCHEDULE_DESIGN_RISKS,
  SCHEDULE_MIGRATION_DESIGN_VERDICT,
  SCHEDULE_FLAG_AUDIT,
  SCHEDULE_SOURCE_MAP,
  SCHEDULE_FALLBACK_PATH,
  SCHEDULE_ROLLBACK_DRILL,
  SCHEDULE_FUTURE_CLEANUP_CANDIDATES,
  SCHEDULE_CLOSURE_AUDIT,
  EMPLOYEE_READ_PATHS,
  EMPLOYEE_WRITE_PATHS,
  EMPLOYEE_SCHEDULE_DEPENDENCIES,
  EMPLOYEE_WAVES,
  EMPLOYEE_RISKS,
  EMPLOYEE_TABLES,
  EMPLOYEE_DESIGN_VERDICT,
  EMPLOYEE_EMP0_PARITY,
  EMPLOYEE_EMP1_DELIVERABLES,
  EMPLOYEE_CONTRACT_PROPOSALS,
} from "@/lib/perf";
import {
  CUSTOMERS_LIST_SUPABASE_READ,
  CUSTOMERS_DETAIL_SUPABASE_READ,
  CUSTOMERS_DUAL_WRITE,
  CUSTOMERS_SUPABASE_AUTHORITATIVE,
  WORK_ORDERS_LIST_SUPABASE_READ,
  WORK_ORDERS_DETAIL_SUPABASE_READ,
  WORK_ORDERS_DUAL_WRITE,
  WORK_ORDERS_SUPABASE_AUTHORITATIVE,
  SCHEDULE_SUPABASE_INTERVAL_READ,
  SCHEDULE_SUPABASE_AUTHORITATIVE,
  EMPLOYEES_SUPABASE_READ,
  USE_SUPABASE_AUTH,
  USE_SUPABASE_COMPANIES,
  TIME_REPORTING_DUAL_WRITE,
  TIME_REPORTING_SHADOW_VALIDATE,
  TIME_REPORTING_SUPABASE_READ,
  TIME_REPORTING_SUPABASE_AUTHORITATIVE,
  MISSION_LOG_DUAL_WRITE,
  MISSION_LOG_SUPABASE_READ,
  MISSION_LOG_SUPABASE_AUTHORITATIVE,
} from "@/lib/featureFlags";
import { getCustomers } from "@/lib/store";
import {
  BROWSER_DOMAIN_TOOL_DISABLED_REASON,
  canRunBrowserDomainBackoutTool,
  canRunBrowserDomainSoakTool,
} from "@/lib/data/runtimeQuarantine";

/** Wave 0 query-layer status (contracts + adapters are committed). */
const WAVE0_STATUS: ReadonlyArray<{
  label: string;
  detail: string;
  state: "ready" | "pending";
}> = [
  { label: "Query contracts", detail: "6 repositories: customers, employees, work orders, schedule, activity, time reports.", state: "ready" },
  { label: "Summary / detail DTOs", detail: "Lightweight list DTOs + full detail types, beside existing domain types.", state: "ready" },
  { label: "LocalStorage adapters", detail: "Wrap existing store getters; company scoping, search, pagination.", state: "ready" },
  { label: "Parity validation", detail: "Dev check (window.__cleanopsData) + automated suite parity.test.ts — all entities pass.", state: "ready" },
  { label: "Supabase adapters", detail: "Typed placeholders that throw NotImplementedError — filled in later waves.", state: "pending" },
];

/**
 * Wave 1A (Customers) migration status. Infrastructure only — the UI still
 * reads localStorage, so "UI switched?" stays "No" for the whole phase.
 */
const WAVE1A_STATUS: ReadonlyArray<{
  label: string;
  detail: string;
  state: "ready" | "pending" | "no";
}> = [
  { label: "Schema", detail: "customers table (flat columns + data jsonb) — migration 0007.", state: "ready" },
  { label: "Indexes", detail: "(company, customer_number) / (company, name) / (company, created_at desc).", state: "ready" },
  { label: "RLS", detail: "Company-scoped read/write + super_admin override; anon blocked; no delete.", state: "ready" },
  { label: "Repository", detail: "SupabaseCustomerRepository — list / detail / search / count, returns Wave 0 DTOs.", state: "ready" },
  { label: "Migration tool", detail: "Browser-origin migration execution quarantined; use reviewed server-side/controlled validation plan.", state: "ready" },
  { label: "Shadow read", detail: "shadowReadCustomers() — read-only count / id / summary / detail diff.", state: "ready" },
  { label: "Validation (P4E)", detail: "15-case suite: execution, mapping, parity, CRUD, search, pagination, idempotency, scoping — all green.", state: "ready" },
  { label: "UI switched?", detail: "Wave 1B — Customers LIST read is now flag-gated; Customer Card & writes stay localStorage.", state: "no" },
];

/**
 * Wave 1B (P4F) — Customer LIST read switch, gated by
 * {@link CUSTOMERS_LIST_SUPABASE_READ}. Only list reads move; the Customer Card
 * and every write stay on localStorage. Rollback = flag OFF.
 */
const WAVE1B_STATUS: ReadonlyArray<{
  label: string;
  detail: string;
  state: "ready" | "pending" | "no";
}> = [
  { label: "Feature flag", detail: "customers_list_supabase_read (EXPO_PUBLIC_CUSTOMERS_LIST_SUPABASE_READ) — default OFF.", state: "ready" },
  { label: "List read path", detail: "listFullCustomersFromSupabase() — full records behind the CustomerRepository seam, instrumented.", state: "ready" },
  { label: "Fallback", detail: "Supabase unreachable / empty / error → list transparently uses localStorage; never blanks.", state: "ready" },
  { label: "Background shadow read", detail: "shadowReadCustomers() runs on each load; drift surfaced (console.warn), never hidden.", state: "ready" },
  { label: "Validation (P4F)", detail: "customerListRead.test.ts — full-record round-trip, company scoping, empty/unscoped cases — green.", state: "ready" },
  { label: "Customer Card / writes", detail: "Wave 1C — Customer Card DETAIL read is now flag-gated; writes (create / update / archive) stay localStorage.", state: "no" },
  { label: "Rollback", detail: "Instant & data-free: set the flag OFF. No data rollback required.", state: "ready" },
];

/**
 * Wave 1C (P4G) — Customer Card DETAIL read switch, gated by
 * {@link CUSTOMERS_DETAIL_SUPABASE_READ}. Only the card's detail read moves; the
 * list flag is independent and every write stays on localStorage. Rollback = flag OFF.
 */
const WAVE1C_STATUS: ReadonlyArray<{
  label: string;
  detail: string;
  state: "ready" | "pending" | "no";
}> = [
  { label: "Feature flag", detail: "customers_detail_supabase_read (EXPO_PUBLIC_CUSTOMERS_DETAIL_SUPABASE_READ) — default OFF, independent of the list flag.", state: "ready" },
  { label: "Detail read path", detail: "SupabaseCustomerRepository.getDetail() — full record behind the CustomerRepository seam, instrumented & viewer-scoped.", state: "ready" },
  { label: "Fallback", detail: "Supabase unreachable / no row / error → card transparently uses localStorage; never breaks.", state: "ready" },
  { label: "Background shadow read", detail: "shadowReadCustomerDetail() runs on each load; field-level drift surfaced (console.warn), never hidden.", state: "ready" },
  { label: "Validation (P4G)", detail: "customerDetailRead.test.ts — full-record round-trip, field parity, cross-company block, missing-id, unscoped — green.", state: "ready" },
  { label: "Writes / tabs", detail: "Unchanged — writes stay localStorage; Work Orders / Invoices / Media / Protocols tabs read their own sources.", state: "no" },
  { label: "Rollback", detail: "Instant & data-free: set the flag OFF. No data rollback required.", state: "ready" },
];

/**
 * Wave 1D (P4H) — Customer DUAL WRITE, gated by {@link CUSTOMERS_DUAL_WRITE}.
 * localStorage stays authoritative; writes are mirrored to Supabase in the
 * background. Reads are governed by the independent list / detail flags.
 * Rollback = flag OFF.
 */
const WAVE1D_STATUS: ReadonlyArray<{
  label: string;
  detail: string;
  state: "ready" | "pending" | "no";
}> = [
  { label: "Feature flag", detail: "customers_dual_write (EXPO_PUBLIC_CUSTOMERS_DUAL_WRITE) — default OFF, independent of the read flags.", state: "ready" },
  { label: "Write seam", detail: "persistCustomers() — every create / update / archive funnels here; localStorage written first, then mirrored.", state: "ready" },
  { label: "Mirror", detail: "mirrorCustomerWrites() — fire-and-forget upsert on legacy_id; prev→next diff (create / update / removal).", state: "ready" },
  { label: "Authoritative source", detail: "localStorage — Supabase failure / timeout never blocks the customer operation; drift recorded.", state: "no" },
  { label: "Post-write validation", detail: "Re-reads each mirrored row; compares legacy_id / company / number / status / updated_at — drift surfaced.", state: "ready" },
  { label: "Validation (P4H)", detail: "customerDualWrite.test.ts — create / update / archive / idempotency / failure / scope / removal — green.", state: "ready" },
  { label: "Rollback", detail: "Instant & data-free: set the flag OFF. No data rollback required.", state: "ready" },
];

/**
 * Wave 1F (P4J) — Customer SOURCE-OF-TRUTH cut-over, gated by
 * {@link CUSTOMERS_SUPABASE_AUTHORITATIVE}. The first true authority switch:
 * Supabase becomes primary for reads + the authoritative write target, while
 * localStorage is kept as a synchronized backout copy. Rollback = flag OFF.
 */
const WAVE1F_STATUS: ReadonlyArray<{
  label: string;
  detail: string;
  state: "ready" | "pending" | "no";
}> = [
  { label: "Feature flag", detail: "customers_supabase_authoritative (EXPO_PUBLIC_CUSTOMERS_SUPABASE_AUTHORITATIVE) — default OFF; implies the read paths when ON.", state: "ready" },
  { label: "Read cut-over", detail: "List + Card read Supabase as PRIMARY; on failure fall back to the localStorage backout copy — recorded, never silent.", state: "ready" },
  { label: "Write cut-over", detail: "Strategy B: localStorage backout copy written first, then the authoritative Supabase mirror; mirror failures escalated.", state: "ready" },
  { label: "Backout snapshot", detail: "Browser-origin backout export quarantined; prior read-only META can still be displayed.", state: "ready" },
  { label: "Divergence handling", detail: "Read fallbacks + authoritative write failures tracked in getCustomerCutoverState(); RLS/timeout/mapping cases documented.", state: "ready" },
  { label: "Rollback", detail: "Single flag OFF → localStorage authoritative again; backout copy already current, so no data migration.", state: "ready" },
  { label: "Production authority", detail: "Stays OFF until live staging sign-off; this wave ships the reversible mechanism only.", state: "no" },
];

interface PerfSnapshot {
  counters: Record<string, number>;
  caches: Record<string, { hits: number; misses: number; hitRate: number }>;
  timers: Record<string, { calls: number; totalMs: number; maxMs: number; avgMs: number }>;
}

/** Future usage-monitoring categories (informational placeholder only). */
const FUTURE_USAGE_CATEGORIES: ReadonlyArray<{ label: string; detail: string }> = [
  { label: "Storage", detail: "Bytes stored per company (after object-storage migration)." },
  { label: "Media", detail: "Image/file count and bytes, attributed per company." },
  { label: "AI", detail: "Model tokens and call counts from future AI/automation features." },
  { label: "API", detail: "Read/write calls at the server boundary, per company." },
  { label: "Notifications", detail: "Push / email / SMS volume per company." },
  { label: "Exports", detail: "Report and data-export operations per company." },
  { label: "Realtime", detail: "Connection-minutes for live schedule / queue channels." },
];

/** Documented render/effect audit findings produced with the new instrumentation. */
const AUDIT_FINDINGS: ReadonlyArray<{
  severity: "confirmed" | "suspected" | "clear";
  area: string;
  finding: string;
}> = [
  {
    severity: "clear",
    area: "Schedule",
    finding:
      "Interval cache + referenceToken invalidation working as designed — revisiting a period serves from cache. Heavy resolveScheduleProgram runs only on a real miss.",
  },
  {
    severity: "clear",
    area: "Customer Card / Work Order",
    finding:
      "Detail tabs unmount when inactive (Radix), so heavy detail content is genuinely detail-on-demand. Count badges are memoized rather than re-scanning full arrays each render.",
  },
  {
    severity: "suspected",
    area: "Booking Lists",
    finding:
      "Cumulative render count climbs on filter/sort interactions. Worth confirming the filter/sort memo dependencies are stable before the queue grows; no per-render array scan observed yet.",
  },
  {
    severity: "suspected",
    area: "Employees",
    finding:
      "List re-renders on each debounced query change as expected. Confirm pagination slice is memoized so a keystroke below threshold does not re-slice the full list.",
  },
  {
    severity: "clear",
    area: "Dashboard (Overview)",
    finding:
      "Renders on mount and on data mutation only. No effect loop or redundant re-render detected with instrumentation.",
  },
];

/** Wave-id → its risk row, for the migration table. */
const WAVE_RISK_BY_WAVE: Partial<Record<WaveId, (typeof WAVE_RISKS)[number]>> = Object.fromEntries(
  WAVE_RISKS.map((r) => [r.wave, r]),
);

const GRADE_STYLES: Readonly<Record<BudgetGrade, { label: string; cls: string }>> = {
  pass: { label: "Pass", cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  warning: { label: "Warning", cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  fail: { label: "Fail", cls: "bg-red-500/10 text-red-600 dark:text-red-400" },
  informational: { label: "Info", cls: "bg-sky-500/10 text-sky-600 dark:text-sky-400" },
  "pre-migration": { label: "Pre-migration", cls: "bg-muted text-muted-foreground" },
  "no-data": { label: "No data", cls: "bg-muted text-muted-foreground" },
};

function GradeBadge({ grade }: { grade: BudgetGrade }) {
  const s = GRADE_STYLES[grade];
  return (
    <span className={cn("inline-flex rounded-md px-2 py-0.5 text-xs font-medium", s.cls)}>
      {s.label}
    </span>
  );
}

const GROWTH_STYLES: Readonly<Record<GrowthRisk, string>> = {
  low: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  medium: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  high: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  critical: "bg-red-500/10 text-red-600 dark:text-red-400",
};

const TIER_STYLES: Readonly<Record<DataTier, { label: string; cls: string }>> = {
  A: { label: "Tier A · Core session", cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  B: { label: "Tier B · Summaries", cls: "bg-sky-500/10 text-sky-600 dark:text-sky-400" },
  C: { label: "Tier C · Operational", cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  D: { label: "Tier D · Detail / lazy", cls: "bg-red-500/10 text-red-600 dark:text-red-400" },
};

const SCALING_GRADE_STYLES: Readonly<Record<ScheduleScalingGrade, string>> = {
  ok: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  watch: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  risk: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  critical: "bg-red-500/10 text-red-600 dark:text-red-400",
};

const INVALIDATION_STYLES: Readonly<Record<ScheduleInvalidationScope, string>> = {
  "current-interval": "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  "neighbouring-intervals": "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  "all-intervals": "bg-red-500/10 text-red-600 dark:text-red-400",
};

const REALTIME_STYLES: Readonly<Record<ScheduleRealtimeClass, string>> = {
  immediate: "bg-red-500/10 text-red-600 dark:text-red-400",
  "on-refresh": "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  lazy: "bg-muted text-muted-foreground",
};

const STATUS_STYLES: Readonly<Record<MonitoringStatus, { label: string; cls: string }>> = {
  live: { label: "Live", cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  partial: { label: "Partial", cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  planned: { label: "Planned", cls: "bg-muted text-muted-foreground" },
};

/** Renders a compact live value for a single instrumentation label, if present. */
function liveMetricValue(label: string, snapshot: PerfSnapshot): string | null {
  if (label in snapshot.counters) return `${snapshot.counters[label]}×`;
  const cache = snapshot.caches[label];
  if (cache) {
    const total = cache.hits + cache.misses;
    return total === 0 ? "0 hits" : `${Math.round(cache.hitRate * 100)}% hit · ${total}`;
  }
  const timer = snapshot.timers[label];
  if (timer) return `${timer.calls}× · avg ${timer.avgMs.toFixed(2)}ms`;
  return null;
}

function MetricCard({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Activity;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-4 flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function yesNo(value: boolean | null): string {
  if (value == null) return "—";
  return value ? "yes" : "no";
}

function shortList(values: string[], empty = "—"): string {
  if (values.length === 0) return empty;
  const visible = values.slice(0, 6).join(", ");
  return values.length > 6 ? `${visible}, +${values.length - 6} more` : visible;
}

function sqlLegacyHelper(legacyId: string | null | undefined): string {
  if (!legacyId) return "Create or update one Work Order, then click Refresh to populate a legacy_id.";
  const escaped = legacyId.split("'").join("''");
  return `select *\nfrom public.work_orders\nwhere legacy_id = '${escaped}';\n\nselect *\nfrom public.work_order_service_rows\nwhere work_order_legacy_id = '${escaped}';`;
}

/** Expected validation source-of-truth origin (the canonical preview build). */
const CANONICAL_ORIGIN = "https://p-s82qmcrckv49fzqoe6qu3.rork.live";
/** Expected Supabase project ref for this project's backend. */
const EXPECTED_SUPABASE_REF = "swqcdcpwofdnmoureifu";

type OriginKind =
  | "canonical"
  | "production-domain"
  | "rork-wrapper"
  | "foreign-preview"
  | "other";

interface EnvironmentMarker {
  origin: string;
  host: string;
  kind: OriginKind;
  kindLabel: string;
  isCanonical: boolean;
  warning: string | null;
  supabaseUrl: string;
  supabaseRef: string;
  supabaseRefMatches: boolean;
  buildTimestamp: string;
  buildMode: string;
}

/** Extracts the Supabase project ref (subdomain) from a Supabase URL. */
function parseSupabaseRef(url: string | undefined): string {
  if (!url) return "—";
  const match = url.match(/^https?:\/\/([^.]+)\.supabase\.(co|in|net)/i);
  return match?.[1] ?? "—";
}

/** Classifies the current origin/host against the known deployment surfaces. */
function classifyOrigin(host: string): { kind: OriginKind; label: string } {
  const h = host.toLowerCase();
  if (h === "p-s82qmcrckv49fzqoe6qu3.rork.live") {
    return { kind: "canonical", label: "Canonical preview (source of truth)" };
  }
  if (h.endsWith("stadportalen.se")) {
    return { kind: "production-domain", label: "Production custom domain" };
  }
  if (h === "rork.com" || h.endsWith(".rork.com")) {
    return { kind: "rork-wrapper", label: "Rork wrapper (not the app itself)" };
  }
  if (h.endsWith(".rork.live")) {
    return { kind: "foreign-preview", label: "Other / stale rork.live preview" };
  }
  return { kind: "other", label: "Unrecognised origin" };
}

/** Builds the read-only environment/build marker from the live runtime. */
function buildEnvironmentMarker(): EnvironmentMarker {
  const origin = typeof window !== "undefined" ? window.location.origin : "—";
  const host = typeof window !== "undefined" ? window.location.host : "—";
  const { kind, label } = classifyOrigin(host);
  const isCanonical = kind === "canonical";
  const supabaseUrl = import.meta.env.EXPO_PUBLIC_SUPABASE_URL ?? "—";
  const supabaseRef = parseSupabaseRef(import.meta.env.EXPO_PUBLIC_SUPABASE_URL);

  let warning: string | null = null;
  if (!isCanonical) {
    warning =
      `Validation source of truth is ${CANONICAL_ORIGIN}. ` +
      "This origin may have different localStorage/session/cache or baked flags.";
  }

  return {
    origin,
    host,
    kind,
    kindLabel: label,
    isCanonical,
    warning,
    supabaseUrl,
    supabaseRef,
    supabaseRefMatches: supabaseRef === EXPECTED_SUPABASE_REF,
    buildTimestamp: typeof __BUILD_TIMESTAMP__ === "string" ? __BUILD_TIMESTAMP__ : "—",
    buildMode: typeof __BUILD_MODE__ === "string" ? __BUILD_MODE__ : import.meta.env.MODE,
  };
}

function DiagnosticRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-3 rounded-xl border border-border bg-background px-3 py-2">
      <span className="shrink-0 text-[11px] text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-right text-[11px] font-medium">{value}</span>
    </div>
  );
}

/**
 * Super Admin–only System Performance monitor.
 *
 * A lightweight, internal diagnostics surface over the dev instrumentation layer
 * (`__cleanopsPerf`). It is read-only and introduces no external services or
 * backend dependencies — it simply snapshots the in-process metrics on demand so
 * we can validate the P1–P3 foundations before the operational-data migration.
 */
export default function SystemPerformance() {
  const { currentUser } = useApp();
  const [snapshot, setSnapshot] = useState<PerfSnapshot>(() => perf.snapshot());
  const [budgets, setBudgets] = useState<BudgetReportRow[]>(() => buildBudgetReport());
  const [parity, setParity] = useState<ParityReport | null>(null);
  const [woParity, setWoParity] = useState<WorkOrderParityReport | null>(null);
  const [woShadow, setWoShadow] = useState<WorkOrderShadowReport | null>(null);
  const [woShadowRunning, setWoShadowRunning] = useState<boolean>(false);
  const [shadow, setShadow] = useState<CustomerShadowReport | null>(null);
  const [shadowRunning, setShadowRunning] = useState<boolean>(false);
  const [detailShadow, setDetailShadow] = useState<CustomerDetailShadowReport | null>(null);
  const [detailShadowRunning, setDetailShadowRunning] = useState<boolean>(false);
  const [dualWrite, setDualWrite] = useState<CustomerDualWriteState>(() =>
    getCustomerDualWriteState(),
  );
  const [soak, setSoak] = useState<CustomerSoakReport | null>(null);
  const [soakRunning, setSoakRunning] = useState<boolean>(false);
  const [cutover, setCutover] = useState<CustomerCutoverState>(() =>
    getCustomerCutoverState(),
  );
  const [backout, setBackout] = useState<CustomerBackoutMeta | null>(() =>
    getCustomerBackoutMeta(),
  );
  const [woDualWrite, setWoDualWrite] = useState<WorkOrderDualWriteState>(() =>
    getWorkOrderDualWriteState(),
  );
  const [woCutover, setWoCutover] = useState<WorkOrderCutoverState>(() =>
    getWorkOrderCutoverState(),
  );
  const [woBackout, setWoBackout] = useState<WorkOrderBackoutMeta | null>(() =>
    getWorkOrderBackoutMeta(),
  );
  const [scheduleCutover, setScheduleCutover] = useState<ScheduleCutoverState>(() =>
    getScheduleCutoverState(),
  );
  const [scheduleSoak, setScheduleSoak] = useState<ScheduleSoakReport | null>(null);
  const [scheduleSoakRunning, setScheduleSoakRunning] = useState<boolean>(false);

  const refreshScheduleCutover = useCallback(() => {
    setScheduleCutover(getScheduleCutoverState());
  }, []);

  const [employeeCutover, setEmployeeCutover] = useState<EmployeeCutoverState>(() =>
    getEmployeeCutoverState(),
  );

  const refreshEmployeeCutover = useCallback(() => {
    setEmployeeCutover(getEmployeeCutoverState());
  }, []);

  const runScheduleSoak = useCallback(() => {
    // Phase 2B quarantine: the soak harness can read browser-domain stores and
    // execute rollback/fallback drills. It is retained for reviewed validation,
    // but is not callable from the deployed normal runtime.
    if (!canRunBrowserDomainSoakTool()) {
      setScheduleSoak(null);
      setScheduleCutover(getScheduleCutoverState());
      return;
    }
    const companyId = listScheduleSoakCompanies()[0];
    if (!companyId) {
      setScheduleSoak(null);
      return;
    }
    setScheduleSoakRunning(false);
  }, []);

  const refreshDualWrite = useCallback(() => {
    setDualWrite(getCustomerDualWriteState());
  }, []);

  const refreshWoDualWrite = useCallback(() => {
    setWoDualWrite(getWorkOrderDualWriteState());
  }, []);

  const refreshCutover = useCallback(() => {
    setCutover(getCustomerCutoverState());
    setBackout(getCustomerBackoutMeta());
  }, []);

  const takeBackout = useCallback(() => {
    // Phase 2B quarantine: browser-origin backout exports read app-owned
    // persistent domain data, so the action is disabled in normal runtime.
    if (!canRunBrowserDomainBackoutTool()) {
      setBackout(getCustomerBackoutMeta());
      setCutover(getCustomerCutoverState());
      return;
    }
  }, []);

  const refreshWoCutover = useCallback(() => {
    setWoCutover(getWorkOrderCutoverState());
    setWoBackout(getWorkOrderBackoutMeta());
    setWoDualWrite(getWorkOrderDualWriteState());
  }, []);

  const takeWoBackout = useCallback(() => {
    // Phase 2B quarantine: browser-origin backout exports read app-owned
    // persistent domain data, so the action is disabled in normal runtime.
    if (!canRunBrowserDomainBackoutTool()) {
      setWoBackout(getWorkOrderBackoutMeta());
      setWoCutover(getWorkOrderCutoverState());
      return;
    }
  }, []);

  const runSoak = useCallback(() => {
    // Phase 2B quarantine: the customer soak harness mutates browser-domain
    // stores and can mirror into Supabase. It is retained for reviewed
    // validation, but is not callable from the deployed normal runtime.
    if (!canRunBrowserDomainSoakTool()) {
      setSoak(null);
      setSoakRunning(false);
      setDualWrite(getCustomerDualWriteState());
      return;
    }
  }, []);

  const runParity = useCallback(() => {
    void validateWave0Parity().then(setParity);
  }, []);

  const runWoParity = useCallback(() => {
    void validateWorkOrderParity().then(setWoParity);
  }, []);

  const runWoShadow = useCallback(() => {
    setWoShadowRunning(true);
    void shadowReadWorkOrders()
      .then(setWoShadow)
      .finally(() => setWoShadowRunning(false));
  }, []);

  const runShadow = useCallback(() => {
    setShadowRunning(true);
    void shadowReadCustomers()
      .then(setShadow)
      .finally(() => setShadowRunning(false));
  }, []);

  const runDetailShadow = useCallback(() => {
    // Sample the first customer (unscoped) — super admin view.
    const sample = getCustomers()[0];
    if (!sample) {
      setDetailShadow(null);
      return;
    }
    setDetailShadowRunning(true);
    void shadowReadCustomerDetail(sample.id)
      .then(setDetailShadow)
      .finally(() => setDetailShadowRunning(false));
  }, []);

  const refresh = useCallback(() => {
    setSnapshot(perf.snapshot());
    setBudgets(buildBudgetReport());
    setDualWrite(getCustomerDualWriteState());
    setWoDualWrite(getWorkOrderDualWriteState());
  }, []);

  const reset = useCallback(() => {
    perf.reset();
    setSnapshot(perf.snapshot());
    setBudgets(buildBudgetReport());
  }, []);

  if (currentUser?.role !== "super_admin") return <AccessDenied />;

  const counterEntries = Object.entries(snapshot.counters).sort((a, b) => b[1] - a[1]);
  const cacheEntries = Object.entries(snapshot.caches).sort((a, b) => a[0].localeCompare(b[0]));
  const timerEntries = Object.entries(snapshot.timers).sort((a, b) => b[1].totalMs - a[1].totalMs);
  const latestWoRun = woDualWrite.latestRun;
  const latestWoIdentity = latestWoRun?.latestIdentity ?? null;
  const latestWoLegacyId =
    latestWoIdentity?.legacyId ??
    latestWoRun?.diff.created[0] ??
    latestWoRun?.diff.updated[0] ??
    null;
  const marker = buildEnvironmentMarker();

  return (
    <DashboardLayout wide>
      <PageHeader
        title="System Performance"
        description="Internal diagnostics over the in-app performance instrumentation. Read-only — no external monitoring, no backend, no billing. Validates the P1–P3 foundations ahead of operational-data migration."
        action={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={reset}>
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              Reset
            </Button>
            <Button size="sm" onClick={refresh}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Refresh
            </Button>
          </div>
        }
      />

      {!perf.enabled ? (
        <div className="mb-6 flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Instrumentation is <strong>disabled in this build</strong> (it only collects in
            development). Metrics below will stay empty here by design — the collection code is
            dead-code-eliminated in production, so there is zero runtime overhead. Open this page
            from a development build to see live numbers.
          </p>
        </div>
      ) : (
        <div className="mb-6 flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Numbers are <strong>cumulative for this session</strong>. Use{" "}
            <strong>Reset</strong> to zero the counters, exercise a page, then{" "}
            <strong>Refresh</strong> to read a clean measurement. The same data is available in the
            console via <code className="rounded bg-muted px-1">__cleanopsPerf.table()</code>.
          </p>
        </div>
      )}

      {/* Environment / build marker — read-only. Confirms which origin, backend
          and baked flags you are testing before any validation run. */}
      <div className="mb-6 overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Globe className="h-4 w-4 text-muted-foreground" />
            Environment &amp; Build Marker (diagnostics)
          </div>
          <span
            className={cn(
              "rounded-md px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
              marker.isCanonical
                ? "bg-emerald-500/15 text-emerald-600"
                : "bg-amber-500/15 text-amber-600",
            )}
          >
            {marker.isCanonical ? "Source of truth" : "Non-canonical origin"}
          </span>
        </div>
        <div className="space-y-4 px-4 py-3">
          {marker.warning ? (
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{marker.warning}</p>
            </div>
          ) : (
            <div className="flex items-start gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-700 dark:text-emerald-400">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                You are on the canonical validation origin (
                <code className="rounded bg-muted px-1">{CANONICAL_ORIGIN}</code>). Safe to validate.
              </p>
            </div>
          )}

          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Environment / origin
            </p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <DiagnosticRow label="window.location.origin" value={<code>{marker.origin}</code>} />
              <DiagnosticRow label="Host" value={<code>{marker.host}</code>} />
              <DiagnosticRow label="Origin classification" value={marker.kindLabel} />
            </div>
          </div>

          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Supabase backend
            </p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <DiagnosticRow label="EXPO_PUBLIC_SUPABASE_URL" value={<code>{marker.supabaseUrl}</code>} />
              <DiagnosticRow label="Project ref" value={<code>{marker.supabaseRef}</code>} />
              <DiagnosticRow
                label="Matches expected project"
                value={
                  marker.supabaseRefMatches
                    ? `yes (${EXPECTED_SUPABASE_REF})`
                    : `NO — expected ${EXPECTED_SUPABASE_REF}`
                }
              />
            </div>
          </div>

          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Build / bundle identity
            </p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <DiagnosticRow label="Build timestamp" value={<code>{marker.buildTimestamp}</code>} />
              <DiagnosticRow label="Build mode" value={marker.buildMode} />
            </div>
          </div>

          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Critical effective flags
            </p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <DiagnosticRow label="USE_SUPABASE_AUTH" value={USE_SUPABASE_AUTH ? "ON" : "OFF"} />
              <DiagnosticRow label="USE_SUPABASE_COMPANIES" value={USE_SUPABASE_COMPANIES ? "ON" : "OFF"} />
              <DiagnosticRow label="WORK_ORDERS_DUAL_WRITE" value={WORK_ORDERS_DUAL_WRITE ? "ON" : "OFF"} />
              <DiagnosticRow label="WORK_ORDERS_LIST_SUPABASE_READ" value={WORK_ORDERS_LIST_SUPABASE_READ ? "ON" : "OFF"} />
              <DiagnosticRow label="WORK_ORDERS_DETAIL_SUPABASE_READ" value={WORK_ORDERS_DETAIL_SUPABASE_READ ? "ON" : "OFF"} />
              <DiagnosticRow label="WORK_ORDERS_SUPABASE_AUTHORITATIVE" value={WORK_ORDERS_SUPABASE_AUTHORITATIVE ? "ON" : "OFF"} />
              <DiagnosticRow label="TIME_REPORTING_DUAL_WRITE" value={TIME_REPORTING_DUAL_WRITE ? "ON" : "OFF"} />
              <DiagnosticRow label="TIME_REPORTING_SHADOW_VALIDATE" value={TIME_REPORTING_SHADOW_VALIDATE ? "ON" : "OFF"} />
              <DiagnosticRow label="TIME_REPORTING_SUPABASE_READ" value={TIME_REPORTING_SUPABASE_READ ? "ON" : "OFF"} />
              <DiagnosticRow label="TIME_REPORTING_SUPABASE_AUTHORITATIVE" value={TIME_REPORTING_SUPABASE_AUTHORITATIVE ? "ON" : "OFF"} />
              <DiagnosticRow label="MISSION_LOG_DUAL_WRITE" value={MISSION_LOG_DUAL_WRITE ? "ON" : "OFF"} />
              <DiagnosticRow label="MISSION_LOG_SUPABASE_READ" value={MISSION_LOG_SUPABASE_READ ? "ON" : "OFF"} />
              <DiagnosticRow label="MISSION_LOG_SUPABASE_AUTHORITATIVE" value={MISSION_LOG_SUPABASE_AUTHORITATIVE ? "ON" : "OFF"} />
            </div>
          </div>

          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Known deployment surfaces
            </p>
            <div className="space-y-1.5 text-[11px] text-muted-foreground">
              <p>
                <code className="rounded bg-muted px-1">p-s82qmcrckv49fzqoe6qu3.rork.live</code> — canonical preview, the validation source of truth.
              </p>
              <p>
                <code className="rounded bg-muted px-1">p-ukozrrmcbauwwj0jdhs6w.rork.live</code> — obsolete / foreign preview, do not use.
              </p>
              <p>
                <code className="rounded bg-muted px-1">rork.com/p/s82qmcrckv49fzqoe6qu3</code> — a wrapper around the app, not the app itself.
              </p>
              <p>
                <code className="rounded bg-muted px-1">www.stadportalen.se</code> — production-equivalent custom domain; may carry a different baked env-flag set.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <MetricCard icon={Activity} title="Render Metrics">
          {counterEntries.length === 0 ? (
            <EmptyHint>No renders recorded yet. Navigate the app, then Refresh.</EmptyHint>
          ) : (
            <div className="space-y-2">
              {counterEntries.map(([label, value]) => (
                <div key={label} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-mono font-medium tabular-nums">{value}</span>
                </div>
              ))}
            </div>
          )}
        </MetricCard>

        <MetricCard icon={Database} title="Cache Metrics">
          {cacheEntries.length === 0 ? (
            <EmptyHint>No cache activity recorded yet.</EmptyHint>
          ) : (
            <div className="space-y-3">
              {cacheEntries.map(([label, stat]) => {
                const total = stat.hits + stat.misses;
                return (
                  <div key={label} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="font-mono font-medium tabular-nums">
                        {Math.round(stat.hitRate * 100)}%
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-[width]"
                        style={{ width: `${Math.round(stat.hitRate * 100)}%` }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {stat.hits} hits · {stat.misses} misses · {total} total
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </MetricCard>

        <MetricCard icon={Timer} title="Computation Metrics">
          {timerEntries.length === 0 ? (
            <EmptyHint>No heavy computations timed yet.</EmptyHint>
          ) : (
            <div className="space-y-2">
              {timerEntries.map(([label, stat]) => (
                <div key={label} className="text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-mono font-medium tabular-nums">{stat.calls}×</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    avg {stat.avgMs.toFixed(2)} ms · max {stat.maxMs.toFixed(2)} ms
                  </p>
                </div>
              ))}
            </div>
          )}
        </MetricCard>
      </div>

      {/* Budget validation */}
      <div className="mt-8">
        <div className="mb-3 flex items-center gap-2">
          <Gauge className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-base font-semibold">Performance Budget Validation</h2>
        </div>
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Page</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Dimensions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {budgets.map((row) => (
                <tr key={row.page} className="align-top">
                  <td className="px-4 py-3">
                    <div className="font-medium">{row.label}</div>
                    {row.notes ? (
                      <div className="mt-1 max-w-md text-xs text-muted-foreground">{row.notes}</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <GradeBadge grade={row.status} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="space-y-1.5">
                      {row.dimensions.map((d) => (
                        <div
                          key={d.label}
                          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
                        >
                          <GradeBadge grade={d.grade} />
                          <span className="text-muted-foreground">{d.label}:</span>
                          <span className="font-mono">{d.observed}</span>
                          <span className="text-muted-foreground">/ target {d.target}</span>
                        </div>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Reporting only — no budget is enforced. Query and payload targets describe the desired
          post-migration state and are not measurable while operational data lives in memory.
        </p>
      </div>

      {/* Render / effect audit */}
      <div className="mt-8">
        <div className="mb-3 flex items-center gap-2">
          <Cpu className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-base font-semibold">Render &amp; Effect Audit</h2>
        </div>
        <div className="space-y-2.5">
          {AUDIT_FINDINGS.map((f) => {
            const Icon =
              f.severity === "confirmed"
                ? AlertTriangle
                : f.severity === "suspected"
                  ? CircleDashed
                  : CheckCircle2;
            const tone =
              f.severity === "confirmed"
                ? "text-red-600 dark:text-red-400"
                : f.severity === "suspected"
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-emerald-600 dark:text-emerald-400";
            const tag =
              f.severity === "confirmed"
                ? "Confirmed"
                : f.severity === "suspected"
                  ? "Suspected"
                  : "No action";
            return (
              <div
                key={f.area}
                className="flex items-start gap-3 rounded-xl border border-border bg-card p-4"
              >
                <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", tone)} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{f.area}</span>
                    <span className={cn("text-xs font-medium", tone)}>{tag}</span>
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">{f.finding}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Operational surfaces (OP1) */}
      <div className="mt-8">
        <div className="mb-3 flex items-center gap-2">
          <Layers className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-base font-semibold">Operational Surfaces</h2>
        </div>
        <p className="mb-4 max-w-3xl text-sm text-muted-foreground">
          The surfaces most likely to drive cost as CleanOps grows, with their data source, growth
          risk and live instrumentation. Sections marked <strong>Planned</strong> have no metrics
          yet by design — they reserve a place in the monitoring layout for future operational and
          migration work.
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          {OPERATIONAL_SURFACES.map((s) => {
            const status = STATUS_STYLES[s.status];
            const liveLabels = s.metricLabels
              .map((label) => ({ label, value: liveMetricValue(label, snapshot) }))
              .filter((m) => m.value !== null);
            return (
              <div key={s.id} className="rounded-2xl border border-border bg-card p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold">{s.label}</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">{s.description}</p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-md px-2 py-0.5 text-xs font-medium",
                      status.cls,
                    )}
                  >
                    {status.label}
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <span className={cn("rounded-md px-2 py-0.5 text-[11px] font-medium", GROWTH_STYLES[s.growth])}>
                    {s.growth} growth
                  </span>
                  <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {s.source}
                  </span>
                  {s.scalesWith.map((d) => (
                    <span
                      key={d}
                      className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground"
                    >
                      {d}
                    </span>
                  ))}
                </div>

                {liveLabels.length > 0 ? (
                  <div className="mt-3 space-y-1 border-t border-border pt-3">
                    {liveLabels.map((m) => (
                      <div key={m.label} className="flex items-center justify-between text-xs">
                        <span className="truncate text-muted-foreground">{m.label}</span>
                        <span className="ml-2 shrink-0 font-mono tabular-nums">{m.value}</span>
                      </div>
                    ))}
                  </div>
                ) : s.metricLabels.length > 0 ? (
                  <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
                    No activity recorded yet — exercise this surface, then Refresh.
                  </p>
                ) : null}

                <p className="mt-3 text-xs text-muted-foreground">{s.note}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Schedule architecture & scalability (OP3) */}
      <div className="mt-8">
        <div className="mb-3 flex items-center gap-2">
          <CalendarRange className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-base font-semibold">Schedule Architecture &amp; Scalability</h2>
        </div>
        <p className="mb-4 max-w-3xl text-sm text-muted-foreground">
          Forward-looking design for the Schedule — the surface with the highest growth risk.
          Blueprint only: no migration, no behaviour change. The full typed contract (dependency
          map, summary object, server query model, cache &amp; invalidation rules) lives in{" "}
          <code className="rounded bg-muted px-1">schedule.blueprint.ts</code>.
        </p>

        <div className="grid gap-4 lg:grid-cols-2">
          {SCHEDULE_SCALING.map((s) => (
            <div key={s.id} className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold">
                    Scenario {s.id} · {s.label}
                  </h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {s.weekOccurrences} occurrences / week
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-md px-2 py-0.5 text-xs font-medium",
                    SCALING_GRADE_STYLES[s.grade],
                  )}
                >
                  {s.grade}
                </span>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Compute:</span> {s.computeCost}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Cache:</span> {s.cacheEffectiveness}
              </p>
              <p className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">{s.note}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">#</th>
                <th className="px-4 py-3 font-medium">Schedule risk</th>
                <th className="px-4 py-3 font-medium">Bites at</th>
                <th className="px-4 py-3 font-medium">Phase</th>
                <th className="px-4 py-3 font-medium">Mitigation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {SCHEDULE_RISKS.map((r) => (
                <tr key={r.rank} className="align-top">
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{r.rank}</td>
                  <td className="px-4 py-3 font-medium">{r.risk}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      Scenario {r.bitesAt}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{r.phase}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{r.mitigation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="mb-3 flex items-center gap-2">
              <Database className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Cache Invalidation Rules</h3>
            </div>
            <div className="space-y-2">
              {SCHEDULE_INVALIDATION_RULES.map((rule) => (
                <div key={rule.event} className="flex items-start justify-between gap-3 text-xs">
                  <span className="min-w-0 text-muted-foreground">{rule.event}</span>
                  <span
                    className={cn(
                      "shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium",
                      INVALIDATION_STYLES[rule.scope],
                    )}
                  >
                    {rule.scope}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="mb-3 flex items-center gap-2">
              <Radio className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Realtime Readiness (P5)</h3>
            </div>
            <div className="space-y-2">
              {SCHEDULE_REALTIME_EVENTS.map((e) => (
                <div key={e.event} className="flex items-start justify-between gap-3 text-xs">
                  <span className="min-w-0 text-muted-foreground">{e.event}</span>
                  <span
                    className={cn(
                      "shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium",
                      REALTIME_STYLES[e.class],
                    )}
                  >
                    {e.class}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Startup hydration & loading tiers (OP4) */}
      <div className="mt-8">
        <div className="mb-3 flex items-center gap-2">
          <PackageOpen className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-base font-semibold">Startup Hydration &amp; Loading Tiers</h2>
        </div>
        <p className="mb-4 max-w-3xl text-sm text-muted-foreground">
          OP1/OP3 identified boot-time full hydration as the true long-term scalability ceiling. The
          provider eagerly loads ~36 full, un-scoped datasets into memory at mount today. The
          architecture below classifies each into a loading tier and defines the migration path.
          Blueprint only — no migration, no behaviour change. Full typed contract in{" "}
          <code className="rounded bg-muted px-1">hydration.blueprint.ts</code>.
        </p>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {DATA_TIERS.map((t) => (
            <div key={t.tier} className="rounded-2xl border border-border bg-card p-5">
              <span
                className={cn(
                  "inline-flex rounded-md px-2 py-0.5 text-xs font-medium",
                  TIER_STYLES[t.tier].cls,
                )}
              >
                {TIER_STYLES[t.tier].label}
              </span>
              <p className="mt-2 text-xs font-medium text-foreground">{t.loadTiming}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t.rule}</p>
              <p className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
                {t.examples}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="mb-3 flex items-center gap-2">
              <Gauge className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Startup Budgets (target)</h3>
            </div>
            <div className="space-y-2.5">
              {STARTUP_BUDGETS.map((b) => (
                <div key={b.phase} className="text-xs">
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 font-medium text-foreground">{b.phase}</span>
                    <span className="shrink-0 font-mono text-muted-foreground">{b.target}</span>
                  </div>
                  <p className="mt-0.5 text-muted-foreground">{b.rationale}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="mb-3 flex items-center gap-2">
              <Database className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Migration Readiness</h3>
            </div>
            <div className="space-y-2.5">
              {MIGRATION_READINESS.map((m) => (
                <div key={m.dataset} className="flex items-start justify-between gap-3 text-xs">
                  <div className="min-w-0">
                    <span className="font-medium text-foreground">{m.dataset}</span>
                    <p className="mt-0.5 text-muted-foreground">{m.futureLoad}</p>
                  </div>
                  <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {m.priority}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">#</th>
                <th className="px-4 py-3 font-medium">Hydration risk</th>
                <th className="px-4 py-3 font-medium">Bites at</th>
                <th className="px-4 py-3 font-medium">Phase</th>
                <th className="px-4 py-3 font-medium">Mitigation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {HYDRATION_RISKS.map((r) => (
                <tr key={r.rank} className="align-top">
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{r.rank}</td>
                  <td className="px-4 py-3 font-medium">{r.risk}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      Scenario {r.bitesAt}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{r.phase}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{r.mitigation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* AI scalability blueprint (OP1) */}
      <div className="mt-8">
        <div className="mb-3 flex items-center gap-2">
          <Bot className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-base font-semibold">AI Scalability Blueprint</h2>
        </div>
        <div className="overflow-hidden rounded-2xl border border-dashed border-border bg-muted/30">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Future feature</th>
                <th className="px-4 py-3 font-medium">Volume driver</th>
                <th className="px-4 py-3 font-medium">Cost driver</th>
                <th className="px-4 py-3 font-medium">Risk</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {AI_FEATURE_RISKS.map((r) => (
                <tr key={r.feature} className="align-top">
                  <td className="px-4 py-3 font-medium">{r.feature}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{r.volumeDriver}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{r.costDriver}</td>
                  <td className="px-4 py-3">
                    <span className={cn("rounded-md px-2 py-0.5 text-[11px] font-medium", GROWTH_STYLES[r.risk])}>
                      {r.risk}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Blueprint only — no AI code exists yet. Every future model call must be wrapped at the
          server boundary to attribute tokens/calls per company before any feature ships.
        </p>
      </div>

      {/* Operational data migration (P4A master blueprint) */}
      <div className="mt-8">
        <div className="mb-3 flex items-center gap-2">
          <Workflow className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-base font-semibold">Operational Data Migration</h2>
        </div>
        <p className="mb-4 max-w-3xl text-sm text-muted-foreground">
          The master migration architecture (P4A) that unifies every audit phase into staged waves.
          Wave 0 builds the query-layer interfaces and adapters with <strong>no data movement</strong>,
          so each later wave is a swap behind a stable seam with a clear rollback. Blueprint only —
          no tables, no migration, no behaviour change. Full typed contract in{" "}
          <code className="rounded bg-muted px-1">migration.blueprint.ts</code>.
        </p>

        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Wave</th>
                <th className="px-4 py-3 font-medium">Scope</th>
                <th className="px-4 py-3 font-medium">Risk</th>
                <th className="px-4 py-3 font-medium">Exit criteria</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {MIGRATION_WAVES.map((w) => {
                const risk = WAVE_RISK_BY_WAVE[w.wave];
                return (
                  <tr key={w.wave} className="align-top">
                    <td className="px-4 py-3">
                      <div className="font-medium">{w.title}</div>
                      <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{w.wave}</div>
                    </td>
                    <td className="px-4 py-3 max-w-sm text-xs text-muted-foreground">{w.scope}</td>
                    <td className="px-4 py-3">
                      {risk ? (
                        <span
                          className={cn(
                            "rounded-md px-2 py-0.5 text-[11px] font-medium",
                            GROWTH_STYLES[risk.risk],
                          )}
                        >
                          {risk.risk}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{w.exitCriteria}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {ENTITY_MIGRATIONS.map((e) => (
            <div key={e.entity} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">{e.entity}</h3>
                <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">
                  {e.priority}
                </span>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">{e.cacheStrategy}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Wave 0 — contracts & localStorage adapters */}
      <div className="mt-8">
        <div className="mb-3 flex items-center gap-2">
          <Plug className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-base font-semibold">Migration Wave 0 · Contracts &amp; Adapters</h2>
        </div>
        <p className="mb-4 max-w-3xl text-sm text-muted-foreground">
          The storage-agnostic query layer (<code className="rounded bg-muted px-1">lib/data</code>).
          LocalStorage adapters wrap the existing store getters behind a stable interface so later
          waves can swap in Supabase with <strong>no UI change</strong>. No data has moved and no
          page is wired onto this layer yet — this is the seam only.
        </p>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {WAVE0_STATUS.map((s) => (
            <div key={s.label} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">{s.label}</h3>
                <span
                  className={cn(
                    "shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                    s.state === "ready"
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {s.state === "ready" ? "Ready" : "Pending"}
                </span>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">{s.detail}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
          <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <ShieldCheck className="h-4 w-4 text-muted-foreground" />
              Adapter parity validation
            </div>
            <Button variant="outline" size="sm" onClick={runParity}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Run check
            </Button>
          </div>
          {parity === null ? (
            <p className="px-4 py-4 text-sm text-muted-foreground">
              Compares each localStorage adapter against the existing store getter (count, ids, key
              fields, detail lookup) across all companies. Read-only; mutates nothing.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Entity</th>
                  <th className="px-4 py-2.5 font-medium">Getter</th>
                  <th className="px-4 py-2.5 font-medium">Adapter</th>
                  <th className="px-4 py-2.5 font-medium">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {parity.checks.map((c) => (
                  <tr key={c.entity}>
                    <td className="px-4 py-2.5 font-medium">{c.entity}</td>
                    <td className="px-4 py-2.5 font-mono tabular-nums text-muted-foreground">{c.getterCount}</td>
                    <td className="px-4 py-2.5 font-mono tabular-nums text-muted-foreground">{c.adapterCount}</td>
                    <td className="px-4 py-2.5">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium",
                          c.ok
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : "bg-red-500/10 text-red-600 dark:text-red-400",
                        )}
                      >
                        {c.ok ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                        {c.ok ? "Parity" : c.notes.join(", ")}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Wave 1A — Customers Supabase migration (infrastructure only) */}
      <div className="mt-8">
        <div className="mb-3 flex items-center gap-2">
          <Database className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-base font-semibold">Migration Wave 1A · Customers</h2>
        </div>
        <p className="mb-4 max-w-3xl text-sm text-muted-foreground">
          The first real operational entity in Supabase. The <code className="rounded bg-muted px-1">customers</code>{" "}
          table, a company-scoped repository, an idempotent migration utility and shadow-read
          validation now exist. This is <strong>infrastructure only</strong> — the Customers list and
          Customer Card still read localStorage, and Supabase is a verified shadow copy.
        </p>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {WAVE1A_STATUS.map((s) => (
            <div key={s.label} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">{s.label}</h3>
                <span
                  className={cn(
                    "shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                    s.state === "ready"
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : s.state === "no"
                        ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {s.state === "ready" ? "Ready" : s.state === "no" ? "No" : "Pending"}
                </span>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">{s.detail}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
          <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <ShieldCheck className="h-4 w-4 text-muted-foreground" />
              Shadow-read parity (localStorage vs Supabase)
            </div>
            <Button variant="outline" size="sm" onClick={runShadow} disabled={shadowRunning}>
              <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", shadowRunning && "animate-spin")} />
              {shadowRunning ? "Running…" : "Run shadow read"}
            </Button>
          </div>
          {shadow === null ? (
            <p className="px-4 py-4 text-sm text-muted-foreground">
              Diffs localStorage customers against the Supabase shadow copy (count, id set, summary
              fields, detail) across all visible companies. Requires the migration to have been run
              and Supabase to be reachable; read-only, mutates nothing.
            </p>
          ) : (
            <div className="px-4 py-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium",
                    shadow.ok
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : "bg-red-500/10 text-red-600 dark:text-red-400",
                  )}
                >
                  {shadow.ok ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                  {shadow.ok ? "0 critical mismatches" : shadow.notes.join(", ")}
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  { label: "localStorage", value: shadow.localCount },
                  { label: "Supabase", value: shadow.supabaseCount },
                  { label: "Missing in Supabase", value: shadow.missingInSupabase.length },
                  { label: "Extra in Supabase", value: shadow.extraInSupabase.length },
                ].map((m) => (
                  <div key={m.label} className="rounded-xl border border-border bg-card/60 p-3.5">
                    <div className="font-mono text-lg tabular-nums">{m.value}</div>
                    <div className="text-xs text-muted-foreground">{m.label}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="mt-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4" />
            Wave 1B verdict · READY
          </div>
          <p className="mt-1.5 max-w-3xl text-xs text-muted-foreground">
            The migration framework is validated end-to-end against an in-memory Supabase fake
            (<code className="rounded bg-muted px-1">customerMigration.test.ts</code>): 0 critical parity
            mismatches, idempotent re-runs, confirmed CRUD/search/pagination parity, and company scoping
            with no cross-tenant leak. One defect was found and fixed during validation — the unscoped
            shadow read coerced the scope to <code className="rounded bg-muted px-1">null</code>, which the
            localStorage adapter treats as a literal filter while the repository treats as "all". DB-level
            RLS (migration 0007) is enforced server-side and should be confirmed once on the live project
            before the Customers list reads through Supabase.
          </p>
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          Browser-origin migration handles are quarantined in normal runtime. Customer migration/backfill
          must use a reviewed server-side or controlled validation plan; this panel only keeps read-only
          shadow verification available.
        </p>
      </div>

      {/* Wave 1B — Customer LIST read switch (flag-gated) */}
      <div className="mt-8">
        <div className="mb-3 flex items-center gap-2">
          <Database className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-base font-semibold">Migration Wave 1B · Customer List read</h2>
          <span
            className={cn(
              "ml-1 rounded-md px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
              CUSTOMERS_LIST_SUPABASE_READ
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "bg-muted text-muted-foreground",
            )}
          >
            Flag {CUSTOMERS_LIST_SUPABASE_READ ? "ON" : "OFF"}
          </span>
        </div>
        <p className="mb-4 max-w-3xl text-sm text-muted-foreground">
          The Customers <strong>list</strong> can now read from Supabase behind the{" "}
          <code className="rounded bg-muted px-1">customers_list_supabase_read</code> flag (default
          OFF). Only list reads move — the Customer Card and every write (create / update / archive)
          stay on localStorage. If Supabase is unreachable, errors, or returns nothing, the list
          falls back to localStorage, so it never blanks. Rollback is instant and data-free: set the
          flag OFF.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {WAVE1B_STATUS.map((s) => (
            <div key={s.label} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">{s.label}</h3>
                <span
                  className={cn(
                    "shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                    s.state === "ready"
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : s.state === "no"
                        ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {s.state === "ready" ? "Ready" : s.state === "no" ? "Local" : "Pending"}
                </span>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">{s.detail}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Wave 1C — Customer Card DETAIL read switch (flag-gated) */}
      <div className="mt-8">
        <div className="mb-3 flex items-center gap-2">
          <Database className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-base font-semibold">Migration Wave 1C · Customer Card detail read</h2>
          <span
            className={cn(
              "ml-1 rounded-md px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
              CUSTOMERS_DETAIL_SUPABASE_READ
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "bg-muted text-muted-foreground",
            )}
          >
            Flag {CUSTOMERS_DETAIL_SUPABASE_READ ? "ON" : "OFF"}
          </span>
        </div>
        <p className="mb-4 max-w-3xl text-sm text-muted-foreground">
          The Customer <strong>Card</strong> can now read its detail from Supabase behind the{" "}
          <code className="rounded bg-muted px-1">customers_detail_supabase_read</code> flag (default
          OFF), independent of the list flag. Only the detail read moves — every write (create /
          update / archive) and the Work Orders / Invoices / Media / Protocols tabs keep their own
          sources. If Supabase is unreachable, errors, or has no row, the card falls back to
          localStorage, so it never breaks. Rollback is instant and data-free: set the flag OFF.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {WAVE1C_STATUS.map((s) => (
            <div key={s.label} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">{s.label}</h3>
                <span
                  className={cn(
                    "shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                    s.state === "ready"
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : s.state === "no"
                        ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {s.state === "ready" ? "Ready" : s.state === "no" ? "Local" : "Pending"}
                </span>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">{s.detail}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 rounded-2xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Detail shadow read</h3>
            <Button
              variant="outline"
              size="sm"
              onClick={runDetailShadow}
              disabled={detailShadowRunning}
            >
              <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", detailShadowRunning && "animate-spin")} />
              {detailShadowRunning ? "Running…" : "Run detail shadow read"}
            </Button>
          </div>
          {detailShadow === null ? (
            <p className="text-xs text-muted-foreground">
              Diffs one customer's localStorage detail against its Supabase shadow copy, field by
              field (name, number, contact, area, owner, status, type, address &amp; contact counts).
            </p>
          ) : (
            <div className="space-y-3">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium",
                  detailShadow.ok
                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                )}
              >
                {detailShadow.ok ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                {detailShadow.ok
                  ? `0 field mismatches (${detailShadow.matchedFields.length} checked)`
                  : detailShadow.notes.join(", ")}
              </span>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  { label: "localStorage", value: detailShadow.localFound ? "found" : "missing" },
                  { label: "Supabase", value: detailShadow.supabaseFound ? "found" : "missing" },
                  { label: "Fields matched", value: detailShadow.matchedFields.length },
                  { label: "Fields mismatched", value: detailShadow.mismatchedFields.length },
                ].map((m) => (
                  <div key={m.label} className="rounded-xl border border-border bg-background p-3">
                    <p className="text-xs text-muted-foreground">{m.label}</p>
                    <p className="mt-0.5 text-sm font-semibold tabular-nums">{m.value}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Wave 1D — Customer DUAL WRITE (flag-gated) */}
      <div className="mt-8">
        <div className="mb-3 flex items-center gap-2">
          <Database className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-base font-semibold">Migration Wave 1D · Customer dual write</h2>
          <span
            className={cn(
              "ml-1 rounded-md px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
              CUSTOMERS_DUAL_WRITE
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "bg-muted text-muted-foreground",
            )}
          >
            Flag {CUSTOMERS_DUAL_WRITE ? "ON" : "OFF"}
          </span>
        </div>
        <p className="mb-4 max-w-3xl text-sm text-muted-foreground">
          The first <strong>write-path</strong> step. Every customer write (create / update /
          archive) funnels through <code className="rounded bg-muted px-1">persistCustomers()</code>,
          which writes localStorage first — always authoritative — and, behind the{" "}
          <code className="rounded bg-muted px-1">customers_dual_write</code> flag (default OFF),
          mirrors the same change into Supabase in the background. The mirror is fire-and-forget: a
          Supabase failure or timeout is recorded as drift but never blocks the operation. A
          post-write pass re-reads each row and compares the critical fields. Rollback is instant
          and data-free: set the flag OFF.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {WAVE1D_STATUS.map((s) => (
            <div key={s.label} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">{s.label}</h3>
                <span
                  className={cn(
                    "shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                    s.state === "ready"
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : s.state === "no"
                        ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {s.state === "ready" ? "Ready" : s.state === "no" ? "Local" : "Pending"}
                </span>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">{s.detail}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 rounded-2xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Live dual-write metrics</h3>
            <Button variant="outline" size="sm" onClick={refreshDualWrite}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Refresh
            </Button>
          </div>
          {dualWrite.runs === 0 ? (
            <p className="text-xs text-muted-foreground">
              No mirrored writes observed this session. With the flag ON, every customer write
              records here — created / updated rows, validation passes, mismatches and failures.
            </p>
          ) : (
            <div className="space-y-3">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium",
                  dualWrite.mismatches === 0 && dualWrite.failures === 0
                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                )}
              >
                {dualWrite.mismatches === 0 && dualWrite.failures === 0 ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : (
                  <AlertTriangle className="h-3 w-3" />
                )}
                {dualWrite.mismatches === 0 && dualWrite.failures === 0
                  ? "0 mismatches · 0 failures"
                  : `${dualWrite.mismatches} mismatch(es) · ${dualWrite.failures} failure(s)` +
                    (dualWrite.lastError ? ` — ${dualWrite.lastError}` : "")}
              </span>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  { label: "Mirror runs", value: dualWrite.runs },
                  { label: "No-ops", value: dualWrite.noops },
                  { label: "Created", value: dualWrite.created },
                  { label: "Updated", value: dualWrite.updated },
                  { label: "Removals detected", value: dualWrite.removedDetected },
                  { label: "Skipped (no company)", value: dualWrite.skipped },
                  { label: "Validations", value: dualWrite.validations },
                  { label: "Mismatches", value: dualWrite.mismatches },
                ].map((m) => (
                  <div key={m.label} className="rounded-xl border border-border bg-background p-3">
                    <p className="text-xs text-muted-foreground">{m.label}</p>
                    <p className="mt-0.5 text-sm font-semibold tabular-nums">{m.value}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Wave 1E — Customer staging soak validation */}
      <div className="mt-8">
        <div className="mb-3 flex items-center gap-2">
          <Workflow className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-base font-semibold">Migration Wave 1E · Customer staging soak</h2>
          <span className="ml-1 rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Validation only
          </span>
        </div>
        <p className="mb-4 max-w-3xl text-sm text-muted-foreground">
          Before Customers become the authoritative source of truth, a soak phase exercises real
          workflows repeatedly with the read + dual-write flags ON <strong>in staging</strong>{" "}
          (production stays OFF), watching for drift, failures and scope leaks. localStorage remains
          authoritative throughout — no source-of-truth switch happens here. The harness below runs a
          sustained mixed soak and computes the same cut-over verdict the staging run must reproduce.
        </p>

        {/* Staging flag configuration */}
        <div className="grid gap-3 sm:grid-cols-3">
          {SOAK_FLAGS.map((f) => (
            <div key={f.flag} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-2">
                <code className="rounded bg-muted px-1 text-xs">{f.flag}</code>
                <span className="shrink-0 rounded-md bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400">
                  Staging {f.staging}
                </span>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">{f.note}</p>
              <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                Prod {f.production}
              </p>
            </div>
          ))}
        </div>

        {/* Soak harness */}
        <div className="mt-4 rounded-2xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Run soak (current company · 40 workflows)</h3>
            <Button
              variant="outline"
              size="sm"
              onClick={runSoak}
              disabled={soakRunning || !canRunBrowserDomainSoakTool()}
              title={BROWSER_DOMAIN_TOOL_DISABLED_REASON}
            >
              <Workflow className="mr-1.5 h-3.5 w-3.5" />
              {soakRunning ? "Running…" : "Run soak"}
            </Button>
          </div>
          {!soak ? (
            <p className="text-xs text-muted-foreground">
              Runs create / update (name · contact · address · area · owner) / archive / reopen /
              search / list workflows against the Supabase shadow copy, with periodic shadow-read
              drift checks and a final rollback drill. Read-only on business behaviour.
            </p>
          ) : (
            <div className="space-y-3">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium",
                  soak.verdict === "READY"
                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                )}
              >
                {soak.verdict === "READY" ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : (
                  <AlertTriangle className="h-3 w-3" />
                )}
                Verdict · {soak.verdict}
                {soak.blockers.length > 0 ? ` — ${soak.blockers.join("; ")}` : ""}
              </span>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  { label: "Operations", value: soak.operations },
                  { label: "Shadow runs", value: soak.shadowRuns },
                  { label: "Shadow clean", value: soak.shadowClean },
                  { label: "Critical drift", value: soak.criticalDrift },
                  { label: "Mirrored rows", value: soak.mirrored },
                  { label: "Mismatches", value: soak.mismatches },
                  { label: "Write failures", value: soak.writeFailures },
                  { label: "Scope failures", value: soak.scopeFailures },
                ].map((m) => (
                  <div key={m.label} className="rounded-xl border border-border bg-background p-3">
                    <p className="text-xs text-muted-foreground">{m.label}</p>
                    <p className="mt-0.5 text-sm font-semibold tabular-nums">{m.value}</p>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-medium",
                    soak.rollbackVerified
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                  )}
                >
                  <ShieldCheck className="h-3 w-3" />
                  Rollback {soak.rollbackVerified ? "verified" : "unconfirmed"}
                </span>
                {soak.perf.map((p) => (
                  <span
                    key={p.label}
                    className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 text-muted-foreground"
                  >
                    <Timer className="h-3 w-3" />
                    {p.label}: {p.avgMs.toFixed(2)}ms avg · {p.maxMs.toFixed(2)}ms max ({p.calls})
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Cut-over readiness criteria */}
        <div className="mt-4 rounded-2xl border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold">Cut-over readiness criteria</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {CUTOVER_CRITERIA.map((c) => (
              <div key={c.criterion} className="rounded-xl border border-border bg-background p-3">
                <p className="text-xs font-medium">{c.criterion}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Requires {c.required} · <code className="rounded bg-muted px-1">{c.measuredBy}</code>
                </p>
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
            <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
              {SOAK_READINESS.target} · {SOAK_READINESS.verdict}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Next: {SOAK_READINESS.nextPhase}
            </p>
          </div>
        </div>
      </div>

      {/* Wave 1F — Customer SOURCE-OF-TRUTH cut-over (flag-gated) */}
      <div className="mt-8">
        <div className="mb-3 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-base font-semibold">Migration Wave 1F · Customer source of truth</h2>
          <span
            className={cn(
              "ml-1 rounded-md px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
              CUSTOMERS_SUPABASE_AUTHORITATIVE
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "bg-muted text-muted-foreground",
            )}
          >
            Authoritative {CUSTOMERS_SUPABASE_AUTHORITATIVE ? "ON" : "OFF"}
          </span>
        </div>
        <p className="mb-4 max-w-3xl text-sm text-muted-foreground">
          The first true <strong>source-of-truth switch</strong>. Behind{" "}
          <code className="rounded bg-muted px-1">customers_supabase_authoritative</code> (default
          OFF), Supabase becomes the <strong>primary</strong> source for the Customers list + card
          and the authoritative write target, while localStorage is kept as a synchronized{" "}
          <strong>backout copy</strong> ({WRITE_STRATEGY.chosen.replace(/_/g, " ")}). Reads fall back
          to the backout copy on failure — recorded, never silent — and write-mirror failures are
          escalated. Rollback is a single flag flip: localStorage is already current, so no data
          migration is needed.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {WAVE1F_STATUS.map((s) => (
            <div key={s.label} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">{s.label}</h3>
                <span
                  className={cn(
                    "shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                    s.state === "ready"
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : s.state === "no"
                        ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {s.state === "ready" ? "Ready" : s.state === "no" ? "Gated" : "Pending"}
                </span>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">{s.detail}</p>
            </div>
          ))}
        </div>

        {/* Live cut-over state + backout snapshot */}
        <div className="mt-4 rounded-2xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Live source-of-truth state</h3>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={takeBackout}
                disabled={!canRunBrowserDomainBackoutTool()}
                title={BROWSER_DOMAIN_TOOL_DISABLED_REASON}
              >
                <HardDrive className="mr-1.5 h-3.5 w-3.5" />
                Take backout snapshot
              </Button>
              <Button variant="outline" size="sm" onClick={refreshCutover}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Refresh
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              Read source · {cutover.readSource}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              Write source · {cutover.writeSource}
            </span>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium",
                cutover.failures === 0
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
              )}
            >
              {cutover.failures === 0 ? (
                <CheckCircle2 className="h-3 w-3" />
              ) : (
                <AlertTriangle className="h-3 w-3" />
              )}
              {cutover.failures === 0
                ? "0 divergence events"
                : `${cutover.failures} divergence event(s)`}
            </span>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "List reads (primary)", value: cutover.listReadsPrimary },
              { label: "Detail reads (primary)", value: cutover.detailReadsPrimary },
              { label: "Read fallbacks", value: cutover.readFallbacks },
              { label: "Write failures", value: cutover.writeFailures },
            ].map((m) => (
              <div key={m.label} className="rounded-xl border border-border bg-background p-3">
                <p className="text-xs text-muted-foreground">{m.label}</p>
                <p className="mt-0.5 text-sm font-semibold tabular-nums">{m.value}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-xl border border-border bg-background p-3">
            <p className="text-xs font-medium">Last export / backout snapshot</p>
            {backout ? (
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {new Date(backout.at).toLocaleString()} · {backout.total} record(s) across{" "}
                {backout.companyIds.length} company(ies) · checksum{" "}
                <code className="rounded bg-muted px-1">{backout.checksum}</code>
              </p>
            ) : (
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                No snapshot taken yet. Capture one before flipping the authoritative flag.
              </p>
            )}
          </div>
        </div>

        {/* Exit criteria + final status */}
        <div className="mt-4 rounded-2xl border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold">Cut-over exit criteria</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {CUTOVER_EXIT_CRITERIA.map((c) => (
              <div key={c.criterion} className="rounded-xl border border-border bg-background p-3">
                <p className="text-xs font-medium">{c.criterion}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  <code className="rounded bg-muted px-1">{c.measuredBy}</code>
                </p>
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-xl border border-sky-500/30 bg-sky-500/5 p-3">
            <p className="text-xs font-medium text-sky-700 dark:text-sky-400">
              Customers · {CUSTOMER_MIGRATION_FINAL_STATUS.status}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {CUSTOMER_MIGRATION_FINAL_STATUS.summary}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Next entity: <strong>{CUSTOMER_MIGRATION_FINAL_STATUS.nextEntity}</strong> —{" "}
              {CUSTOMER_MIGRATION_FINAL_STATUS.nextEntityRationale[0]}
            </p>
          </div>
        </div>
      </div>

      {/* P4K — Customer migration CLOSURE AUDIT */}
      <div className="mt-8">
        <div className="mb-3 flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-base font-semibold">Customer migration · closure audit</h2>
          <span
            className={cn(
              "ml-1 rounded-md px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
              CUSTOMER_CLOSURE_AUDIT.verdict === "consistent"
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
            )}
          >
            {CUSTOMER_CLOSURE_AUDIT.verdict}
          </span>
        </div>
        <p className="mb-4 max-w-3xl text-sm text-muted-foreground">
          The final, read-only record of the Customer migration before the next entity begins. All
          four flags default OFF and are independently reversible, every customer write funnels
          through <code className="rounded bg-muted px-1">persistCustomers()</code>, reads go through
          the list / detail source hooks, and a checksummed localStorage backout copy keeps rollback
          a single flag flip. Remaining localStorage usage is intentional (current path · backout ·
          tooling).
        </p>

        {/* Flag audit */}
        <div className="grid gap-3 sm:grid-cols-2">
          {CUSTOMER_FLAG_AUDIT.map((f) => (
            <div key={f.flag} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-2">
                <code className="rounded bg-muted px-1 text-xs">{f.flag}</code>
                <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  #{f.dependencyOrder} · default OFF
                </span>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">{f.controls}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">Rollback · {f.rollback}</p>
            </div>
          ))}
        </div>

        {/* Data-source map */}
        <div className="mt-4 rounded-2xl border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold">Data-source map</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {CUSTOMER_DATA_SOURCE_MAP.map((s) => (
              <div key={s.surface} className="rounded-xl border border-border bg-background p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium">{s.surface}</p>
                  <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {s.source}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{s.note}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Rollback drill + live-staging checklist */}
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <h3 className="text-sm font-semibold">Rollback / backout drill</h3>
            </div>
            <ol className="space-y-2">
              {ROLLBACK_DRILL.map((s) => (
                <li key={s.order} className="rounded-xl border border-border bg-background p-3">
                  <p className="text-xs font-medium">
                    {s.order}. <code className="rounded bg-muted px-1">{s.action}</code>
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{s.expected}</p>
                </li>
              ))}
            </ol>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4">
            <h3 className="mb-3 text-sm font-semibold">Live-staging rollout checklist</h3>
            <ol className="space-y-2">
              {LIVE_STAGING_CHECKLIST.map((s) => (
                <li key={s.order} className="rounded-xl border border-border bg-background p-3">
                  <p className="text-xs font-medium">
                    {s.order}. {s.step}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{s.gate}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-sky-500/30 bg-sky-500/5 p-3">
          <p className="text-xs font-medium text-sky-700 dark:text-sky-400">
            Verdict · {CUSTOMER_CLOSURE_AUDIT.verdict} — rollback{" "}
            {CUSTOMER_CLOSURE_AUDIT.rollbackVerified ? "verified" : "unconfirmed"}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {CUSTOMER_CLOSURE_AUDIT.summary}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Next entity: <strong>{CUSTOMER_CLOSURE_AUDIT.nextEntity}</strong> —{" "}
            {CUSTOMER_CLOSURE_AUDIT.nextEntityRationale[0]}
          </p>
        </div>
      </div>

      {/* P5A — Work Orders migration DESIGN AUDIT (design-only) */}
      <div className="mt-8">
        <div className="mb-3 flex items-center gap-2">
          <Workflow className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-base font-semibold">Work Orders migration · design audit</h2>
          <span className="ml-1 rounded-md bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-600 dark:text-sky-400">
            design only
          </span>
        </div>
        <p className="mb-4 max-w-3xl text-sm text-muted-foreground">
          Blueprint for the next entity after Customers. No schema, no migration, no UI switch. Work
          Orders own nested service rows (with embedded variations) and drive the Schedule resolver;
          occurrence exceptions live in a <em>separate</em> store and get their own table. All writes
          funnel through a single{" "}
          <code className="rounded bg-muted px-1">persistWorkOrders()</code> seam — the future
          dual-write attach point, exactly like Customers.
        </p>

        {/* Planned tables */}
        <div className="grid gap-3 lg:grid-cols-3">
          {WORK_ORDER_TABLES.map((t) => (
            <div key={t.table} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-center gap-2">
                <Database className="h-3.5 w-3.5 text-muted-foreground" />
                <code className="rounded bg-muted px-1 text-xs">{t.table}</code>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">{t.purpose}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Indexes · {t.indexes.join(" · ")}
              </p>
            </div>
          ))}
        </div>

        {/* Migration waves */}
        <div className="mt-4 rounded-2xl border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold">Recommended waves</h3>
          <ol className="space-y-2">
            {WORK_ORDER_WAVES.map((w) => (
              <li key={w.id} className="rounded-xl border border-border bg-background p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium">
                    <code className="rounded bg-muted px-1">{w.id}</code> · {w.title}
                  </p>
                  <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {w.uiSwitch ? "UI switch" : "no UI switch"}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{w.scope}</p>
              </li>
            ))}
          </ol>
        </div>

        {/* Schedule dependency + risks */}
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center gap-2">
              <CalendarRange className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Schedule-critical fields</h3>
            </div>
            <ul className="space-y-1.5">
              {SCHEDULE_FIELD_DEPENDENCIES.filter((d) => d.critical).map((d) => (
                <li key={d.field} className="text-[11px] text-muted-foreground">
                  <code className="rounded bg-muted px-1">{d.field}</code> — {d.consumedBy}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <h3 className="text-sm font-semibold">Top risks</h3>
            </div>
            <ol className="space-y-1.5">
              {WORK_ORDER_RISKS.slice(0, 5).map((r) => (
                <li key={r.rank} className="text-[11px] text-muted-foreground">
                  <span
                    className={cn(
                      "mr-1 rounded px-1 py-0.5 text-[10px] font-medium uppercase",
                      r.level === "critical"
                        ? "bg-red-500/10 text-red-600 dark:text-red-400"
                        : r.level === "high"
                          ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                          : "bg-muted text-muted-foreground",
                    )}
                  >
                    {r.level}
                  </span>
                  {r.risk}
                </li>
              ))}
            </ol>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-sky-500/30 bg-sky-500/5 p-3">
          <p className="text-xs font-medium text-sky-700 dark:text-sky-400">
            Verdict · {WORK_ORDER_DESIGN_VERDICT.verdict}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {WORK_ORDER_DESIGN_VERDICT.summary}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Recommended first wave: <strong>{WORK_ORDER_DESIGN_VERDICT.recommendedFirstWave}</strong>
          </p>
        </div>

        {/* WO-0 — contracts + local adapter parity (no schema, no migration, no UI) */}
        <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
          <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <ShieldCheck className="h-4 w-4 text-muted-foreground" />
              Work Orders · WO-0 contracts &amp; local adapter parity
              <span className="ml-1 rounded-md bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-600 dark:text-sky-400">
                no migration
              </span>
            </div>
            <Button variant="outline" size="sm" onClick={runWoParity}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Run check
            </Button>
          </div>
          <div className="px-4 py-3">
            <p className="mb-3 text-xs text-muted-foreground">
              New service-row / variation / exception DTOs sit beside the existing types;
              <code className="rounded bg-muted px-1">WorkOrderSummary</code> gains a denormalised
              <code className="rounded bg-muted px-1">customerDisplayName</code>. The localStorage
              adapter now projects parent rows, nested service rows and the separate
              occurrence-exception store behind the same repository contract. Read-only.
            </p>
            {woParity === null ? (
              <p className="text-xs text-muted-foreground">
                Compares the Work Order adapter against the store getters (parent, service rows,
                embedded variations, separate exceptions, schedule-critical coverage). Run to verify.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 font-medium">Dimension</th>
                    <th className="px-2 py-2 font-medium">Source</th>
                    <th className="px-2 py-2 font-medium">Adapter</th>
                    <th className="px-2 py-2 font-medium">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {woParity.checks.map((c) => (
                    <tr key={c.dimension}>
                      <td className="px-2 py-2 font-medium">{c.dimension}</td>
                      <td className="px-2 py-2 font-mono tabular-nums text-muted-foreground">{c.sourceCount}</td>
                      <td className="px-2 py-2 font-mono tabular-nums text-muted-foreground">{c.adapterCount}</td>
                      <td className="px-2 py-2">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium",
                            c.ok
                              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                              : "bg-red-500/10 text-red-600 dark:text-red-400",
                          )}
                        >
                          {c.ok ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                          {c.ok ? "Parity" : c.notes.join(", ")}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* WO-1 — Supabase schema + read repository + shadow read (no UI switch) */}
        <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
          <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Database className="h-4 w-4 text-muted-foreground" />
              Work Orders · WO-1 Supabase schema &amp; shadow read
              <span className="ml-1 rounded-md bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-600 dark:text-sky-400">
                shadow only
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={runWoShadow}
              disabled={woShadowRunning}
            >
              <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", woShadowRunning && "animate-spin")} />
              {woShadowRunning ? "Running…" : "Run shadow read"}
            </Button>
          </div>
          <div className="px-4 py-3">
            <p className="mb-3 text-xs text-muted-foreground">
              Migration 0008 adds <code className="rounded bg-muted px-1">work_orders</code>,{" "}
              <code className="rounded bg-muted px-1">work_order_service_rows</code> and{" "}
              <code className="rounded bg-muted px-1">work_order_occurrence_exceptions</code> (indexes +
              RLS). <code className="rounded bg-muted px-1">SupabaseWorkOrderRepository</code> reads them;
              the reviewed Work Order migration plan populates the shadow copy and
              <code className="rounded bg-muted px-1">shadowReadWorkOrders()</code> diffs it. Browser-origin
              migration handles are quarantined in normal runtime; this panel only keeps read-only shadow
              verification available.
            </p>
            {woShadow === null ? (
              <p className="text-xs text-muted-foreground">
                Compares the localStorage Work Order aggregate against the Supabase shadow copy (parent
                count / ids / summary, service-row totals, separate exception store, detail sample). Run to
                verify parity. Requires the migration to have been executed.
              </p>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium",
                      woShadow.ok
                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                        : "bg-red-500/10 text-red-600 dark:text-red-400",
                    )}
                  >
                    {woShadow.ok ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                    {woShadow.ok ? "0 mismatches" : `${woShadow.notes.length} note(s)`}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    local {woShadow.localCount} / supabase {woShadow.supabaseCount} work orders ·{" "}
                    rows {woShadow.localServiceRowTotal}/{woShadow.supabaseServiceRowTotal} ·{" "}
                    exceptions {woShadow.localExceptionTotal}/{woShadow.supabaseExceptionTotal}
                  </span>
                </div>
                <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                  {([
                    ["Count", woShadow.countMatch],
                    ["IDs", woShadow.idsMatch],
                    ["Summary", woShadow.summaryMatch],
                    ["Service rows", woShadow.serviceRowsMatch],
                    ["Exceptions", woShadow.exceptionsMatch],
                    ["Detail", woShadow.detailMatch],
                  ] as ReadonlyArray<[string, boolean]>).map(([label, ok]) => (
                    <div
                      key={label}
                      className="flex items-center justify-between rounded-xl border border-border bg-background px-3 py-2"
                    >
                      <span className="text-[11px] text-muted-foreground">{label}</span>
                      {ok ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                      ) : (
                        <AlertTriangle className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
                      )}
                    </div>
                  ))}
                </div>
                {woShadow.notes.length > 0 && (
                  <ul className="space-y-1">
                    {woShadow.notes.map((n, i) => (
                      <li key={i} className="text-[11px] text-red-600 dark:text-red-400">
                        {n}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>

        {/* WO-2 — Work Order LIST read switch (flag-gated) */}
        <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
          <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Database className="h-4 w-4 text-muted-foreground" />
              Work Orders · WO-2 List read switch
            </div>
            <span
              className={cn(
                "rounded-md px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                WORK_ORDERS_LIST_SUPABASE_READ
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-muted text-muted-foreground",
              )}
            >
              Flag {WORK_ORDERS_LIST_SUPABASE_READ ? "ON" : "OFF"}
            </span>
          </div>
          <div className="px-4 py-3">
            <p className="mb-3 text-xs text-muted-foreground">
              The Work Order <strong>list</strong> (Customer Card · Work Orders tab) can now read from
              Supabase behind the{" "}
              <code className="rounded bg-muted px-1">work_orders_list_supabase_read</code> flag
              (default OFF) via <code className="rounded bg-muted px-1">useWorkOrderListSource</code> →
              <code className="rounded bg-muted px-1">listFullWorkOrdersFromSupabase()</code>. Only list
              reads move — WorkOrderDetails, the Schedule resolver and every work-order write stay on
              localStorage. If Supabase is unreachable / errors / returns nothing, the list falls back
              to localStorage so it never blanks. A background{" "}
              <code className="rounded bg-muted px-1">shadowReadWorkOrders()</code> surfaces drift.
              Rollback is instant and data-free: set the flag OFF.
            </p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {([
                ["Read source", WORK_ORDERS_LIST_SUPABASE_READ ? "Supabase (fallback: local)" : "localStorage"],
                ["UI switched", "List only"],
                ["Details switched", "No"],
                ["Schedule switched", "No"],
                ["Writes", "localStorage (unchanged)"],
                [
                  "Shadow parity",
                  woShadow === null
                    ? "Run shadow read above"
                    : woShadow.ok
                      ? "0 mismatches"
                      : `${woShadow.notes.length} note(s)`,
                ],
              ] as ReadonlyArray<[string, string]>).map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-center justify-between gap-2 rounded-xl border border-border bg-background px-3 py-2"
                >
                  <span className="text-[11px] text-muted-foreground">{label}</span>
                  <span className="text-[11px] font-medium">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* WO-3 — WorkOrderDetails DETAIL read switch (flag-gated) */}
        <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
          <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Database className="h-4 w-4 text-muted-foreground" />
              Work Orders · WO-3 Detail read switch
            </div>
            <span
              className={cn(
                "rounded-md px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                WORK_ORDERS_DETAIL_SUPABASE_READ
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-muted text-muted-foreground",
              )}
            >
              Flag {WORK_ORDERS_DETAIL_SUPABASE_READ ? "ON" : "OFF"}
            </span>
          </div>
          <div className="px-4 py-3">
            <p className="mb-3 text-xs text-muted-foreground">
              The <strong>WorkOrderDetails</strong> page can now read its detail from Supabase behind
              the{" "}
              <code className="rounded bg-muted px-1">work_orders_detail_supabase_read</code> flag
              (default OFF) via <code className="rounded bg-muted px-1">useWorkOrderDetailSource</code> →
              <code className="rounded bg-muted px-1">supabaseWorkOrderRepository.getDetail()</code>.
              Access stays gated by localStorage <code className="rounded bg-muted px-1">getWorkOrder</code>{" "}
              (company / area scope). Only the detail read moves — the list flag is independent, and
              the Schedule resolver and every work-order write stay on localStorage. If Supabase is
              unreachable / errors / has no row, the page falls back to the localStorage record so it
              never breaks. A background{" "}
              <code className="rounded bg-muted px-1">shadowReadWorkOrderDetail()</code> surfaces field
              drift. Rollback is instant and data-free: set the flag OFF.
            </p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {([
                ["Detail source", WORK_ORDERS_DETAIL_SUPABASE_READ ? "Supabase (fallback: local)" : "localStorage"],
                ["Details switched", WORK_ORDERS_DETAIL_SUPABASE_READ ? "Yes" : "No"],
                ["List switched", WORK_ORDERS_LIST_SUPABASE_READ ? "Yes" : "No"],
                ["Schedule switched", "No"],
                ["Writes", "localStorage (unchanged)"],
                ["Access gate", "localStorage getWorkOrder"],
              ] as ReadonlyArray<[string, string]>).map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-center justify-between gap-2 rounded-xl border border-border bg-background px-3 py-2"
                >
                  <span className="text-[11px] text-muted-foreground">{label}</span>
                  <span className="text-[11px] font-medium">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* WO-4 — Service rows → Schedule dependency validation (validation only) */}
        <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
          <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Database className="h-4 w-4 text-muted-foreground" />
              Work Orders · WO-4 Schedule dependency validation
            </div>
            <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Validation only
            </span>
          </div>
          <div className="px-4 py-3">
            <p className="mb-3 text-xs text-muted-foreground">
              Proves the Supabase <code className="rounded bg-muted px-1">work_order_service_rows</code> /
              <code className="rounded bg-muted px-1">work_order_occurrence_exceptions</code> representation can
              reproduce the current Schedule resolver inputs — the migration's most dangerous dependency.{" "}
              <code className="rounded bg-muted px-1">validateWorkOrderScheduleDependency()</code> runs deep
              service-row field parity, variation parity (embedded jsonb), occurrence-exception parity (explicit
              company_id), and a <code className="rounded bg-muted px-1">compareScheduleInterval()</code> dry-run
              that resolves the SAME interval from local vs a Supabase-reconstructed input and diffs every
              occurrence. Read-only: the Schedule resolver and all work-order writes stay on localStorage.
            </p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {([
                ["Service-row parity", "Field-level (10 schedule-critical fields)"],
                ["Variation parity", "Embedded jsonb (count / ids / dates / status)"],
                ["Exception parity", "Separate store · explicit company_id"],
                [
                  "Resolver coverage",
                  `${RESOLVER_INPUT_COVERAGE.filter((f) => f.source !== "not-needed").length}/${RESOLVER_INPUT_COVERAGE.length} fields sourced · 0 missing`,
                ],
                ["Schedule dry-run", "Local vs Supabase occurrence diff"],
                ["Schedule switched", "No"],
              ] as ReadonlyArray<[string, string]>).map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-center justify-between gap-2 rounded-xl border border-border bg-background px-3 py-2"
                >
                  <span className="text-[11px] text-muted-foreground">{label}</span>
                  <span className="text-[11px] font-medium">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* WO-5 — Work Order dual write (localStorage authoritative, Supabase mirror) */}
        <div id="work-orders-dual-write" className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
          <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Database className="h-4 w-4 text-muted-foreground" />
              Work Orders · Dual-Write Telemetry (diagnostics)
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`rounded-md px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                  WORK_ORDERS_DUAL_WRITE
                    ? "bg-emerald-500/15 text-emerald-600"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                Dual-write {WORK_ORDERS_DUAL_WRITE ? "ON" : "OFF"}
              </span>
              <Button variant="outline" size="sm" onClick={refreshWoDualWrite}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Refresh
              </Button>
            </div>
          </div>
          <div className="px-4 py-3">
            <p className="mb-3 text-xs text-muted-foreground">
              The FIRST work-order write-path step. Every write still completes against localStorage first
              (authoritative); when the flag is ON it is then MIRRORED to Supabase via{" "}
              <code className="rounded bg-muted px-1">mirrorWorkOrderWrites()</code> (parent +{" "}
              <code className="rounded bg-muted px-1">work_order_service_rows</code>) and{" "}
              <code className="rounded bg-muted px-1">mirrorWorkOrderExceptionWrites()</code>{" "}
              (<code className="rounded bg-muted px-1">work_order_occurrence_exceptions</code>) on the
              <code className="rounded bg-muted px-1">persistWorkOrders</code> /
              <code className="rounded bg-muted px-1">persistBookingOccurrenceExceptions</code> seams.
              Fire-and-forget and idempotent (upsert on <code className="rounded bg-muted px-1">legacy_id</code>);
              a post-write pass validates parent fields + service-row counts. WO-5.6 adds removal
              propagation: removed parents / dropped service rows / removed exceptions are{" "}
              <em>soft-deleted</em> (<code className="rounded bg-muted px-1">deleted_at</code>) so no stale
              row or ghost schedule occurrence survives; an upsert of the same id UNDELETES it. Schedule +
              writes stay on localStorage. Rollback = flag OFF.
            </p>
            <div className="space-y-4">
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Effective flag state + sources
                </p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <DiagnosticRow label="DUAL_WRITE" value={WORK_ORDERS_DUAL_WRITE ? "ON" : "OFF"} />
                  <DiagnosticRow label="LIST_SUPABASE_READ" value={WORK_ORDERS_LIST_SUPABASE_READ ? "ON" : "OFF"} />
                  <DiagnosticRow label="DETAIL_SUPABASE_READ" value={WORK_ORDERS_DETAIL_SUPABASE_READ ? "ON" : "OFF"} />
                  <DiagnosticRow label="SUPABASE_AUTHORITATIVE" value={WORK_ORDERS_SUPABASE_AUTHORITATIVE ? "ON" : "OFF"} />
                  <DiagnosticRow label="Write source" value={WORK_ORDERS_DUAL_WRITE || WORK_ORDERS_SUPABASE_AUTHORITATIVE ? "localStorage + Supabase mirror" : "localStorage"} />
                  <DiagnosticRow label="Read source (list)" value={WORK_ORDERS_LIST_SUPABASE_READ ? "Supabase (fallback: local)" : "localStorage"} />
                  <DiagnosticRow label="Read source (detail)" value={WORK_ORDERS_DETAIL_SUPABASE_READ ? "Supabase (fallback: local)" : "localStorage"} />
                  <DiagnosticRow label="Schedule switched" value="No" />
                </div>
              </div>

              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Cumulative counters
                </p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <DiagnosticRow label="Runs" value={String(woDualWrite.runs)} />
                  <DiagnosticRow label="No-ops" value={String(woDualWrite.noops)} />
                  <DiagnosticRow label="Parents mirrored" value={String(woDualWrite.parentsMirrored)} />
                  <DiagnosticRow label="Service rows mirrored" value={String(woDualWrite.serviceRowsMirrored)} />
                  <DiagnosticRow label="Exceptions mirrored" value={String(woDualWrite.exceptionsMirrored)} />
                  <DiagnosticRow label="Skipped" value={String(woDualWrite.skipped)} />
                  <DiagnosticRow label="Failures" value={String(woDualWrite.failures)} />
                  <DiagnosticRow label="Last run" value={woDualWrite.lastRunAt ?? "—"} />
                </div>
              </div>

              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Latest mirror run summary
                </p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <DiagnosticRow label="Run id" value={latestWoRun?.runId ?? "—"} />
                  <DiagnosticRow label="Run type" value={latestWoRun?.kind ?? "—"} />
                  <DiagnosticRow label="Run timestamp" value={latestWoRun?.startedAt ?? "—"} />
                  <DiagnosticRow label="Finished" value={latestWoRun?.finishedAt ?? "—"} />
                  <DiagnosticRow label="Created WO legacy_ids" value={shortList(latestWoRun?.diff.created ?? [])} />
                  <DiagnosticRow label="Updated WO legacy_ids" value={shortList(latestWoRun?.diff.updated ?? [])} />
                  <DiagnosticRow label="Removed WO legacy_ids" value={shortList(latestWoRun?.diff.removed ?? [])} />
                  <DiagnosticRow label="No-op WO legacy_ids" value={`${latestWoRun?.noOpWorkOrderCount ?? 0}${latestWoRun?.noOpWorkOrderLegacyIds?.length ? ` · ${shortList(latestWoRun.noOpWorkOrderLegacyIds)}` : ""}`} />
                  <DiagnosticRow label="Parent rows attempted" value={`${latestWoRun?.parentRowsAttempted ?? 0} · ${shortList(latestWoRun?.parentRowLegacyIdsAttempted ?? [])}`} />
                  <DiagnosticRow label="Parent rows mirrored" value={String(latestWoRun?.parentsMirrored ?? 0)} />
                  <DiagnosticRow label="Service row ids attempted" value={`${latestWoRun?.serviceRowsAttempted ?? 0} · ${shortList(latestWoRun?.serviceRowLegacyIdsAttempted ?? [])}`} />
                  <DiagnosticRow label="Service rows mirrored" value={String(latestWoRun?.serviceRowsMirrored ?? 0)} />
                  <DiagnosticRow label="Exception ids attempted" value={`${latestWoRun?.occurrenceExceptionsAttempted ?? 0} · ${shortList(latestWoRun?.occurrenceExceptionIdsAttempted ?? [])}`} />
                  <DiagnosticRow label="Exceptions mirrored" value={String(latestWoRun?.occurrenceExceptionsMirrored ?? 0)} />
                  <DiagnosticRow label="Last error" value={latestWoRun?.lastError ?? woDualWrite.lastError ?? "none"} />
                </div>
              </div>

              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Latest identity context
                </p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <DiagnosticRow label="legacy_id / WorkOrder.id" value={<code>{latestWoIdentity?.legacyId ?? "—"}</code>} />
                  <DiagnosticRow label="Displayed number" value={latestWoIdentity?.number ?? "—"} />
                  <DiagnosticRow label="Title/name" value={latestWoIdentity?.title ?? "—"} />
                  <DiagnosticRow label="companyId / company_legacy_id" value={<code>{latestWoIdentity?.companyLegacyId ?? "—"}</code>} />
                  <DiagnosticRow label="customerId / customer_legacy_id" value={<code>{latestWoIdentity?.customerLegacyId ?? "—"}</code>} />
                  <DiagnosticRow label="Service row ids" value={shortList((latestWoIdentity?.serviceRows ?? []).map((row) => row.id))} />
                  <DiagnosticRow label="Service names" value={shortList((latestWoIdentity?.serviceRows ?? []).map((row) => row.serviceName))} />
                </div>
              </div>

              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Supabase auth / RLS context from latest run
                </p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <DiagnosticRow label="Auth session exists" value={yesNo(latestWoRun?.supabaseSession.authSessionExists ?? null)} />
                  <DiagnosticRow label="current_company_id()" value={<code>{latestWoRun?.supabaseSession.currentCompanyId ?? "—"}</code>} />
                  <DiagnosticRow label="is_super_admin()" value={yesNo(latestWoRun?.supabaseSession.isSuperAdmin ?? null)} />
                  <DiagnosticRow label="Session probe error" value={latestWoRun?.supabaseSession.error ?? "none"} />
                </div>
              </div>

              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Recent skip / failure records
                </p>
                {woDualWrite.recentIssues.length === 0 ? (
                  <EmptyHint>No recent skips or failures recorded in this session.</EmptyHint>
                ) : (
                  <div className="space-y-2">
                    {woDualWrite.recentIssues.slice(0, 10).map((issue, index) => (
                      <div key={`${issue.runId}-${issue.kind}-${index}`} className="rounded-xl border border-border bg-background p-3 text-[11px]">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className={cn("rounded px-2 py-0.5 font-semibold uppercase", issue.kind === "failure" ? "bg-red-500/10 text-red-600" : "bg-amber-500/10 text-amber-600")}>{issue.kind}</span>
                          <span className="font-mono text-muted-foreground">{issue.at}</span>
                          <span className="text-muted-foreground">table: {issue.tableName ?? "—"}</span>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                          <DiagnosticRow label="WO legacy_id" value={<code>{issue.workOrderLegacyId ?? "—"}</code>} />
                          <DiagnosticRow label="Displayed number" value={issue.displayedNumber ?? "—"} />
                          <DiagnosticRow label="companyId" value={<code>{issue.companyLegacyId ?? "—"}</code>} />
                          <DiagnosticRow label="Company map found" value={yesNo(issue.companyMappingFound)} />
                          <DiagnosticRow label="Supabase code" value={issue.supabaseCode ?? "—"} />
                          <DiagnosticRow label="Auth session" value={yesNo(issue.authSessionExists)} />
                          <DiagnosticRow label="current_company_id()" value={<code>{issue.currentCompanyId ?? "—"}</code>} />
                          <DiagnosticRow label="is_super_admin()" value={yesNo(issue.isSuperAdmin)} />
                        </div>
                        <p className="mt-2 break-words text-muted-foreground">{issue.supabaseMessage ?? issue.reason}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  SQL helper for latest legacy_id
                </p>
                <pre className="overflow-x-auto rounded-xl border border-border bg-background p-3 text-[11px] text-muted-foreground">
                  {sqlLegacyHelper(latestWoLegacyId)}
                </pre>
              </div>

              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Recent run history (last 10)
                </p>
                {woDualWrite.recentRuns.length === 0 ? (
                  <EmptyHint>No mirror runs recorded in this session yet.</EmptyHint>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-border bg-background">
                    <table className="w-full min-w-[900px] text-left text-[11px]">
                      <thead className="bg-muted/50 text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 font-medium">Run time</th>
                          <th className="px-3 py-2 font-medium">Kind</th>
                          <th className="px-3 py-2 font-medium">Created / updated / removed</th>
                          <th className="px-3 py-2 font-medium">Parents</th>
                          <th className="px-3 py-2 font-medium">Service rows</th>
                          <th className="px-3 py-2 font-medium">Skipped</th>
                          <th className="px-3 py-2 font-medium">Failures</th>
                          <th className="px-3 py-2 font-medium">Last error</th>
                        </tr>
                      </thead>
                      <tbody>
                        {woDualWrite.recentRuns.slice(0, 10).map((run) => (
                          <tr key={run.runId} className="border-t border-border">
                            <td className="px-3 py-2 font-mono text-muted-foreground">{run.startedAt}</td>
                            <td className="px-3 py-2">{run.kind}</td>
                            <td className="px-3 py-2 font-mono text-muted-foreground">
                              c:{shortList(run.diff.created)} · u:{shortList(run.diff.updated)} · r:{shortList(run.diff.removed)}
                            </td>
                            <td className="px-3 py-2">{run.parentsMirrored}/{run.parentRowsAttempted}</td>
                            <td className="px-3 py-2">{run.serviceRowsMirrored}/{run.serviceRowsAttempted}</td>
                            <td className="px-3 py-2">{run.skipped.length}</td>
                            <td className="px-3 py-2">{run.failures.length}</td>
                            <td className="px-3 py-2 text-muted-foreground">{run.lastError ?? "none"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* WO-5.5 — Work Order staging soak validation (validation only) */}
      <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            Work Orders · WO-5.5 Staging soak validation
          </div>
          <span
            className={`rounded-md px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
              WO_SOAK_READINESS.verdict === "READY"
                ? "bg-emerald-500/15 text-emerald-600"
                : "bg-amber-500/15 text-amber-600"
            }`}
          >
            {WO_SOAK_READINESS.verdict}
          </span>
        </div>
        <div className="px-4 py-3">
          <p className="mb-3 text-xs text-muted-foreground">
            The gate BEFORE Work Orders become authoritative (WO-6). The legacy soak harness is retained
            for reviewed validation but quarantined from normal runtime because it can mutate browser-domain
            stores and mirror into Supabase. Read-only shadow checks remain available here; no source-of-truth
            switch is performed by this panel.
          </p>
          <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {([
              ["Staging flags", WO_SOAK_FLAGS.map((f) => f.flag.replace("work_orders_", "")).join(" · ")],
              ["Read source", "localStorage (authoritative)"],
              ["Write source", "localStorage + Supabase mirror"],
              ["Schedule", "Local vs Supabase dry-run · 0 divergence required"],
              ["Cut-over criteria", `${WO_CUTOVER_CRITERIA.length} · all must pass`],
              ["Schedule switched", "No"],
            ] as ReadonlyArray<[string, string]>).map(([label, value]) => (
              <div
                key={label}
                className="flex items-center justify-between gap-2 rounded-xl border border-border bg-background px-3 py-2"
              >
                <span className="text-[11px] text-muted-foreground">{label}</span>
                <span className="text-[11px] font-medium">{value}</span>
              </div>
            ))}
          </div>
          <p className="mb-2 text-[11px] font-medium text-muted-foreground">
            Known limitations carried into WO-6
          </p>
          <div className="space-y-1.5">
            {WO_SOAK_LIMITATIONS.map((l) => (
              <div
                key={l.area}
                className="flex items-start justify-between gap-3 rounded-xl border border-border bg-background px-3 py-2"
              >
                <div>
                  <span className="text-[11px] font-medium">{l.area}</span>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{l.detail}</p>
                </div>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                    l.severity === "high"
                      ? "bg-amber-500/15 text-amber-600"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {l.severity}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* WO-6 — Work Order SOURCE-OF-TRUTH cut-over (flag-gated) */}
      <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            Work Orders · Source of Truth (WO-6)
          </div>
          <span
            className={`rounded-md px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
              WORK_ORDERS_SUPABASE_AUTHORITATIVE
                ? "bg-emerald-500/15 text-emerald-600"
                : "bg-muted text-muted-foreground"
            }`}
          >
            Authoritative {WORK_ORDERS_SUPABASE_AUTHORITATIVE ? "ON" : "OFF"}
          </span>
        </div>
        <div className="px-4 py-3">
          <p className="mb-3 text-xs text-muted-foreground">
            The Work Orders authority switch. Behind{" "}
            <code className="rounded bg-muted px-1">work_orders_supabase_authoritative</code> (default
            OFF), Supabase becomes the <strong>primary</strong> source for the Work Order list +
            WorkOrderDetails and the authoritative write target, while localStorage is kept as a
            synchronized <strong>backout copy</strong> ({WO_WRITE_STRATEGY.chosen.replace(/_/g, " ")}).
            Reads fall back to the backout copy on failure — recorded via{" "}
            <code className="rounded bg-muted px-1">recordWorkOrderCutoverFailure()</code>, never silent
            — and write-mirror failures are escalated. <strong>Schedule is NOT switched</strong>: the
            resolver still reads the local store and <code className="rounded bg-muted px-1">validateWorkOrderScheduleDependency()</code>{" "}
            stays clean. Rollback is a single flag flip; localStorage is already current.
          </p>

          {/* Live source-of-truth state + backout snapshot */}
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                Read source · {woCutover.readSource}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                Write source · {woCutover.writeSource}
              </span>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium",
                  woCutover.failures === 0
                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                )}
              >
                {woCutover.failures === 0 ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : (
                  <AlertTriangle className="h-3 w-3" />
                )}
                {woCutover.failures === 0
                  ? "0 divergence events"
                  : `${woCutover.failures} divergence event(s)`}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={takeWoBackout}
                disabled={!canRunBrowserDomainBackoutTool()}
                title={BROWSER_DOMAIN_TOOL_DISABLED_REASON}
              >
                <HardDrive className="mr-1.5 h-3.5 w-3.5" />
                Take backout snapshot
              </Button>
              <Button variant="outline" size="sm" onClick={refreshWoCutover}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Refresh
              </Button>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {([
              ["List reads (primary)", String(woCutover.listReadsPrimary)],
              ["Detail reads (primary)", String(woCutover.detailReadsPrimary)],
              ["Read fallbacks", String(woCutover.readFallbacks)],
              ["Write failures", String(woCutover.writeFailures)],
              ["Parents mirrored", String(woDualWrite.parentsMirrored)],
              ["Service rows mirrored", String(woDualWrite.serviceRowsMirrored)],
              ["Exceptions mirrored", String(woDualWrite.exceptionsMirrored)],
              ["Removals propagated", String(woDualWrite.parentsRemoved + woDualWrite.serviceRowsRemoved + woDualWrite.exceptionsRemoved)],
              ["Details switched", WORK_ORDERS_SUPABASE_AUTHORITATIVE ? "Yes" : "No"],
              ["Schedule switched", "No (local resolver)"],
              ["Schedule safety", "validateWorkOrderScheduleDependency · clean"],
              ["Rollback ready", "Yes (flag OFF)"],
            ] as ReadonlyArray<[string, string]>).map(([label, value]) => (
              <div
                key={label}
                className="flex items-center justify-between gap-2 rounded-xl border border-border bg-background px-3 py-2"
              >
                <span className="text-[11px] text-muted-foreground">{label}</span>
                <span className="text-[11px] font-medium">{value}</span>
              </div>
            ))}
          </div>

          <div className="mt-3 rounded-xl border border-border bg-background p-3">
            <p className="text-xs font-medium">Last backout snapshot</p>
            {woBackout ? (
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {new Date(woBackout.at).toLocaleString()} · {woBackout.total} work order(s),{" "}
                {woBackout.serviceRowTotal} service row(s), {woBackout.variationTotal} variation(s),{" "}
                {woBackout.exceptionTotal} exception(s) across {woBackout.companyIds.length}{" "}
                company(ies) · checksum{" "}
                <code className="rounded bg-muted px-1">{woBackout.checksum}</code>
              </p>
            ) : (
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                No snapshot taken yet. Capture one before flipping the authoritative flag.
              </p>
            )}
          </div>

          {/* Authority model + rollback + exit criteria */}
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <div className="rounded-xl border border-border bg-background p-3">
              <h4 className="mb-2 text-xs font-semibold">Authority model</h4>
              <div className="space-y-1.5">
                {WO_AUTHORITY_MODEL.map((a) => (
                  <div key={a.operation} className="flex items-start justify-between gap-2">
                    <span className="text-[11px] text-muted-foreground">{a.operation}</span>
                    <span className="shrink-0 text-[11px] font-medium">
                      {a.before} → {a.after}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-border bg-background p-3">
              <h4 className="mb-2 text-xs font-semibold">Rollback / backout plan</h4>
              <ol className="space-y-1.5">
                {WO_ROLLBACK_PLAN.map((s) => (
                  <li key={s.step} className="text-[11px] text-muted-foreground">
                    <span className="font-medium text-foreground">{s.step}.</span> {s.action}
                  </li>
                ))}
              </ol>
            </div>
          </div>

          <div className="mt-3 rounded-xl border border-border bg-background p-3">
            <h4 className="mb-2 text-xs font-semibold">Cut-over exit criteria</h4>
            <div className="grid gap-2 sm:grid-cols-2">
              {WO_CUTOVER_EXIT_CRITERIA.map((c) => (
                <div key={c.criterion} className="rounded-lg border border-border bg-card/60 p-2">
                  <p className="text-[11px] font-medium">{c.criterion}</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    <code className="rounded bg-muted px-1">{c.measuredBy}</code>
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-3 rounded-xl border border-sky-500/30 bg-sky-500/5 p-3">
            <p className="text-xs font-medium text-sky-700 dark:text-sky-400">
              Work Orders · {WORK_ORDER_MIGRATION_FINAL_STATUS.status}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {WORK_ORDER_MIGRATION_FINAL_STATUS.summary}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Next phase: <strong>{WORK_ORDER_MIGRATION_FINAL_STATUS.nextPhase}</strong> —{" "}
              {WORK_ORDER_MIGRATION_FINAL_STATUS.nextPhaseRationale[0]}
            </p>
          </div>
        </div>
      </div>

      {/* P6A — Schedule interval-query migration (DESIGN ONLY) */}
      <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            Schedule · Interval Query Migration (P6A)
          </div>
          <span className="rounded-md bg-sky-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-600">
            Design only
          </span>
        </div>
        <div className="px-4 py-3">
          <p className="mb-3 text-xs text-muted-foreground">
            {SCHEDULE_MIGRATION_DESIGN_VERDICT.summary}
          </p>

          <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {([
              ["Contract ready", "Reuse ScheduleRepository.listSummaries"],
              ["Input builder ready", "buildScheduleInputFromSupabase (WO-4)"],
              ["Shadow validation", "compareScheduleInterval (WO-4)"],
              ["Cache strategy", "IntervalCache + per-interval dataToken"],
              ["UI switched", "No"],
              ["Resolver changed", "No"],
              ["Realtime", "No"],
            ] as ReadonlyArray<[string, string]>).map(([label, value]) => (
              <div
                key={label}
                className="flex items-center justify-between gap-2 rounded-xl border border-border bg-background px-3 py-2"
              >
                <span className="text-[11px] text-muted-foreground">{label}</span>
                <span className="shrink-0 text-[11px] font-medium">{value}</span>
              </div>
            ))}
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-xl border border-border bg-background p-3">
              <h4 className="mb-2 text-xs font-semibold">Resolver input audit</h4>
              <div className="space-y-1.5">
                {SCHEDULE_INPUT_AUDIT.map((r) => (
                  <div key={r.input} className="flex items-start justify-between gap-2">
                    <span className="text-[11px] text-muted-foreground">{r.input}</span>
                    <span className="shrink-0 text-[11px] font-medium">{r.state}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-border bg-background p-3">
              <h4 className="mb-2 text-xs font-semibold">Contract decision</h4>
              <div className="space-y-1.5">
                {SCHEDULE_CONTRACT_DECISION.map((c) => (
                  <div key={c.member} className="flex items-start justify-between gap-2">
                    <span className="text-[11px] text-muted-foreground">{c.member}</span>
                    <span className="shrink-0 text-[11px] font-medium uppercase">{c.decision}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-3 rounded-xl border border-border bg-background p-3">
            <h4 className="mb-2 text-xs font-semibold">Interval fetch classes (company + date scoped)</h4>
            <div className="space-y-2">
              {SCHEDULE_FETCH_CLASSES.map((f) => (
                <div key={f.recordClass}>
                  <p className="text-[11px] font-medium">{f.recordClass}</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    <code className="rounded bg-muted px-1">{f.index}</code>
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <div className="rounded-xl border border-border bg-background p-3">
              <h4 className="mb-2 text-xs font-semibold">Cache invalidation</h4>
              <div className="space-y-1.5">
                {SCHEDULE_CACHE_INVALIDATION.map((c) => (
                  <div key={c.event} className="flex items-start justify-between gap-2">
                    <span className="text-[11px] text-muted-foreground">{c.event}</span>
                    <span className="shrink-0 text-[11px] font-medium">{c.scope}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-border bg-background p-3">
              <h4 className="mb-2 text-xs font-semibold">Shadow validation dimensions</h4>
              <div className="space-y-1.5">
                {SCHEDULE_SHADOW_DIMENSIONS.map((d) => (
                  <div key={d.dimension} className="flex items-start justify-between gap-2">
                    <span className="text-[11px] text-muted-foreground">{d.dimension}</span>
                    <span className="shrink-0 text-[11px] font-medium">
                      {d.blocking ? "blocking" : "info"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-3 rounded-xl border border-border bg-background p-3">
            <h4 className="mb-2 text-xs font-semibold">Risks / blockers</h4>
            <div className="space-y-1.5">
              {SCHEDULE_DESIGN_RISKS.map((r) => (
                <div key={r.rank} className="flex items-start justify-between gap-2">
                  <span className="text-[11px] text-muted-foreground">
                    {r.rank}. {r.risk}
                  </span>
                  <span className="shrink-0 text-[11px] font-medium uppercase">{r.severity}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-3 rounded-xl border border-sky-500/30 bg-sky-500/5 p-3">
            <p className="text-xs font-medium text-sky-700 dark:text-sky-400">
              Schedule · {SCHEDULE_MIGRATION_DESIGN_VERDICT.status}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Next phase: <strong>{SCHEDULE_MIGRATION_DESIGN_VERDICT.nextPhase}</strong> —{" "}
              {SCHEDULE_MIGRATION_DESIGN_VERDICT.nextPhaseRationale[0]}
            </p>
          </div>
        </div>
      </div>

      {/* P6B — Schedule interval read switch (flag-gated) */}
      <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Database className="h-4 w-4 text-muted-foreground" />
            Schedule · P6B Interval Read
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={refreshScheduleCutover}
              className="rounded-md border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted"
            >
              Refresh
            </button>
            <span
              className={cn(
                "rounded-md px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                SCHEDULE_SUPABASE_INTERVAL_READ
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-muted text-muted-foreground",
              )}
            >
              Flag {SCHEDULE_SUPABASE_INTERVAL_READ ? "ON" : "OFF"}
            </span>
          </div>
        </div>
        <div className="px-4 py-3">
          <p className="mb-3 text-xs text-muted-foreground">
            The <strong>Schedule</strong> can now build its resolver INPUT (work orders + base
            occurrence exceptions) from Supabase behind the{" "}
            <code className="rounded bg-muted px-1">schedule_supabase_interval_read</code> flag
            (default OFF) via <code className="rounded bg-muted px-1">useScheduleInputSource</code> →
            <code className="rounded bg-muted px-1">buildScheduleInputFromSupabase()</code>. Only the
            input SOURCE moves — <code className="rounded bg-muted px-1">resolveScheduleProgram</code>,
            recurrence / variation / exception LOGIC, the board, metrics, filters, cache and every
            interaction are unchanged, and customer / employee / postal-city lookups stay local. If
            Supabase is unreachable / errors / returns nothing, the Schedule falls back to the
            localStorage input so it never breaks. A background{" "}
            <code className="rounded bg-muted px-1">compareScheduleEntries()</code> diff surfaces any
            interval drift. The cache key carries the active source so local / Supabase intervals can
            never collide. Rollback is instant and data-free: set the flag OFF.
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {([
              ["Active input source", scheduleCutover.inputSource === "supabase" ? "Supabase (fallback: local)" : "localStorage"],
              ["Supabase inputs built", String(scheduleCutover.supabaseInputs)],
              ["Fallback count", String(scheduleCutover.fallbacks)],
              ["Shadow drift count", String(scheduleCutover.shadowDrift)],
              ["Last mismatch", scheduleCutover.lastMismatch ?? "None"],
              ["Cache source mode", SCHEDULE_SUPABASE_INTERVAL_READ ? "supabase-keyed" : "local-keyed"],
              ["UI switched", "Input source only (board unchanged)"],
              ["Resolver changed", "No"],
              ["Realtime", "No"],
            ] as ReadonlyArray<[string, string]>).map(([label, value]) => (
              <div
                key={label}
                className="flex items-center justify-between gap-2 rounded-xl border border-border bg-background px-3 py-2"
              >
                <span className="text-[11px] text-muted-foreground">{label}</span>
                <span className="shrink-0 text-[11px] font-medium">{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* P6C — Schedule true interval-scoped query */}
      <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Database className="h-4 w-4 text-muted-foreground" />
            Schedule · P6C Interval Query
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={refreshScheduleCutover}
              className="rounded-md border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted"
            >
              Refresh
            </button>
            <span
              className={cn(
                "rounded-md px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                SCHEDULE_SUPABASE_INTERVAL_READ
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-muted text-muted-foreground",
              )}
            >
              Flag {SCHEDULE_SUPABASE_INTERVAL_READ ? "ON" : "OFF"}
            </span>
          </div>
        </div>
        <div className="px-4 py-3">
          <p className="mb-3 text-xs text-muted-foreground">
            The Supabase Schedule input is now <strong>true interval-scoped</strong> via{" "}
            <code className="rounded bg-muted px-1">fetchScheduleIntervalFromSupabase()</code>: it no
            longer hydrates every work order. A <code className="rounded bg-muted px-1">(company_id, date)</code>
            -bounded query pulls only the service rows that overlap the window, then only the parent
            work orders those rows belong to, plus the exceptions in the window. The scan window is
            widened exactly as <code className="rounded bg-muted px-1">resolveScheduleProgram</code>{" "}
            widens it (a reschedule whose moved-to date lands in range pulls its rule date in), so the
            resolver yields identical occurrences — only the fetch is smaller. The resolver, board,
            recurrence / variation / exception LOGIC are unchanged; no realtime.
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {([
              ["Query mode", SCHEDULE_SUPABASE_INTERVAL_READ ? "Interval-scoped" : "Inactive (flag OFF)"],
              ["Interval queries run", String(scheduleCutover.intervalQueries)],
              [
                "Service rows fetched",
                scheduleCutover.lastIntervalQuery ? String(scheduleCutover.lastIntervalQuery.serviceRows) : "—",
              ],
              [
                "Parents fetched",
                scheduleCutover.lastIntervalQuery ? String(scheduleCutover.lastIntervalQuery.parents) : "—",
              ],
              [
                "Exceptions fetched",
                scheduleCutover.lastIntervalQuery ? String(scheduleCutover.lastIntervalQuery.exceptions) : "—",
              ],
              [
                "Last window",
                scheduleCutover.lastIntervalQuery
                  ? `${scheduleCutover.lastIntervalQuery.queryFromDate}..${scheduleCutover.lastIntervalQuery.queryToDate}`
                  : "—",
              ],
              [
                "Scan widened",
                scheduleCutover.lastIntervalQuery
                  ? scheduleCutover.lastIntervalQuery.widened
                    ? "Yes (reschedule moved IN)"
                    : "No"
                  : "—",
              ],
              ["Fallback count", String(scheduleCutover.fallbacks)],
              ["Cache token mode", SCHEDULE_SUPABASE_INTERVAL_READ ? "Per-interval (source+scope+window+counts)" : "local-keyed"],
              ["Resolver changed", "No"],
              ["UI changed", "No"],
            ] as ReadonlyArray<[string, string]>).map(([label, value]) => (
              <div
                key={label}
                className="flex items-center justify-between gap-2 rounded-xl border border-border bg-background px-3 py-2"
              >
                <span className="text-[11px] text-muted-foreground">{label}</span>
                <span className="shrink-0 text-[11px] font-medium">{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* P6D — Schedule source of truth (authoritative input cutover) */}
      <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Database className="h-4 w-4 text-muted-foreground" />
            Schedule · Source of Truth
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={refreshScheduleCutover}
              className="rounded-md border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted"
            >
              Refresh
            </button>
            <span
              className={cn(
                "rounded-md px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                SCHEDULE_SUPABASE_AUTHORITATIVE
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-muted text-muted-foreground",
              )}
            >
              Flag {SCHEDULE_SUPABASE_AUTHORITATIVE ? "ON" : "OFF"}
            </span>
          </div>
        </div>
        <div className="px-4 py-3">
          <p className="mb-3 text-xs text-muted-foreground">
            P6D makes Supabase the <strong>authoritative</strong> Schedule INPUT behind the{" "}
            <code className="rounded bg-muted px-1">schedule_supabase_authoritative</code> flag
            (default OFF). It does <strong>not</strong> build a server-generated occurrence engine —
            that P6C approach was too risky. Instead it reuses the validated P6C interval-scoped
            Supabase input as primary and keeps the existing{" "}
            <code className="rounded bg-muted px-1">resolveScheduleProgram</code> as the only resolver.
            localStorage stays a synchronized fallback / backout input: on any Supabase failure the
            Schedule falls back to local and the fallback is RECORDED — never silent. The background
            shadow diff stays active and the interval cache key carries the authority mode so an
            authoritative interval can never collide with a non-authoritative one. Rollback is instant
            and data-free: set the flag OFF → localStorage authoritative again.
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {([
              ["Authoritative mode", SCHEDULE_SUPABASE_AUTHORITATIVE ? "Supabase" : "localStorage"],
              ["Read source", scheduleCutover.inputSource === "supabase" ? "Supabase (fallback: local)" : "localStorage"],
              ["Write source", "localStorage (Schedule has no writes)"],
              ["Fallback count", String(scheduleCutover.fallbacks)],
              ["Failure count", String(scheduleCutover.failures)],
              ["Shadow drift count", String(scheduleCutover.shadowDrift)],
              ["Last mismatch", scheduleCutover.lastMismatch ?? "None"],
              ["Schedule safety", scheduleCutover.shadowDrift === 0 ? "Clean (parity)" : "Drift — see shadow"],
              ["Cache authority key", SCHEDULE_SUPABASE_AUTHORITATIVE ? "auth-keyed" : "read-keyed"],
              ["Resolver changed", "No"],
              ["Realtime", "No"],
              ["Rollback ready", "Yes (flag OFF → local authoritative)"],
            ] as ReadonlyArray<[string, string]>).map(([label, value]) => (
              <div
                key={label}
                className="flex items-center justify-between gap-2 rounded-xl border border-border bg-background px-3 py-2"
              >
                <span className="text-[11px] text-muted-foreground">{label}</span>
                <span className="shrink-0 text-[11px] font-medium">{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* P6E — Schedule authoritative staging soak */}
      <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            Schedule · P6E Staging soak validation
          </div>
          <div className="flex items-center gap-2">
            {scheduleSoak ? (
              <span
                className={cn(
                  "rounded-md px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                  scheduleSoak.verdict === "READY"
                    ? "bg-emerald-500/15 text-emerald-600"
                    : "bg-amber-500/15 text-amber-600",
                )}
              >
                {scheduleSoak.verdict}
              </span>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={runScheduleSoak}
              disabled={scheduleSoakRunning || !canRunBrowserDomainSoakTool()}
              title={BROWSER_DOMAIN_TOOL_DISABLED_REASON}
            >
              <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", scheduleSoakRunning && "animate-spin")} />
              {scheduleSoakRunning ? "Running…" : "Run soak"}
            </Button>
          </div>
        </div>
        <div className="px-4 py-3">
          <p className="mb-3 text-xs text-muted-foreground">
            The legacy Schedule soak harness is retained for reviewed validation but quarantined from normal
            runtime because it exercises fallback and rollback drills against browser-domain stores. The
            <code className="rounded bg-muted px-1">resolveScheduleProgram</code> resolver is untouched; this
            panel no longer executes browser-origin soak tooling.
          </p>
          {!scheduleSoak ? (
            <p className="text-xs text-muted-foreground">
              Browser-origin soak execution is quarantined in normal runtime. Use a reviewed controlled
              validation plan before re-enabling this harness.
            </p>
          ) : (
            <>
              <div
                className={cn(
                  "mb-3 flex items-center gap-2 rounded-xl border px-3 py-2 text-[11px] font-medium",
                  scheduleSoak.verdict === "READY"
                    ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-600"
                    : "border-amber-500/30 bg-amber-500/5 text-amber-600",
                )}
              >
                {scheduleSoak.verdict === "READY" ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <AlertTriangle className="h-4 w-4" />
                )}
                Verdict · {scheduleSoak.verdict}
                {scheduleSoak.blockers.length > 0 ? ` — ${scheduleSoak.blockers.join("; ")}` : ""}
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {([
                  ["Authoritative flag", scheduleSoak.authoritativeFlag ? "ON" : "OFF"],
                  ["Active input source", scheduleSoak.inputSource === "supabase" ? "Supabase (fallback: local)" : "localStorage"],
                  ["Interval comparisons", String(scheduleSoak.scheduleRuns)],
                  ["Intervals clean", String(scheduleSoak.scheduleClean)],
                  ["Critical drift", String(scheduleSoak.criticalDrift)],
                  ["Occurrence divergences", String(scheduleSoak.totalDivergences)],
                  ["Local occurrences", String(scheduleSoak.totalLocalOccurrences)],
                  ["Supabase occurrences", String(scheduleSoak.totalSupabaseOccurrences)],
                  ["Service-row parity", scheduleSoak.serviceRowParityOk ? "Clean" : "Drift"],
                  ["Variation parity", scheduleSoak.variationParityOk ? "Clean" : "Drift"],
                  ["Exception parity", scheduleSoak.exceptionParityOk ? "Clean" : "Drift"],
                  ["Fallback verified", scheduleSoak.fallbackVerified ? "Yes" : "No"],
                  ["Rollback verified", scheduleSoak.rollbackVerified ? "Yes" : "No"],
                  ["Resolver changed", "No"],
                  ["Realtime", "No"],
                ] as ReadonlyArray<[string, string]>).map(([label, value]) => (
                  <div
                    key={label}
                    className="flex items-center justify-between gap-2 rounded-xl border border-border bg-background px-3 py-2"
                  >
                    <span className="text-[11px] text-muted-foreground">{label}</span>
                    <span className="shrink-0 text-[11px] font-medium">{value}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {scheduleSoak.intervals
                  .filter((iv, idx, arr) => arr.findIndex((x) => x.viewMode === iv.viewMode) === idx)
                  .map((iv) => (
                    <div key={iv.viewMode} className="rounded-xl border border-border bg-background px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-medium capitalize">{iv.viewMode}</span>
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase",
                            iv.ok ? "bg-emerald-500/15 text-emerald-600" : "bg-amber-500/15 text-amber-600",
                          )}
                        >
                          {iv.ok ? "parity" : "drift"}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        {iv.localOccurrences} local · {iv.supabaseOccurrences} supabase
                      </p>
                    </div>
                  ))}
              </div>
              {scheduleSoak.perf.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {scheduleSoak.perf.map((p) => (
                    <span
                      key={p.label}
                      className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                    >
                      {p.label} · {p.calls}× · avg {p.avgMs.toFixed(1)}ms · max {p.maxMs.toFixed(1)}ms
                    </span>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      {/* P6F — Schedule migration closure audit */}
      <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            Schedule · Migration Closure (P6F)
          </div>
          <span
            className={cn(
              "rounded-md px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
              SCHEDULE_CLOSURE_AUDIT.verdict === "closed"
                ? "bg-emerald-500/15 text-emerald-600"
                : "bg-amber-500/15 text-amber-600",
            )}
          >
            {SCHEDULE_CLOSURE_AUDIT.verdict}
          </span>
        </div>
        <div className="px-4 py-3">
          <p className="mb-3 text-xs text-muted-foreground">
            {SCHEDULE_CLOSURE_AUDIT.summary}
          </p>

          {/* Closure status grid */}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {([
              ["Verdict", SCHEDULE_CLOSURE_AUDIT.verdict === "closed" ? "Closed" : "Blocked"],
              ["Resolver changed", SCHEDULE_CLOSURE_AUDIT.resolverChanged ? "Yes" : "No"],
              ["UI changed", SCHEDULE_CLOSURE_AUDIT.uiChanged ? "Yes" : "No"],
              ["Realtime", SCHEDULE_CLOSURE_AUDIT.realtime ? "Yes" : "No"],
              ["Critical drift (P6E soak)", String(SCHEDULE_CLOSURE_AUDIT.criticalDrift)],
              ["Remaining localStorage", SCHEDULE_CLOSURE_AUDIT.remainingLocalStorageIsIntentional ? "Intentional (fallback/lookup/tooling)" : "Review"],
              ["Rollback verified", SCHEDULE_CLOSURE_AUDIT.rollbackVerified ? "Yes" : "No"],
              ["Live shadow drift", scheduleCutover.shadowDrift === 0 ? "0 (clean)" : String(scheduleCutover.shadowDrift)],
              ["Live fallback count", String(scheduleCutover.fallbacks)],
            ] as ReadonlyArray<[string, string]>).map(([label, value]) => (
              <div
                key={label}
                className="flex items-center justify-between gap-2 rounded-xl border border-border bg-background px-3 py-2"
              >
                <span className="text-[11px] text-muted-foreground">{label}</span>
                <span className="shrink-0 text-[11px] font-medium">{value}</span>
              </div>
            ))}
          </div>

          {/* Flag audit */}
          <p className="mb-2 mt-4 text-[11px] font-medium text-muted-foreground">Schedule flag audit (both default OFF)</p>
          <div className="grid gap-2 lg:grid-cols-2">
            {SCHEDULE_FLAG_AUDIT.map((f) => (
              <div key={f.flag} className="rounded-xl border border-border bg-background px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <code className="rounded bg-muted px-1 text-[10px]">{f.flag}</code>
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                    #{f.dependencyOrder} · {f.intendedEnv}
                  </span>
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">{f.controls}</p>
                <p className="mt-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">{f.rollback}</p>
              </div>
            ))}
          </div>

          {/* Input-source map */}
          <p className="mb-2 mt-4 text-[11px] font-medium text-muted-foreground">Resolver input-source map</p>
          <div className="grid gap-2 lg:grid-cols-2">
            {SCHEDULE_SOURCE_MAP.map((s) => (
              <div key={s.input} className="rounded-xl border border-border bg-background px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium">{s.input}</span>
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                    {s.source}
                  </span>
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">{s.note}</p>
              </div>
            ))}
          </div>

          {/* Rollback drill */}
          <p className="mb-2 mt-4 text-[11px] font-medium text-muted-foreground">Verified rollback drill (flags OFF, reverse order)</p>
          <div className="space-y-1.5">
            {SCHEDULE_ROLLBACK_DRILL.map((r) => (
              <div key={r.order} className="flex items-start gap-2 rounded-xl border border-border bg-background px-3 py-2">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-muted text-[9px] font-semibold">
                  {r.order}
                </span>
                <div>
                  <code className="rounded bg-muted px-1 text-[10px]">{r.action}</code>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">{r.expected}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Fallback path */}
          <p className="mb-2 mt-4 text-[11px] font-medium text-muted-foreground">localStorage fallback / backout path (all recorded, none silent)</p>
          <div className="grid gap-2 lg:grid-cols-2">
            {SCHEDULE_FALLBACK_PATH.map((f) => (
              <div key={f.scenario} className="rounded-xl border border-border bg-background px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium">{f.scenario}</span>
                  <span className="shrink-0 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                    {f.recorded ? "recorded" : "n/a"}
                  </span>
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">{f.behaviour}</p>
              </div>
            ))}
          </div>

          {/* Next entity */}
          <div className="mt-4 rounded-xl border border-sky-500/30 bg-sky-500/5 p-3">
            <p className="text-xs font-medium text-sky-700 dark:text-sky-400">
              Next migration track: {SCHEDULE_CLOSURE_AUDIT.nextEntity}
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-muted-foreground">
              {SCHEDULE_CLOSURE_AUDIT.nextEntityRationale.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <p className="mt-2 text-[10px] text-muted-foreground">
              Future cleanup candidates (after prod-stable):{" "}
              {SCHEDULE_FUTURE_CLEANUP_CANDIDATES.map((c) => c.item).join(" · ")}
            </p>
          </div>
        </div>
      </div>

      {/* P7A — Employees migration DESIGN & CONTRACT AUDIT (design-only) */}
      <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Database className="h-4 w-4 text-muted-foreground" />
            Employees · Migration Design &amp; Contract Audit (P7A)
          </div>
          <span className="rounded-md bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-600 dark:text-sky-400">
            design only
          </span>
        </div>
        <div className="px-4 py-3">
          <p className="mb-3 text-xs text-muted-foreground">
            The next migration track. <strong>Employees</strong> are a flat record with no
            schedule-critical child rows — the Schedule reads them as an{" "}
            <code className="rounded bg-muted px-1">id&nbsp;&rarr;&nbsp;name</code> lookup only
            (assignment lives on the already-migrated{" "}
            <code className="rounded bg-muted px-1">work_order_service_rows</code>). All writes funnel
            through one <code className="rounded bg-muted px-1">persistEmployees</code> seam. The
            <code className="rounded bg-muted px-1">EmployeeSummary/Detail</code> DTOs, the repository
            contract and the localStorage adapter already exist from Wave&nbsp;0. Activity Log and
            Time Reports stay deferred. No schema, no migration, no UI switch, no logic change.
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {([
              ["Single write seam", EMPLOYEE_DESIGN_VERDICT.singleWriteSeam],
              ["Read paths mapped", String(EMPLOYEE_READ_PATHS.length)],
              ["Write paths mapped", String(EMPLOYEE_WRITE_PATHS.length)],
              ["Schedule-critical employee fields", String(EMPLOYEE_SCHEDULE_DEPENDENCIES.filter((d) => d.critical).length) + " (assignment owned by service rows)"],
              ["Proposed tables", EMPLOYEE_TABLES.map((t) => t.table).join(", ")],
              ["Migration waves", EMPLOYEE_WAVES.map((w) => w.id).join(" · ")],
              ["DTOs / contract", "Exist (Wave 0)"],
              ["UI switched", "No"],
              ["Logic changed", "No"],
            ] as ReadonlyArray<[string, string]>).map(([label, value]) => (
              <div
                key={label}
                className="flex items-center justify-between gap-2 rounded-xl border border-border bg-background px-3 py-2"
              >
                <span className="text-[11px] text-muted-foreground">{label}</span>
                <span className="shrink-0 text-right text-[11px] font-medium">{value}</span>
              </div>
            ))}
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <div className="rounded-xl border border-border bg-background p-3">
              <p className="mb-2 text-xs font-semibold">Migration waves</p>
              <ol className="space-y-1">
                {EMPLOYEE_WAVES.map((w) => (
                  <li key={w.id} className="text-[11px] text-muted-foreground">
                    <code className="rounded bg-muted px-1">{w.id}</code> {w.title}
                    {w.uiSwitch ? <span className="ml-1 text-[10px] uppercase text-amber-600 dark:text-amber-400">ui</span> : null}
                  </li>
                ))}
              </ol>
            </div>
            <div className="rounded-xl border border-border bg-background p-3">
              <p className="mb-2 text-xs font-semibold">Top risks</p>
              <ol className="space-y-1">
                {EMPLOYEE_RISKS.slice(0, 4).map((r) => (
                  <li key={r.rank} className="text-[11px] text-muted-foreground">
                    <span
                      className={cn(
                        "mr-1 rounded px-1 py-0.5 text-[10px] font-medium uppercase",
                        r.level === "critical"
                          ? "bg-red-500/10 text-red-600 dark:text-red-400"
                          : r.level === "high"
                            ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                            : "bg-muted text-muted-foreground",
                      )}
                    >
                      {r.level}
                    </span>
                    {r.risk}
                  </li>
                ))}
              </ol>
            </div>
          </div>

          <div className="mt-3 rounded-xl border border-sky-500/30 bg-sky-500/5 p-3">
            <p className="text-xs font-medium text-sky-700 dark:text-sky-400">
              Verdict · {EMPLOYEE_DESIGN_VERDICT.verdict}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">{EMPLOYEE_DESIGN_VERDICT.keyFinding}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Recommended first wave: <strong>{EMPLOYEE_DESIGN_VERDICT.recommendedFirstWave}</strong>
            </p>
          </div>
        </div>
      </div>

      {/* P7B — Employees EMP-0 contracts & local adapter parity */}
      <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Database className="h-4 w-4 text-muted-foreground" />
            Employees · EMP-0 contracts and local adapter parity (P7B)
          </div>
          <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
            validated
          </span>
        </div>
        <div className="px-4 py-3">
          <p className="mb-3 text-xs text-muted-foreground">
            Pre-migration validation. <code className="rounded bg-muted px-1">validateEmployeeParity()</code>{" "}
            (lib/data/employeeParity.ts + employeeParity.test.ts) asserts the already-existing
            localStorage employee adapter faithfully represents the current{" "}
            <code className="rounded bg-muted px-1">Employee</code> aggregate behind the existing{" "}
            <code className="rounded bg-muted px-1">EmployeeRepository</code> contract. No new contract
            surface is required. No schema, no migration, no UI switch, no logic change.
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {([
              ["Contract / DTOs", "Exist (Wave 0) — no new fields"],
              ["Parity dimensions", `${EMPLOYEE_EMP0_PARITY.length} validated`],
              ["Id stability", "Asserted (service-row assignments + deferred Time Reports)"],
              ["Repository methods", EMPLOYEE_CONTRACT_PROPOSALS.find((c) => c.contract === "EmployeeRepository")?.fields.join(" / ") ?? ""],
              ["UI switched", "No"],
              ["Logic changed", "No"],
            ] as ReadonlyArray<[string, string]>).map(([label, value]) => (
              <div
                key={label}
                className="flex items-center justify-between gap-2 rounded-xl border border-border bg-background px-3 py-2"
              >
                <span className="text-[11px] text-muted-foreground">{label}</span>
                <span className="shrink-0 text-right text-[11px] font-medium">{value}</span>
              </div>
            ))}
          </div>

          <div className="mt-3 rounded-xl border border-border bg-background p-3">
            <p className="mb-2 text-xs font-semibold">Parity dimensions</p>
            <ul className="space-y-1">
              {EMPLOYEE_EMP0_PARITY.map((d) => (
                <li key={d.dimension} className="flex items-start gap-2 text-[11px] text-muted-foreground">
                  <span
                    className={cn(
                      "mt-0.5 shrink-0 rounded px-1 py-0.5 text-[10px] font-medium uppercase",
                      d.verdict === "validated"
                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                        : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                    )}
                  >
                    {d.dimension}
                  </span>
                  <span>{d.note}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
            <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
              EMP-0 verdict · local adapter parity validated
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              The EmployeeSummary/Detail DTOs and the EmployeeRepository contract are sufficient as-is.
              Time Reports and Activity Log remain deferred and soft-reference employees by a stable id.
              Ready for EMP-1 (Supabase schema + read repository).
            </p>
          </div>
        </div>
      </div>

      {/* P7C — Employees EMP-1 schema, repository & shadow read */}
      <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Database className="h-4 w-4 text-muted-foreground" />
            Employees · EMP-1 schema, read repository &amp; shadow read (P7C)
          </div>
          <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
            shadow ready
          </span>
        </div>
        <div className="px-4 py-3">
          <p className="mb-3 text-xs text-muted-foreground">
            The Supabase FOUNDATION for Employees. A single{" "}
            <code className="rounded bg-muted px-1">employees</code> table (mirrors the customers
            convention) with the WO-5.6{" "}
            <code className="rounded bg-muted px-1">deleted_at</code> soft-delete,{" "}
            <code className="rounded bg-muted px-1">SupabaseEmployeeRepository</code>,{" "}
            the employee migration adapter and{" "}
            <code className="rounded bg-muted px-1">shadowReadEmployees()</code> — all proven by
            employeeMigration.test.ts. The headline guarantee is{" "}
            <strong>legacy_id stability</strong> (service-row assignments + deferred Time Reports
            reference the employee by it). No UI switch, no Schedule change, no assignment-logic
            change; localStorage remains authoritative.
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {([
              ["Schema", "employees (single table) · 0010"],
              ["Repository", "listSummaries / getDetail / search / count"],
              ["Migration", "Dry-run · idempotent · legacy_id preserved"],
              ["Shadow read", `${EMPLOYEE_EMP1_DELIVERABLES.length} deliverables ready`],
              ["UI switched", "No"],
              ["Schedule changed", "No"],
            ] as ReadonlyArray<[string, string]>).map(([label, value]) => (
              <div
                key={label}
                className="flex items-center justify-between gap-2 rounded-xl border border-border bg-background px-3 py-2"
              >
                <span className="text-[11px] text-muted-foreground">{label}</span>
                <span className="shrink-0 text-right text-[11px] font-medium">{value}</span>
              </div>
            ))}
          </div>

          <div className="mt-3 rounded-xl border border-border bg-background p-3">
            <p className="mb-2 text-xs font-semibold">Deliverables</p>
            <ul className="space-y-1">
              {EMPLOYEE_EMP1_DELIVERABLES.map((d) => (
                <li key={d.deliverable} className="flex items-start gap-2 text-[11px] text-muted-foreground">
                  <span
                    className={cn(
                      "mt-0.5 shrink-0 rounded px-1 py-0.5 text-[10px] font-medium uppercase",
                      d.verdict === "ready"
                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                        : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                    )}
                  >
                    {d.deliverable}
                  </span>
                  <span>{d.note}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
            <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
              EMP-1 verdict · schema + repository + migration + shadow read ready
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Employee browser-origin migration/backfill execution is quarantined in normal runtime. Use a
              reviewed server-side or controlled validation plan for any future backfill, then confirm 0
              critical drift with read-only validation before proceeding.
            </p>
          </div>
        </div>
      </div>

      {/* EMP-2 — Employees Supabase read path (flag-gated, read-only telemetry) */}
      <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Database className="h-4 w-4 text-muted-foreground" />
            Employees · EMP-2 Read Path
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={refreshEmployeeCutover}
              className="rounded-md border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted"
            >
              Refresh
            </button>
            <span
              className={cn(
                "rounded-md px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                EMPLOYEES_SUPABASE_READ
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-muted text-muted-foreground",
              )}
            >
              Flag {EMPLOYEES_SUPABASE_READ ? "ON" : "OFF"}
            </span>
          </div>
        </div>
        <div className="px-4 py-3">
          <p className="mb-3 text-xs text-muted-foreground">
            The <strong>Employees</strong> directory can now hydrate from Supabase behind the{" "}
            <code className="rounded bg-muted px-1">employees_supabase_read</code> flag (default OFF)
            via <code className="rounded bg-muted px-1">useEmployeeDirectorySource</code> →{" "}
            <code className="rounded bg-muted px-1">listFullEmployeesFromSupabase()</code>. The UI is
            seeded SYNCHRONOUSLY from localStorage so it never flashes; the directory reconciles to
            Supabase ONLY on a healthy, non-empty result. An empty Supabase result while localStorage
            has data is treated as <strong>unsafe</strong> — the local seed is kept (never blanks). A
            background <code className="rounded bg-muted px-1">shadowReadEmployees()</code> diff
            surfaces any drift. localStorage stays authoritative and the ONLY write target — no
            dual-write, no authoritative mode. Rollback is instant and data-free: set the flag OFF.
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {([
              ["Active read source", employeeCutover.readSource === "supabase" ? "Supabase (fallback: local)" : "localStorage"],
              ["Supabase reads", String(employeeCutover.supabaseReads)],
              ["Local reads", String(employeeCutover.localReads)],
              ["Fallback count", String(employeeCutover.fallbacks)],
              ["Failure count", String(employeeCutover.failures)],
              ["Shadow drift count", String(employeeCutover.shadowDrift)],
              ["Unsafe empty reads", String(employeeCutover.unsafeEmptyReads)],
              ["Last mismatch", employeeCutover.lastMismatch ?? "None"],
              ["Last event", employeeCutover.lastEventAt ?? "None"],
            ] as ReadonlyArray<[string, string]>).map(([label, value]) => (
              <div
                key={label}
                className="flex items-center justify-between gap-2 rounded-xl border border-border bg-background px-3 py-2"
              >
                <span className="text-[11px] text-muted-foreground">{label}</span>
                <span className="shrink-0 text-[11px] font-medium">{value}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
            <p className="text-[11px] text-muted-foreground">
              Governed status remains <strong>Under Migration / Not Ready</strong>. This panel is
              observational only — it never promotes the registry. EMP-2 is read-path infrastructure,
              not activation.
            </p>
          </div>
        </div>
      </div>

      {/* Future usage monitoring (placeholder) */}
      <div className="mt-8">
        <div className="mb-3 flex items-center gap-2">
          <HardDrive className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-base font-semibold">Future Usage Monitoring</h2>
        </div>
        <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-5">
          <p className="mb-4 max-w-3xl text-sm text-muted-foreground">
            Planned categories for per-company usage attribution. Not yet implemented — no metering
            storage, no usage tables, no billing. These will be collected at the server boundary
            once operational data moves to Supabase (P4), each tagged with a{" "}
            <code className="rounded bg-muted px-1">companyId</code>.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {FUTURE_USAGE_CATEGORIES.map((c) => (
              <div key={c.label} className="rounded-xl border border-border bg-card/60 p-3.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{c.label}</span>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Planned
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{c.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
