import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  Ban,
  Boxes,
  CheckCircle2,
  Cpu,
  Database,
  FileText,
  GitBranch,
  History,
  ListChecks,
  Lock,
  Map as MapIcon,
  PauseCircle,
  PlayCircle,
  Plug,
  Radio,
  ScrollText,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { AccessDenied } from "@/components/AccessDenied";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useApp } from "@/context/AppContext";
import {
  computeModuleHealth,
  getDevelopmentModules,
  isPlannedModule,
  moduleNameForKey,
  type ActivityLogStatus,
  type AiStatus,
  type ApiStatus,
  type DevelopmentModule,
  type HealthBand,
  type ModuleStatus,
  type SupabaseStatus,
} from "@/lib/developmentCenter";
import {
  getTimelineEntries,
  TIMELINE_DEFAULT_LIMIT,
  type TimelineCategory,
  type TimelineEntry,
} from "@/lib/developmentTimeline";
import { getPausedWorkstreams, type PausedWorkstream } from "@/lib/pausedWorkstreams";
import {
  MISSION_LOG_DUAL_WRITE,
  MISSION_LOG_SUPABASE_READ,
  MISSION_LOG_SUPABASE_AUTHORITATIVE,
  TIME_REPORTING_SUPABASE_READ,
  TIME_REPORTING_DUAL_WRITE,
  TIME_REPORTING_SUPABASE_AUTHORITATIVE,
  TIME_REPORTING_SHADOW_VALIDATE,
  SERVICES_SUPABASE_READ,
  SERVICES_DUAL_WRITE,
  SERVICES_SUPABASE_AUTHORITATIVE,
  SERVICE_CATEGORIES_SUPABASE_READ,
  SERVICE_CATEGORIES_DUAL_WRITE,
  SERVICE_CATEGORIES_SUPABASE_AUTHORITATIVE,
} from "@/lib/featureFlags";
import {
  getMissionLogCutoverState,
  shouldMirrorMissionLogCheckout,
} from "@/lib/data/missionLogCutover";
import {
  getTimeReportingCutoverState,
  shouldMirrorTimeReportingCheckout,
} from "@/lib/data/timeReportingCutover";
import {
  getTimeReportingParityState,
  type SanitizedParityMismatch,
} from "@/lib/data/timeReportingParityState";
import {
  getServiceCutoverState,
  shouldReadServicesFromSupabase,
  shouldMirrorServiceWrites,
  type ServiceCutoverState,
} from "@/lib/data/serviceCutover";
import {
  getServiceDualWriteState,
  type ServiceDualWriteState,
} from "@/lib/data/serviceDualWrite";
import {
  getServiceCategoryCutoverState,
  shouldReadServiceCategoriesFromSupabase,
  shouldMirrorServiceCategoryWrites,
  type ServiceCategoryCutoverState,
} from "@/lib/data/serviceCategoryCutover";
import {
  getServiceCategoryDualWriteState,
  type ServiceCategoryDualWriteState,
} from "@/lib/data/serviceCategoryDualWrite";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { isSupabaseAuthEnabled } from "@/lib/authSupabase";
import { loadCompanyUuidMap } from "@/lib/data/customerMigration";

/** Badge tones reused across every status field. */
type Tone = "green" | "blue" | "amber" | "red" | "muted";

const TONE_CLS: Record<Tone, string> = {
  green: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  blue: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  red: "bg-red-500/10 text-red-600 dark:text-red-400",
  muted: "bg-muted text-muted-foreground",
};

/** Maps any status string to a tone, defaulting to muted for not-started/n-a. */
const TONE_FOR: Record<string, Tone> = {
  // strong / done
  complete: "green",
  ready: "green",
  production_ready: "green",
  active: "green",
  verified: "green",
  removed: "green",
  removed_from_write_path: "green",
  built: "green",
  activated: "green",
  // built + verified, just waiting on a flag flip
  awaiting_activation: "blue",
  // in progress / partial
  partial: "amber",
  in_progress: "amber",
  in_review: "amber",
  dual_write: "amber",
  // planned / neutral
  planned: "blue",
  // problem
  blocked: "red",
  authoritative: "amber",
  // off / n-a
  not_started: "muted",
  not_applicable: "muted",
  not_ready: "muted",
  deprecated: "muted",
};

const HEALTH_BAND_CLS: Record<HealthBand, string> = {
  production: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  solid: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  developing: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  critical: "bg-red-500/10 text-red-600 dark:text-red-400",
};

/** Compact health pill: weighted 0–100 completeness score with band colour. */
function HealthBadge({ module }: { module: DevelopmentModule }) {
  const { score, band } = computeModuleHealth(module);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-semibold tabular-nums",
        HEALTH_BAND_CLS[band],
      )}
      title={`Health ${score}/100 · ${humanize(band)}`}
    >
      {score}
    </span>
  );
}

/** Turns a snake_case status into a readable label. */
function humanize(value: string): string {
  return value
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function StatusBadge({ value }: { value: string }) {
  const tone = TONE_FOR[value] ?? "muted";
  return (
    <span
      className={cn(
        "inline-flex whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-medium",
        TONE_CLS[tone],
      )}
    >
      {humanize(value)}
    </span>
  );
}

const ALL = "all";

function SummaryCard({
  icon: Icon,
  label,
  value,
  active,
  onClick,
}: {
  icon: typeof Boxes;
  label: string;
  value: number;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-2xl border bg-card p-4 text-left transition-colors",
        active ? "border-primary ring-1 ring-primary" : "border-border hover:bg-muted/40",
      )}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xl font-semibold tabular-nums leading-none">{value}</p>
        <p className="mt-1 truncate text-xs text-muted-foreground">{label}</p>
      </div>
    </button>
  );
}

/** A labelled value row inside the detail panel. */
function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className="text-right">{children}</div>
    </div>
  );
}

type QuickFilter =
  | "none"
  | "production_ready"
  | "supabase_complete"
  | "missing_activity_log"
  | "planned"
  | "api_planned"
  | "ai_planned"
  | "blocked";

/**
 * Development Center (v1) — Super Admin–only internal architecture registry.
 *
 * Read-only overview of every CleanOps module: lifecycle status, Supabase vs
 * localStorage backing, RLS, permissions, activity logging, entitlements, API /
 * AI readiness and dependencies. Reads from {@link getDevelopmentModules} so the
 * backing source can move to Supabase later without touching this UI.
 */
export default function DevelopmentCenter() {
  const { currentUser } = useApp();
  const modules = useMemo<DevelopmentModule[]>(() => getDevelopmentModules(), []);

  const [query, setQuery] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [supabaseFilter, setSupabaseFilter] = useState<string>(ALL);
  const [activityFilter, setActivityFilter] = useState<string>(ALL);
  const [apiFilter, setApiFilter] = useState<string>(ALL);
  const [aiFilter, setAiFilter] = useState<string>(ALL);
  const [quick, setQuick] = useState<QuickFilter>("none");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const summary = useMemo(() => {
    return {
      total: modules.length,
      productionReady: modules.filter((m) => m.status === "production_ready").length,
      supabaseComplete: modules.filter((m) => m.supabaseStatus === "complete").length,
      missingActivityLog: modules.filter(
        (m) => m.activityLogStatus === "not_started" || m.activityLogStatus === "planned",
      ).length,
      planned: modules.filter((m) => isPlannedModule(m)).length,
      apiPlanned: modules.filter((m) => m.apiStatus === "planned").length,
      aiPlanned: modules.filter((m) => m.aiStatus === "planned").length,
      blocked: modules.filter((m) => m.status === "blocked").length,
    };
  }, [modules]);

  const avgHealth = useMemo<number>(() => {
    if (modules.length === 0) return 0;
    const sum = modules.reduce((acc, m) => acc + computeModuleHealth(m).score, 0);
    return Math.round(sum / modules.length);
  }, [modules]);

  const filtered = useMemo<DevelopmentModule[]>(() => {
    const q = query.trim().toLowerCase();
    return modules.filter((m) => {
      if (statusFilter !== ALL && m.status !== statusFilter) return false;
      if (supabaseFilter !== ALL && m.supabaseStatus !== supabaseFilter) return false;
      if (activityFilter !== ALL && m.activityLogStatus !== activityFilter) return false;
      if (apiFilter !== ALL && m.apiStatus !== apiFilter) return false;
      if (aiFilter !== ALL && m.aiStatus !== aiFilter) return false;

      if (quick === "production_ready" && m.status !== "production_ready") return false;
      if (quick === "supabase_complete" && m.supabaseStatus !== "complete") return false;
      if (
        quick === "missing_activity_log" &&
        !(m.activityLogStatus === "not_started" || m.activityLogStatus === "planned")
      )
        return false;
      if (quick === "planned" && !isPlannedModule(m)) return false;
      if (quick === "api_planned" && m.apiStatus !== "planned") return false;
      if (quick === "ai_planned" && m.aiStatus !== "planned") return false;
      if (quick === "blocked" && m.status !== "blocked") return false;

      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        m.key.toLowerCase().includes(q) ||
        m.category.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        m.ownerArea.toLowerCase().includes(q)
      );
    });
  }, [modules, query, statusFilter, supabaseFilter, activityFilter, apiFilter, aiFilter, quick]);

  const selected = useMemo<DevelopmentModule | null>(
    () => modules.find((m) => m.key === selectedKey) ?? null,
    [modules, selectedKey],
  );

  if (currentUser?.role !== "super_admin") return <AccessDenied />;

  const toggleQuick = (next: QuickFilter) =>
    setQuick((prev) => (prev === next ? "none" : next));

  const statusOptions: ModuleStatus[] = [
    "planned",
    "in_progress",
    "partial",
    "active",
    "production_ready",
    "deprecated",
    "blocked",
  ];
  const supabaseOptions: SupabaseStatus[] = ["not_started", "partial", "complete", "not_applicable"];
  const activityOptions: ActivityLogStatus[] = [
    "not_started",
    "planned",
    "partial",
    "complete",
    "not_applicable",
  ];
  const apiOptions: ApiStatus[] = ["not_started", "planned", "partial", "ready", "not_applicable"];
  const aiOptions: AiStatus[] = ["not_started", "planned", "partial", "ready", "not_applicable"];

  return (
    <DashboardLayout wide>
      <PageHeader
        title="Development Center"
        description="Internal Super Admin registry of CleanOps modules — readiness, backing store, RLS, activity logging, entitlements and dependencies. Read-only source of truth for architecture and migration status."
      />

      {/* Summary cards (also act as quick filters) */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <SummaryCard icon={Boxes} label="Total modules" value={summary.total} active={quick === "none"} onClick={() => setQuick("none")} />
        <SummaryCard icon={Activity} label={`Avg health · ${avgHealth}`} value={avgHealth} active={false} />
        <SummaryCard icon={CheckCircle2} label="Production ready" value={summary.productionReady} active={quick === "production_ready"} onClick={() => toggleQuick("production_ready")} />
        <SummaryCard icon={Database} label="Supabase complete" value={summary.supabaseComplete} active={quick === "supabase_complete"} onClick={() => toggleQuick("supabase_complete")} />
        <SummaryCard icon={ScrollText} label="Missing activity log" value={summary.missingActivityLog} active={quick === "missing_activity_log"} onClick={() => toggleQuick("missing_activity_log")} />
        <SummaryCard icon={MapIcon} label="Planned / roadmap" value={summary.planned} active={quick === "planned"} onClick={() => toggleQuick("planned")} />
        <SummaryCard icon={Plug} label="API planned" value={summary.apiPlanned} active={quick === "api_planned"} onClick={() => toggleQuick("api_planned")} />
        <SummaryCard icon={Cpu} label="AI planned" value={summary.aiPlanned} active={quick === "ai_planned"} onClick={() => toggleQuick("ai_planned")} />
        <SummaryCard icon={AlertOctagon} label="Blocked" value={summary.blocked} active={quick === "blocked"} onClick={() => toggleQuick("blocked")} />
      </div>

      {/* Filters */}
      <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center">
        <div className="relative w-full lg:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search modules…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <FilterSelect label="Status" value={statusFilter} onChange={setStatusFilter} options={statusOptions} />
          <FilterSelect label="Supabase" value={supabaseFilter} onChange={setSupabaseFilter} options={supabaseOptions} />
          <FilterSelect label="Activity log" value={activityFilter} onChange={setActivityFilter} options={activityOptions} />
          <FilterSelect label="API" value={apiFilter} onChange={setApiFilter} options={apiOptions} />
          <FilterSelect label="AI" value={aiFilter} onChange={setAiFilter} options={aiOptions} />
        </div>
      </div>

      {/* Table */}
      <div className="mt-5 overflow-hidden rounded-2xl border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Module</th>
                <th className="px-4 py-3 font-medium">Health</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Supabase</th>
                <th className="px-4 py-3 font-medium">RLS</th>
                <th className="px-4 py-3 font-medium">Activity log</th>
                <th className="px-4 py-3 font-medium">Entitlement</th>
                <th className="px-4 py-3 font-medium">API</th>
                <th className="px-4 py-3 font-medium">AI</th>
                <th className="px-4 py-3 font-medium">Readiness</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((m) => (
                <tr
                  key={m.key}
                  onClick={() => setSelectedKey(m.key)}
                  className="cursor-pointer align-top transition-colors hover:bg-muted/40"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 font-medium">
                      {m.name}
                      {isPlannedModule(m) ? (
                        <span className="rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-600 dark:text-sky-400">
                          {m.targetRelease ?? "roadmap"}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className="rounded bg-muted px-1.5 py-0.5">{m.category}</span>
                      <span className="font-mono">{m.key}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3"><HealthBadge module={m} /></td>
                  <td className="px-4 py-3"><StatusBadge value={m.status} /></td>
                  <td className="px-4 py-3"><StatusBadge value={m.supabaseStatus} /></td>
                  <td className="px-4 py-3"><StatusBadge value={m.rlsStatus} /></td>
                  <td className="px-4 py-3"><StatusBadge value={m.activityLogStatus} /></td>
                  <td className="px-4 py-3"><StatusBadge value={m.entitlementStatus} /></td>
                  <td className="px-4 py-3"><StatusBadge value={m.apiStatus} /></td>
                  <td className="px-4 py-3"><StatusBadge value={m.aiStatus} /></td>
                  <td className="px-4 py-3"><StatusBadge value={m.releaseReadiness} /></td>
                </tr>
              ))}
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-sm text-muted-foreground">
                    No modules match the current filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Showing {filtered.length} of {modules.length} modules. Click a row for full readiness and dependencies.
      </p>

      {/* Paused workstreams (read-only handoff state) */}
      <PausedWorkstreams />

      {/* Mission Log dual-write diagnostics (read-only) */}
      <MissionLogDiagnostics />

      {/* Time Reporting parity diagnostics (read-only) */}
      <TimeReportingParityDiagnostics />

      {/* Service Catalog diagnostics (read-only) */}
      <ServiceCatalogDiagnostics />

      {/* Governance system timeline */}
      <SystemTimeline />

      {/* Detail panel */}
      <Sheet open={selected !== null} onOpenChange={(open) => !open && setSelectedKey(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
          {selected ? (
            <>
              <SheetHeader className="text-left">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  <SheetTitle>{selected.name}</SheetTitle>
                </div>
                <SheetDescription>{selected.description}</SheetDescription>
              </SheetHeader>

              <div className="mt-4 flex flex-wrap items-center gap-1.5">
                <span className="rounded bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                  {selected.category}
                </span>
                <span className="rounded bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
                  {selected.key}
                </span>
                <StatusBadge value={selected.status} />
              </div>

              <div className="mt-5">
                <SectionLabel icon={ShieldCheck}>Readiness</SectionLabel>
                <div className="divide-y divide-border">
                  <DetailRow label="Health score">
                    <div className="flex items-center justify-end gap-2">
                      <HealthBadge module={selected} />
                      <span className="text-xs text-muted-foreground">
                        {computeModuleHealth(selected).score}/100 across {computeModuleHealth(selected).dimensions} dimensions
                      </span>
                    </div>
                  </DetailRow>
                  {selected.targetRelease ? (
                    <DetailRow label="Target release"><span className="text-sm">{selected.targetRelease}</span></DetailRow>
                  ) : null}
                  <DetailRow label="Owner area"><span className="text-sm">{selected.ownerArea}</span></DetailRow>
                  <DetailRow label="Status"><StatusBadge value={selected.status} /></DetailRow>
                  <DetailRow label="Supabase"><StatusBadge value={selected.supabaseStatus} /></DetailRow>
                  <DetailRow label="localStorage"><StatusBadge value={selected.localStorageStatus} /></DetailRow>
                  <DetailRow label="RLS"><StatusBadge value={selected.rlsStatus} /></DetailRow>
                  <DetailRow label="Permissions"><StatusBadge value={selected.permissionStatus} /></DetailRow>
                  <DetailRow label="Activity log"><StatusBadge value={selected.activityLogStatus} /></DetailRow>
                  <DetailRow label="Entitlement"><StatusBadge value={selected.entitlementStatus} /></DetailRow>
                  <DetailRow label="API"><StatusBadge value={selected.apiStatus} /></DetailRow>
                  <DetailRow label="AI"><StatusBadge value={selected.aiStatus} /></DetailRow>
                  <DetailRow label="Language"><StatusBadge value={selected.languageStatus} /></DetailRow>
                  <DetailRow label="Tests"><StatusBadge value={selected.testStatus} /></DetailRow>
                  <DetailRow label="Release readiness"><StatusBadge value={selected.releaseReadiness} /></DetailRow>
                  {selected.migrationStatus ? (
                    <DetailRow label="Migration"><StatusBadge value={selected.migrationStatus} /></DetailRow>
                  ) : null}
                </div>
              </div>

              <div className="mt-5">
                <SectionLabel icon={GitBranch}>Dependencies</SectionLabel>
                {selected.dependencies.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No dependencies.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {selected.dependencies.map((dep) => (
                      <button
                        key={dep}
                        type="button"
                        onClick={() => setSelectedKey(dep)}
                        className="rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted"
                      >
                        {moduleNameForKey(dep)}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-5">
                <SectionLabel icon={ListChecks}>Related features</SectionLabel>
                {selected.relatedFeatures.length === 0 ? (
                  <p className="text-sm text-muted-foreground">None listed.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {selected.relatedFeatures.map((f) => (
                      <span key={f} className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {f}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-5">
                <SectionLabel icon={ScrollText}>Notes</SectionLabel>
                <p className="text-sm text-muted-foreground">{selected.notes}</p>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </DashboardLayout>
  );
}

/** Small coloured bullet per tone, used in the paused-workstream lists. */
const WORKSTREAM_DOT: Record<Tone, string> = {
  green: "bg-emerald-500",
  blue: "bg-sky-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
  muted: "bg-muted-foreground",
};

/** A labelled bullet list inside a paused-workstream card. Hidden when empty. */
function WorkstreamList({
  icon: Icon,
  label,
  items,
  tone,
}: {
  icon: typeof Boxes;
  label: string;
  items: string[];
  tone: Tone;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
      </div>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item} className="flex gap-1.5 text-xs text-muted-foreground">
            <span className={cn("mt-1.5 h-1 w-1 shrink-0 rounded-full", WORKSTREAM_DOT[tone])} />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Read-only "Paused Workstreams" panel. Surfaces the intentionally-frozen
 * tracks (latest safe checkpoint, blockers, resume steps and the rules for what
 * must NOT resume automatically) directly in Development Center, so the handoff
 * state is discoverable in-app and not only in the markdown docs.
 *
 * Purely observational — it only READS {@link getPausedWorkstreams}. It changes
 * no runtime behaviour and authorises no work.
 */
function PausedWorkstreams() {
  const workstreams = useMemo<PausedWorkstream[]>(() => getPausedWorkstreams(), []);

  return (
    <section className="mt-10">
      <div className="mb-1 flex items-center gap-2">
        <PauseCircle className="h-4 w-4 text-amber-500" />
        <h2 className="text-sm font-semibold">Paused Workstreams</h2>
        <span className="rounded-md bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-amber-600 dark:text-amber-400">
          {workstreams.length}
        </span>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Frozen tracks &amp; handoff state — latest safe checkpoint, blockers and how to resume. Read-only; nothing here authorises resuming work.
      </p>

      <div className="grid gap-4 lg:grid-cols-3">
        {workstreams.map((w) => (
          <article
            key={w.key}
            className="flex flex-col overflow-hidden rounded-2xl border border-amber-500/30 bg-card"
          >
            <div className="border-b border-border bg-amber-500/5 px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-semibold leading-tight">{w.name}</h3>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{w.area}</p>
                </div>
                <span className="shrink-0 rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                  {w.stateLabel}
                </span>
              </div>
              {w.requiresExplicitInstruction ? (
                <div className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                  <Lock className="h-3 w-3 shrink-0" />
                  <span>Requires explicit instruction · do not resume automatically</span>
                </div>
              ) : null}
            </div>

            <div className="flex flex-1 flex-col gap-3 px-4 py-3">
              <div className="rounded-lg bg-muted/40 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Latest safe checkpoint
                </p>
                <p className="mt-0.5 text-xs">{w.checkpoint}</p>
              </div>
              <p className="text-xs text-muted-foreground">{w.status}</p>

              <WorkstreamList icon={CheckCircle2} label="Latest completed" items={w.latestCompleted} tone="green" />
              <WorkstreamList icon={AlertTriangle} label="Blockers / deferred" items={w.blockers} tone="amber" />
              {w.filesChanged.length > 0 ? (
                <div>
                  <div className="mb-1.5 flex items-center gap-1.5">
                    <ScrollText className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Files changed (latest slice)
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {w.filesChanged.map((f) => (
                      <span
                        key={f}
                        className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                      >
                        {f}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              <WorkstreamList icon={PlayCircle} label="When resumed" items={w.resumeSteps} tone="blue" />
              <WorkstreamList icon={Ban} label="Do not resume automatically" items={w.doNotResume} tone="red" />
            </div>

            {w.referenceDoc ? (
              <div className="mt-auto flex items-center gap-1.5 border-t border-border px-4 py-2.5 text-[11px] text-muted-foreground">
                <FileText className="h-3 w-3 shrink-0" />
                <span className="break-all font-mono">{w.referenceDoc}</span>
              </div>
            ) : null}
          </article>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Read-only handoff record. Full detail · resume checklist lives in the reference doc per card. Mirrors docs/dev-center/10-paused-workstreams-and-handoff-status.md.
      </p>
    </section>
  );
}

/** Category tabs for the governance timeline (maps to TimelineCategory + "all"). */
const TIMELINE_TABS: ReadonlyArray<{ value: TimelineCategory | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "status", label: "Status" },
  { value: "migration", label: "Migration" },
  { value: "audit", label: "Audit" },
  { value: "activation", label: "Activation" },
  { value: "governance", label: "Governance" },
];

/** Tone per timeline category, reusing the shared badge palette. */
const TIMELINE_CATEGORY_TONE: Record<TimelineCategory, Tone> = {
  status: "blue",
  migration: "amber",
  audit: "green",
  activation: "red",
  governance: "muted",
};

/** Formats an ISO date as a compact, locale-stable YYYY-MM-DD. */
function formatTimelineDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}

/**
 * Read-only governance history at the bottom of Development Center. Shows the
 * latest {@link TIMELINE_DEFAULT_LIMIT} events newest-first with category
 * filter tabs. Purely observational — it never mutates registry state.
 */
function SystemTimeline() {
  const [tab, setTab] = useState<TimelineCategory | "all">("all");
  const entries = useMemo<TimelineEntry[]>(
    () => getTimelineEntries(tab, TIMELINE_DEFAULT_LIMIT),
    [tab],
  );

  return (
    <section className="mt-10">
      <div className="mb-3 flex items-center gap-2">
        <History className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">System Timeline</h2>
        <span className="text-xs text-muted-foreground">
          Governance history — architecture, migration, audit &amp; readiness changes
        </span>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {TIMELINE_TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setTab(t.value)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              tab === t.value
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-muted/40",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Module</th>
                <th className="px-4 py-3 font-medium">Event</th>
                <th className="px-4 py-3 font-medium">From</th>
                <th className="px-4 py-3 font-medium">To</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Evidence / Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {entries.map((e) => (
                <tr key={e.id} className="align-top">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-muted-foreground tabular-nums">
                    {formatTimelineDate(e.date)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-medium">{e.module}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <span>{e.eventType}</span>
                      <span
                        className={cn(
                          "w-fit rounded-md px-1.5 py-0.5 text-[10px] font-medium",
                          TONE_CLS[TIMELINE_CATEGORY_TONE[e.category]],
                        )}
                      >
                        {humanize(e.category)}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {e.from ? <StatusBadge value={e.from} /> : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    {e.to ? <StatusBadge value={e.to} /> : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    {e.status ? <StatusBadge value={e.status} /> : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{e.note ?? "—"}</td>
                </tr>
              ))}
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-sm text-muted-foreground">
                    No timeline events in this category.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Showing {entries.length} most recent event{entries.length === 1 ? "" : "s"} (max {TIMELINE_DEFAULT_LIMIT}), newest first. Read-only governance history.
      </p>
    </section>
  );
}

/** One severity / domain counter pill used in the parity telemetry grid. */
function SeverityPill({ label, value, tone }: { label: string; value: number; tone: Tone }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl border border-border bg-card px-3 py-3">
      <span
        className={cn(
          "rounded-md px-2 py-0.5 text-sm font-semibold tabular-nums",
          value > 0 ? TONE_CLS[tone] : "bg-muted text-muted-foreground",
        )}
      >
        {value}
      </span>
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
    </div>
  );
}

/** Tone for a parity mismatch severity in the recent-mismatch ring. */
const PARITY_SEVERITY_TONE: Record<string, Tone> = {
  blocking: "red",
  warning: "amber",
  info: "blue",
};

/**
 * Read-only Time Reporting parity (shadow-validation) diagnostics. Surfaces the
 * EFFECTIVE, build-time-baked Time Reporting flag values plus the live in-memory
 * parity telemetry ({@link getTimeReportingParityState}) and checkout dual-write
 * telemetry ({@link getTimeReportingCutoverState}) so the deployed dev/demo
 * build's shadow-validation state is observable without DevTools.
 *
 * Purely observational — no toggles, no mutation, no writes, no test execution.
 * When TIME_REPORTING_SHADOW_VALIDATE is OFF the parity runner never runs, so
 * the panel reads its dormant empty state.
 */
function TimeReportingParityDiagnostics() {
  const flags = useMemo(
    () => [
      { key: "EXPO_PUBLIC_TIME_REPORTING_DUAL_WRITE", value: TIME_REPORTING_DUAL_WRITE },
      { key: "EXPO_PUBLIC_TIME_REPORTING_SHADOW_VALIDATE", value: TIME_REPORTING_SHADOW_VALIDATE },
      { key: "EXPO_PUBLIC_TIME_REPORTING_SUPABASE_READ", value: TIME_REPORTING_SUPABASE_READ },
      {
        key: "EXPO_PUBLIC_TIME_REPORTING_SUPABASE_AUTHORITATIVE",
        value: TIME_REPORTING_SUPABASE_AUTHORITATIVE,
      },
    ],
    [],
  );
  const dualWriteActive = useMemo(() => shouldMirrorTimeReportingCheckout(), []);
  const parity = useMemo(() => getTimeReportingParityState(), []);
  const cutover = useMemo(() => getTimeReportingCutoverState(), []);
  const hasRuns = parity.totalChecked > 0 || parity.fetchFailures > 0;

  const domainCounters = useMemo(
    () => [
      { label: "Allocation", value: parity.allocationMismatches },
      { label: "Status", value: parity.statusMismatches },
      { label: "Flag", value: parity.flagMismatches },
      { label: "Event", value: parity.eventMismatches },
      { label: "Message", value: parity.messageMismatches },
      { label: "Mission link", value: parity.missionLinkMismatches },
    ],
    [parity],
  );

  return (
    <section className="mt-10">
      <div className="mb-3 flex items-center gap-2">
        <Radio className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Time Reporting Parity Diagnostics</h2>
        <span className="text-xs text-muted-foreground">
          Effective build-time flag values &amp; live shadow-validation telemetry — read-only
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Effective flag values */}
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="border-b border-border bg-muted/40 px-4 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Effective flags (baked into this build)
              </span>
              <div className="flex shrink-0 items-center gap-1.5">
                <span
                  className={cn(
                    "rounded-md px-2 py-0.5 text-[11px] font-semibold",
                    dualWriteActive
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                  )}
                >
                  Dual-write {dualWriteActive ? "ACTIVE" : "INACTIVE"}
                </span>
                <span
                  className={cn(
                    "rounded-md px-2 py-0.5 text-[11px] font-semibold",
                    parity.enabled
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                  )}
                >
                  Shadow {parity.enabled ? "ACTIVE" : "INACTIVE"}
                </span>
              </div>
            </div>
          </div>
          <div className="divide-y divide-border px-4">
            {flags.map((f) => (
              <div key={f.key} className="flex items-center justify-between gap-3 py-2.5">
                <span className="break-all font-mono text-[11px] text-muted-foreground">{f.key}</span>
                <span
                  className={cn(
                    "shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold tabular-nums",
                    f.value
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {f.value ? "true" : "false"}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Live parity run summary */}
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="border-b border-border bg-muted/40 px-4 py-2.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Parity runs (this session)
            </span>
          </div>
          <div className="divide-y divide-border px-4">
            <DetailRow label="Shadow validation">
              <StatusBadge value={parity.enabled ? "active" : "not_started"} />
            </DetailRow>
            <DetailRow label="Total checked"><span className="text-sm tabular-nums">{parity.totalChecked}</span></DetailRow>
            <DetailRow label="Matched"><span className="text-sm tabular-nums">{parity.matched}</span></DetailRow>
            <DetailRow label="Mismatched"><span className="text-sm tabular-nums">{parity.mismatched}</span></DetailRow>
            <DetailRow label="Missing in Supabase"><span className="text-sm tabular-nums">{parity.missingInSupabase}</span></DetailRow>
            <DetailRow label="Missing in legacy"><span className="text-sm tabular-nums">{parity.missingInLegacy}</span></DetailRow>
            <DetailRow label="Fetch failures"><span className="text-sm tabular-nums">{parity.fetchFailures}</span></DetailRow>
            <DetailRow label="Last validation">
              <span className="text-xs text-muted-foreground">{parity.lastValidationAt ?? "—"}</span>
            </DetailRow>
            <DetailRow label="Last error">
              <span className="text-xs text-muted-foreground">{parity.lastError ?? "—"}</span>
            </DetailRow>
          </div>
        </div>
      </div>

      {/* Severity counters */}
      <div className="mt-4 grid grid-cols-3 gap-3">
        <SeverityPill label="Blocking" value={parity.blocking} tone="red" />
        <SeverityPill label="Warning" value={parity.warning} tone="amber" />
        <SeverityPill label="Info" value={parity.info} tone="blue" />
      </div>
      {/* Per-domain counters */}
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {domainCounters.map((d) => (
          <SeverityPill key={d.label} label={d.label} value={d.value} tone="blue" />
        ))}
      </div>

      {/* Checkout dual-write telemetry */}
      <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
        <div className="border-b border-border bg-muted/40 px-4 py-2.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Checkout dual-write telemetry (this session)
          </span>
        </div>
        <div className="grid gap-x-6 px-4 sm:grid-cols-2">
          <DetailRow label="Mirror enabled">
            <StatusBadge value={cutover.supabaseWrite ? "active" : "not_started"} />
          </DetailRow>
          <DetailRow label="Attempted"><span className="text-sm tabular-nums">{cutover.attempted}</span></DetailRow>
          <DetailRow label="Succeeded"><span className="text-sm tabular-nums">{cutover.succeeded}</span></DetailRow>
          <DetailRow label="Failed"><span className="text-sm tabular-nums">{cutover.failed}</span></DetailRow>
          <DetailRow label="Skipped (no company map)">
            <span className="text-sm tabular-nums">{cutover.skippedMissingCompany}</span>
          </DetailRow>
          <DetailRow label="Last run">
            <span className="text-xs text-muted-foreground">{cutover.lastRunAt ?? "—"}</span>
          </DetailRow>
        </div>
      </div>

      {/* Sanitized recent mismatch ring */}
      <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
        <div className="border-b border-border bg-muted/40 px-4 py-2.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Recent mismatches (sanitized · newest first · max 50)
          </span>
        </div>
        {parity.recentMismatches.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            {hasRuns
              ? "No mismatches recorded — all compared reports matched."
              : "No parity runs yet. Shadow validation is disabled, so the parity runner has not executed."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">When</th>
                  <th className="px-4 py-2.5 font-medium">Severity</th>
                  <th className="px-4 py-2.5 font-medium">Domain</th>
                  <th className="px-4 py-2.5 font-medium">Type</th>
                  <th className="px-4 py-2.5 font-medium">Table</th>
                  <th className="px-4 py-2.5 font-medium">Field</th>
                  <th className="px-4 py-2.5 font-medium">Source id</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {parity.recentMismatches.map((m: SanitizedParityMismatch, i) => (
                  <tr key={`${m.type}-${m.sourceLegacyId}-${m.at}-${i}`} className="align-top">
                    <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-muted-foreground tabular-nums">
                      {formatTimelineDate(m.at)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={cn(
                          "rounded-md px-1.5 py-0.5 text-[10px] font-medium",
                          TONE_CLS[PARITY_SEVERITY_TONE[m.severity] ?? "muted"],
                        )}
                      >
                        {humanize(m.severity)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs">{humanize(m.domain)}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{m.type}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{m.table}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{m.field ?? "—"}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{m.sourceLegacyId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        Telemetry is in-memory and resets on reload. Parity runs only when
        <span className="font-mono"> EXPO_PUBLIC_TIME_REPORTING_SHADOW_VALIDATE=true</span>; mismatch values are sanitized (PII / free-text shown as <span className="font-mono">[redacted]</span>). Read-only — no toggles, no writes, no test execution.
      </p>
    </section>
  );
}

/** A small ACTIVE/INACTIVE pill reused across the service-catalog diagnostics. */
function ModePill({ label, active }: { label: string; active: boolean }) {
  return (
    <span
      className={cn(
        "rounded-md px-2 py-0.5 text-[11px] font-semibold",
        active
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
      )}
    >
      {label} {active ? "ACTIVE" : "INACTIVE"}
    </span>
  );
}

/** Shape shared by the category & service cutover telemetry snapshots. */
type CatalogCutoverLike = ServiceCutoverState | ServiceCategoryCutoverState;
/** Shape shared by the category & service dual-write telemetry snapshots. */
type CatalogDualWriteLike = ServiceDualWriteState | ServiceCategoryDualWriteState;

/**
 * One read-only telemetry card for a single service-catalog domain (categories
 * or service definitions). Surfaces the EFFECTIVE flag triple, the resolved
 * read/write modes, the read-path cutover counters (reads / fallbacks /
 * unsafe-empty / drift) and the dual-write mirror counters (mirrored / skipped
 * missing-company / failures / lastError), plus a clear empty state.
 *
 * Purely observational — it only READS already-exported telemetry snapshots.
 */
function ServiceCatalogDomainCard({
  title,
  flagPrefix,
  readFlag,
  dualWriteFlag,
  authoritativeFlag,
  readActive,
  writeActive,
  cutover,
  dualWrite,
}: {
  title: string;
  flagPrefix: string;
  readFlag: boolean;
  dualWriteFlag: boolean;
  authoritativeFlag: boolean;
  readActive: boolean;
  writeActive: boolean;
  cutover: CatalogCutoverLike;
  dualWrite: CatalogDualWriteLike;
}) {
  const flags = [
    { key: `EXPO_PUBLIC_${flagPrefix}_SUPABASE_READ`, value: readFlag },
    { key: `EXPO_PUBLIC_${flagPrefix}_DUAL_WRITE`, value: dualWriteFlag },
    { key: `EXPO_PUBLIC_${flagPrefix}_SUPABASE_AUTHORITATIVE`, value: authoritativeFlag },
  ];
  const mirrored = dualWrite.created + dualWrite.updated;
  const hasReadActivity =
    cutover.supabaseReads > 0 || cutover.localReads > 0 || cutover.failures > 0;
  const hasWriteActivity = dualWrite.runs > 0;

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="border-b border-border bg-muted/40 px-4 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {title}
          </span>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            <ModePill label="Read" active={readActive} />
            <ModePill label="Mirror" active={writeActive} />
          </div>
        </div>
      </div>

      {/* Effective flag triple */}
      <div className="divide-y divide-border px-4">
        {flags.map((f) => (
          <div key={f.key} className="flex items-center justify-between gap-3 py-2.5">
            <span className="break-all font-mono text-[11px] text-muted-foreground">{f.key}</span>
            <span
              className={cn(
                "shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold tabular-nums",
                f.value
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {f.value ? "true" : "false"}
            </span>
          </div>
        ))}
      </div>

      {/* Read-path cutover counters */}
      <div className="border-t border-border bg-muted/20 px-4 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Read path (this session)
        </span>
      </div>
      <div className="grid gap-x-6 px-4 sm:grid-cols-2">
        <DetailRow label="Read source">
          <StatusBadge value={cutover.readSource === "supabase" ? "active" : "not_started"} />
        </DetailRow>
        <DetailRow label="Supabase reads"><span className="text-sm tabular-nums">{cutover.supabaseReads}</span></DetailRow>
        <DetailRow label="Local reads"><span className="text-sm tabular-nums">{cutover.localReads}</span></DetailRow>
        <DetailRow label="Fallbacks"><span className="text-sm tabular-nums">{cutover.fallbacks}</span></DetailRow>
        <DetailRow label="Unsafe-empty reads"><span className="text-sm tabular-nums">{cutover.unsafeEmptyReads}</span></DetailRow>
        <DetailRow label="Read failures"><span className="text-sm tabular-nums">{cutover.failures}</span></DetailRow>
        <DetailRow label="Shadow drift"><span className="text-sm tabular-nums">{cutover.shadowDrift}</span></DetailRow>
        <DetailRow label="Last read event">
          <span className="text-xs text-muted-foreground">{cutover.lastEventAt ?? "—"}</span>
        </DetailRow>
        <DetailRow label="Last mismatch">
          <span className="break-all text-xs text-muted-foreground">{cutover.lastMismatch ?? "—"}</span>
        </DetailRow>
      </div>
      {!hasReadActivity ? (
        <p className="px-4 pb-3 text-[11px] text-muted-foreground">
          No read activity recorded this session{readActive ? "." : " — read path inactive (flag off)."}
        </p>
      ) : null}

      {/* Dual-write mirror counters */}
      <div className="border-t border-border bg-muted/20 px-4 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Dual-write mirror (this session)
        </span>
      </div>
      <div className="grid gap-x-6 px-4 sm:grid-cols-2">
        <DetailRow label="Mirror runs"><span className="text-sm tabular-nums">{dualWrite.runs}</span></DetailRow>
        <DetailRow label="No-ops"><span className="text-sm tabular-nums">{dualWrite.noops}</span></DetailRow>
        <DetailRow label="Mirrored (created+updated)"><span className="text-sm tabular-nums">{mirrored}</span></DetailRow>
        <DetailRow label="Created"><span className="text-sm tabular-nums">{dualWrite.created}</span></DetailRow>
        <DetailRow label="Updated"><span className="text-sm tabular-nums">{dualWrite.updated}</span></DetailRow>
        <DetailRow label="Removed (soft-delete)"><span className="text-sm tabular-nums">{dualWrite.removed}</span></DetailRow>
        <DetailRow label="Skipped (no company map)">
          <span
            className={cn(
              "rounded-md px-2 py-0.5 text-sm font-semibold tabular-nums",
              dualWrite.skipped > 0 ? TONE_CLS.amber : "text-muted-foreground",
            )}
          >
            {dualWrite.skipped}
          </span>
        </DetailRow>
        <DetailRow label="Validations"><span className="text-sm tabular-nums">{dualWrite.validations}</span></DetailRow>
        <DetailRow label="Write mismatches">
          <span
            className={cn(
              "rounded-md px-2 py-0.5 text-sm font-semibold tabular-nums",
              dualWrite.mismatches > 0 ? TONE_CLS.red : "text-muted-foreground",
            )}
          >
            {dualWrite.mismatches}
          </span>
        </DetailRow>
        <DetailRow label="Write failures">
          <span
            className={cn(
              "rounded-md px-2 py-0.5 text-sm font-semibold tabular-nums",
              dualWrite.failures > 0 ? TONE_CLS.red : "text-muted-foreground",
            )}
          >
            {dualWrite.failures}
          </span>
        </DetailRow>
        <DetailRow label="Last mirror run">
          <span className="text-xs text-muted-foreground">{dualWrite.lastRunAt ?? "—"}</span>
        </DetailRow>
        <DetailRow label="Last write error">
          <span className="break-all text-xs text-muted-foreground">{dualWrite.lastError ?? "—"}</span>
        </DetailRow>
      </div>
      {!hasWriteActivity ? (
        <p className="px-4 pb-3 text-[11px] text-muted-foreground">
          No mirror runs recorded this session{writeActive ? "." : " — mirror inactive (flag off)."}
        </p>
      ) : null}
    </div>
  );
}

type IdentityStatus =
  | "loading"
  | "not_signed_in"
  | "not_queryable"
  | "ok"
  | "ok_super_admin"
  | "missing_company_on_user"
  | "missing_company_mapping"
  | "missing_profile_company_id"
  | "profile_company_mismatch";

type CompanyIdentityState = {
  status: IdentityStatus;
  authUid: string | null;
  authEmail: string | null;
  rlsCompanyId: string | null;
  rlsIsSuperAdmin: boolean | null;
  resolvedCompanyUuid: string | null;
  legacyExistsInCompanies: boolean | null;
  error: string | null;
};

const IDENTITY_STATUS_LABEL: Record<IdentityStatus, string> = {
  loading: "checking…",
  not_signed_in: "not signed in",
  not_queryable: "unknown / not queryable",
  ok: "OK",
  ok_super_admin: "OK (super admin · global)",
  missing_company_on_user: "missing company on user",
  missing_company_mapping: "missing company mapping",
  missing_profile_company_id: "missing profile company_id",
  profile_company_mismatch: "profile/company mismatch",
};

/** Maps an identity status to a status-badge value (drives the tone colour). */
function identityStatusBadgeValue(status: IdentityStatus): string {
  switch (status) {
    case "ok":
    case "ok_super_admin":
      return "verified";
    case "loading":
    case "not_signed_in":
    case "not_queryable":
      return "not_started";
    default:
      return "blocked";
  }
}

/**
 * Read-only company identity / mapping verification for the signed-in session.
 *
 * Surfaces exactly the values needed to distinguish a missing company-UUID
 * mapping, a missing/mismatched `profiles.company_id`, or a healthy mapping
 * where the persistence issue must lie elsewhere:
 *  - the Supabase Auth uid + email actually establishing the RLS role
 *  - the app-facing company legacy id (from the signed-in user)
 *  - the resolved `companies.id` UUID for that legacy id (via loadCompanyUuidMap)
 *  - whether the legacy id exists in `companies` at all
 *  - `current_company_id()` as the database/RLS sees it (RPC)
 *  - `is_super_admin()` as the database/RLS sees it (RPC)
 *  - whether `current_company_id()` matches the resolved company UUID
 *
 * Purely observational — it only reads identity + mapping state. No provisioning,
 * no writes, no RLS changes. Intended for super_admin diagnostics only.
 */
function CompanyIdentityCard({
  legacyCompanyId,
  role,
  appUserId,
}: {
  legacyCompanyId: string | null;
  role: string | null;
  appUserId: string | null;
}) {
  const [state, setState] = useState<CompanyIdentityState>({
    status: "loading",
    authUid: null,
    authEmail: null,
    rlsCompanyId: null,
    rlsIsSuperAdmin: null,
    resolvedCompanyUuid: null,
    legacyExistsInCompanies: null,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function probe(): Promise<void> {
      if (role == null) {
        if (!cancelled) {
          setState((s) => ({ ...s, status: "not_signed_in" }));
        }
        return;
      }
      if (!isSupabaseConfigured || !supabase || !isSupabaseAuthEnabled) {
        if (!cancelled) {
          setState((s) => ({
            ...s,
            status: "not_queryable",
            error: !isSupabaseAuthEnabled
              ? "Supabase Auth is disabled in this build — current_company_id() cannot be observed."
              : "Supabase is not configured in this build.",
          }));
        }
        return;
      }

      try {
        const [{ data: userData }, companyMap, rlsCompany, rlsSuper] = await Promise.all([
          supabase.auth.getUser(),
          loadCompanyUuidMap(),
          supabase.rpc("current_company_id"),
          supabase.rpc("is_super_admin"),
        ]);

        if (cancelled) return;

        const authUid = userData?.user?.id ?? null;
        const authEmail = userData?.user?.email ?? null;
        const resolvedCompanyUuid =
          legacyCompanyId != null ? (companyMap.get(legacyCompanyId) ?? null) : null;
        const legacyExistsInCompanies =
          legacyCompanyId != null ? companyMap.has(legacyCompanyId) : null;
        const rlsCompanyId = (rlsCompany.data as string | null) ?? null;
        const rlsIsSuperAdmin =
          typeof rlsSuper.data === "boolean" ? rlsSuper.data : null;
        const rpcError = rlsCompany.error?.message ?? rlsSuper.error?.message ?? null;

        let status: IdentityStatus;
        if (authUid == null) {
          status = "not_queryable";
        } else if (role === "super_admin") {
          status = "ok_super_admin";
        } else if (legacyCompanyId == null) {
          status = "missing_company_on_user";
        } else if (!legacyExistsInCompanies || resolvedCompanyUuid == null) {
          status = "missing_company_mapping";
        } else if (rlsCompanyId == null) {
          status = "missing_profile_company_id";
        } else if (rlsCompanyId !== resolvedCompanyUuid) {
          status = "profile_company_mismatch";
        } else {
          status = "ok";
        }

        setState({
          status,
          authUid,
          authEmail,
          rlsCompanyId,
          rlsIsSuperAdmin,
          resolvedCompanyUuid,
          legacyExistsInCompanies,
          error: rpcError,
        });
      } catch (err) {
        if (cancelled) return;
        setState((s) => ({
          ...s,
          status: "not_queryable",
          error: err instanceof Error ? err.message : "Identity probe failed.",
        }));
      }
    }

    void probe();
    return () => {
      cancelled = true;
    };
  }, [legacyCompanyId, role, appUserId]);

  const matchValue =
    state.status === "loading"
      ? "—"
      : role === "super_admin"
        ? "n/a (global)"
        : state.resolvedCompanyUuid == null || state.rlsCompanyId == null
          ? "no"
          : state.rlsCompanyId === state.resolvedCompanyUuid
            ? "yes"
            : "no";

  return (
    <div className="mb-4 overflow-hidden rounded-2xl border border-border bg-card">
      <div className="border-b border-border bg-muted/40 px-4 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Company identity &amp; mapping (signed-in session)
          </span>
          <StatusBadge value={identityStatusBadgeValue(state.status)} />
        </div>
      </div>

      <div className="grid gap-x-6 px-4 sm:grid-cols-2">
        <DetailRow label="Mapping status">
          <span className="text-sm font-medium">{IDENTITY_STATUS_LABEL[state.status]}</span>
        </DetailRow>
        <DetailRow label="current_company_id() == resolved UUID">
          <span
            className={cn(
              "rounded-md px-2 py-0.5 text-xs font-semibold",
              matchValue === "yes"
                ? TONE_CLS.green
                : matchValue === "no"
                  ? TONE_CLS.red
                  : "text-muted-foreground",
            )}
          >
            {matchValue}
          </span>
        </DetailRow>
        <DetailRow label="App user id">
          <span className="break-all font-mono text-xs text-muted-foreground">{appUserId ?? "—"}</span>
        </DetailRow>
        <DetailRow label="App role">
          <span className="text-sm">{role ?? "—"}</span>
        </DetailRow>
        <DetailRow label="Supabase auth uid">
          <span className="break-all font-mono text-xs text-muted-foreground">{state.authUid ?? "—"}</span>
        </DetailRow>
        <DetailRow label="Supabase auth email">
          <span className="break-all text-xs text-muted-foreground">{state.authEmail ?? "—"}</span>
        </DetailRow>
        <DetailRow label="App company legacy id">
          <span className="break-all font-mono text-xs text-muted-foreground">{legacyCompanyId ?? "—"}</span>
        </DetailRow>
        <DetailRow label="Legacy id exists in companies">
          <span className="text-sm">
            {state.legacyExistsInCompanies == null
              ? "n/a"
              : state.legacyExistsInCompanies
                ? "yes"
                : "no"}
          </span>
        </DetailRow>
        <DetailRow label="Resolved company UUID (loadCompanyUuidMap)">
          <span className="break-all font-mono text-xs text-muted-foreground">
            {state.resolvedCompanyUuid ?? "—"}
          </span>
        </DetailRow>
        <DetailRow label="current_company_id() (RLS)">
          <span className="break-all font-mono text-xs text-muted-foreground">
            {state.rlsCompanyId ?? "null"}
          </span>
        </DetailRow>
        <DetailRow label="is_super_admin() (RLS)">
          <span className="text-sm">
            {state.rlsIsSuperAdmin == null ? "—" : state.rlsIsSuperAdmin ? "true" : "false"}
          </span>
        </DetailRow>
      </div>

      {state.error != null ? (
        <p className="px-4 pb-3 text-[11px] text-amber-600 dark:text-amber-400">{state.error}</p>
      ) : null}
      <p className="px-4 pb-3 text-[11px] text-muted-foreground">
        Read-only identity probe. <span className="font-mono">current_company_id()</span> and{" "}
        <span className="font-mono">is_super_admin()</span> are read exactly as Supabase/RLS evaluates
        them for this session. A company write only satisfies RLS when{" "}
        <span className="font-mono">current_company_id()</span> equals the resolved company UUID. No
        data is written or changed by this panel.
      </p>
    </div>
  );
}

/**
 * Read-only Service Catalog diagnostics. The Settings → Services analogue of the
 * Time Reporting Parity Diagnostics panel: surfaces the EFFECTIVE, build-time
 * baked Service Categories + Service Definitions flag triples, the resolved
 * read/write modes, and the live in-memory cut-over + dual-write telemetry so the
 * deployed dev/demo build's service-catalog persistence state is observable
 * without DevTools (the `window.__cleanopsData` handles only exist in DEV builds).
 *
 * Purely observational — no toggles, no mutation, no writes, no test execution.
 * It only READS the already-exported telemetry snapshots from the service /
 * service-category cut-over + dual-write modules.
 */
function ServiceCatalogDiagnostics() {
  const { currentUser } = useApp();

  const categoryCutover = useMemo<ServiceCategoryCutoverState>(
    () => getServiceCategoryCutoverState(),
    [],
  );
  const categoryDualWrite = useMemo<ServiceCategoryDualWriteState>(
    () => getServiceCategoryDualWriteState(),
    [],
  );
  const serviceCutover = useMemo<ServiceCutoverState>(() => getServiceCutoverState(), []);
  const serviceDualWrite = useMemo<ServiceDualWriteState>(() => getServiceDualWriteState(), []);

  const categoryReadActive = useMemo(() => shouldReadServiceCategoriesFromSupabase(), []);
  const categoryWriteActive = useMemo(() => shouldMirrorServiceCategoryWrites(), []);
  const serviceReadActive = useMemo(() => shouldReadServicesFromSupabase(), []);
  const serviceWriteActive = useMemo(() => shouldMirrorServiceWrites(), []);

  const scopeLabel =
    currentUser == null
      ? "not signed in"
      : currentUser.role === "super_admin"
        ? "* (Super Admin · global catalog)"
        : currentUser.companyId ?? "— (no company on user)";

  return (
    <section className="mt-10">
      <div className="mb-3 flex items-center gap-2">
        <Database className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Service Catalog Diagnostics</h2>
        <span className="text-xs text-muted-foreground">
          Settings → Services persistence telemetry (categories &amp; definitions) — read-only
        </span>
      </div>

      {/* Scope context */}
      <div className="mb-4 overflow-hidden rounded-2xl border border-border bg-card">
        <div className="grid gap-x-6 px-4 sm:grid-cols-2">
          <DetailRow label="Signed-in role">
            <span className="text-sm">{currentUser?.role ?? "—"}</span>
          </DetailRow>
          <DetailRow label="Read/write company scope (legacy id)">
            <span className="break-all font-mono text-xs text-muted-foreground">{scopeLabel}</span>
          </DetailRow>
        </div>
        <p className="px-4 pb-3 text-[11px] text-muted-foreground">
          Company rows mirror under this legacy id (mapped to a Supabase company UUID before write); global rows carry company_id = null. A non-zero “Skipped (no company map)” means a company row had no Supabase company mapping and was not mirrored.
        </p>
      </div>

      <CompanyIdentityCard
        legacyCompanyId={currentUser?.companyId ?? null}
        role={currentUser?.role ?? null}
        appUserId={currentUser?.id ?? null}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <ServiceCatalogDomainCard
          title="Service Categories"
          flagPrefix="SERVICE_CATEGORIES"
          readFlag={SERVICE_CATEGORIES_SUPABASE_READ}
          dualWriteFlag={SERVICE_CATEGORIES_DUAL_WRITE}
          authoritativeFlag={SERVICE_CATEGORIES_SUPABASE_AUTHORITATIVE}
          readActive={categoryReadActive}
          writeActive={categoryWriteActive}
          cutover={categoryCutover}
          dualWrite={categoryDualWrite}
        />
        <ServiceCatalogDomainCard
          title="Service Definitions"
          flagPrefix="SERVICES"
          readFlag={SERVICES_SUPABASE_READ}
          dualWriteFlag={SERVICES_DUAL_WRITE}
          authoritativeFlag={SERVICES_SUPABASE_AUTHORITATIVE}
          readActive={serviceReadActive}
          writeActive={serviceWriteActive}
          cutover={serviceCutover}
          dualWrite={serviceDualWrite}
        />
      </div>

      {/* Recent read fallbacks/failures (sanitized) */}
      <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
        <div className="border-b border-border bg-muted/40 px-4 py-2.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Recent read fallbacks &amp; failures (newest first · max 50 per domain)
          </span>
        </div>
        {categoryCutover.recentFailures.length === 0 && serviceCutover.recentFailures.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            No read fallbacks, unsafe-empty results, or drift recorded this session.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">When</th>
                  <th className="px-4 py-2.5 font-medium">Domain</th>
                  <th className="px-4 py-2.5 font-medium">Kind</th>
                  <th className="px-4 py-2.5 font-medium">Scope</th>
                  <th className="px-4 py-2.5 font-medium">Message</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[
                  ...categoryCutover.recentFailures.map((f) => ({ domain: "Categories", ...f })),
                  ...serviceCutover.recentFailures.map((f) => ({ domain: "Definitions", ...f })),
                ]
                  .sort((a, b) => (a.at < b.at ? 1 : -1))
                  .slice(0, 50)
                  .map((f, i) => (
                    <tr key={`${f.domain}-${f.ref}-${f.at}-${i}`} className="align-top">
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-muted-foreground tabular-nums">
                        {formatTimelineDate(f.at)}
                      </td>
                      <td className="px-4 py-2.5 text-xs">{f.domain}</td>
                      <td className="px-4 py-2.5 font-mono text-xs">{f.kind}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{f.ref}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{f.message}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        Telemetry is in-memory and resets on reload. Flag values are baked into this build — if a flag reads <span className="font-mono">false</span> here, the running bundle was built without that env var set to <span className="font-mono">true</span>. Read-only — no toggles, no writes, no test execution, no change to Services persistence or read logic.
      </p>
    </section>
  );
}

/**
 * Read-only Mission Log dual-write diagnostics. Surfaces the EFFECTIVE,
 * build-time-baked feature-flag values plus the live in-memory dual-write
 * telemetry so the deployed/dev-demo build's flag state is observable without
 * DevTools (the `window.__cleanopsData` handles only exist in DEV builds).
 *
 * Purely observational — no toggles, no mutation, no writes. If a flag reads
 * OFF here in a deployed build, the running bundle was built without that env
 * var set to "true".
 */
function MissionLogDiagnostics() {
  // Read once on mount — flag consts are baked at build time and the telemetry
  // snapshot is a cheap immutable copy; no need to subscribe/poll.
  const flags = useMemo(
    () => [
      { key: "EXPO_PUBLIC_MISSION_LOG_DUAL_WRITE", value: MISSION_LOG_DUAL_WRITE },
      { key: "EXPO_PUBLIC_MISSION_LOG_SUPABASE_READ", value: MISSION_LOG_SUPABASE_READ },
      {
        key: "EXPO_PUBLIC_MISSION_LOG_SUPABASE_AUTHORITATIVE",
        value: MISSION_LOG_SUPABASE_AUTHORITATIVE,
      },
      {
        key: "EXPO_PUBLIC_TIME_REPORTING_SHADOW_VALIDATE",
        value: TIME_REPORTING_SHADOW_VALIDATE,
      },
    ],
    [],
  );
  const mirrorActive = useMemo(() => shouldMirrorMissionLogCheckout(), []);
  const telemetry = useMemo(() => getMissionLogCutoverState(), []);

  return (
    <section className="mt-10">
      <div className="mb-3 flex items-center gap-2">
        <Radio className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Mission Log Dual-Write Diagnostics</h2>
        <span className="text-xs text-muted-foreground">
          Effective build-time flag values &amp; live mirror telemetry — read-only
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Effective flag values */}
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="border-b border-border bg-muted/40 px-4 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Effective flags (baked into this build)
              </span>
              <span
                className={cn(
                  "rounded-md px-2 py-0.5 text-[11px] font-semibold",
                  mirrorActive
                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                )}
              >
                Mirror {mirrorActive ? "ACTIVE" : "INACTIVE"}
              </span>
            </div>
          </div>
          <div className="divide-y divide-border px-4">
            {flags.map((f) => (
              <div key={f.key} className="flex items-center justify-between gap-3 py-2.5">
                <span className="break-all font-mono text-[11px] text-muted-foreground">{f.key}</span>
                <span
                  className={cn(
                    "shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold tabular-nums",
                    f.value
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {f.value ? "true" : "false"}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Live mirror telemetry (in-memory, current session) */}
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="border-b border-border bg-muted/40 px-4 py-2.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Live mirror telemetry (this session)
            </span>
          </div>
          <div className="divide-y divide-border px-4">
            <DetailRow label="Mirror enabled">
              <StatusBadge value={telemetry.supabaseWrite ? "active" : "not_started"} />
            </DetailRow>
            <DetailRow label="Attempted"><span className="text-sm tabular-nums">{telemetry.attempted}</span></DetailRow>
            <DetailRow label="Succeeded"><span className="text-sm tabular-nums">{telemetry.succeeded}</span></DetailRow>
            <DetailRow label="Failed"><span className="text-sm tabular-nums">{telemetry.failed}</span></DetailRow>
            <DetailRow label="Skipped (no company map)">
              <span className="text-sm tabular-nums">{telemetry.skippedMissingCompany}</span>
            </DetailRow>
            <DetailRow label="Last run">
              <span className="text-xs text-muted-foreground">{telemetry.lastRunAt ?? "—"}</span>
            </DetailRow>
            <DetailRow label="Last error">
              <span className="text-xs text-muted-foreground">{telemetry.lastError ?? "—"}</span>
            </DetailRow>
          </div>
        </div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Telemetry is in-memory and resets on reload. If the mirror reads INACTIVE in a deployed build, the running bundle was built without
        <span className="font-mono"> EXPO_PUBLIC_MISSION_LOG_DUAL_WRITE=true</span>. Read-only — no toggles, no writes.
      </p>
    </section>
  );
}

function SectionLabel({ icon: Icon, children }: { icon: typeof Boxes; children: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</h3>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 w-[150px]">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{label}: All</SelectItem>
        {options.map((opt) => (
          <SelectItem key={opt} value={opt}>
            {humanize(opt)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
