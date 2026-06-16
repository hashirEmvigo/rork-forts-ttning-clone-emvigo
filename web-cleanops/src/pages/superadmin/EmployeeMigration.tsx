import { useCallback, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCopy,
  Database,
  FlaskConical,
  HardDriveDownload,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { AccessDenied } from "@/components/AccessDenied";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/hooks/use-toast";
import {
  inspectEmployeeBackfill,
  shadowReadEmployees,
  getEmployeeDualWriteState,
  getEmployeeCutoverState,
  type EmployeeBackfillInspection,
  type EmployeeCompanyReadiness,
  type EmployeeCompanyReadinessStatus,
} from "@/lib/data";
import {
  EMPLOYEES_SUPABASE_READ,
  EMPLOYEES_DUAL_WRITE,
  EMPLOYEES_SHADOW_VALIDATE,
} from "@/lib/featureFlags";
import { BROWSER_DOMAIN_TOOL_DISABLED_REASON } from "@/lib/data/runtimeQuarantine";

/**
 * Employee Supabase Migration & Readiness (EMP-4 operational surface).
 *
 * A Super Admin–only, dev/demo-safe console for executing + observing the
 * Employee Supabase backfill/validation rollout directly from the DEPLOYED
 * environment — where EMPLOYEES_SUPABASE_READ is already active and the
 * partial-dataset risk lives — instead of a local `bun run dev` console.
 *
 * Strictly bounded: it can run only the SAFE, non-destructive helpers
 * (preflight inspection, dry-run backfill, per-company backfill upsert, shadow
 * validation) and READ telemetry. It NEVER toggles a feature flag, edits a row,
 * deletes/resets data, or displays any employee name / email / phone / address —
 * only counts, company ids and sanitized status.
 */

type Tone = "green" | "blue" | "amber" | "red" | "muted";

const TONE_CLS: Record<Tone, string> = {
  green: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  blue: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  red: "bg-red-500/10 text-red-600 dark:text-red-400",
  muted: "bg-muted text-muted-foreground",
};

const READINESS_TONE: Record<EmployeeCompanyReadinessStatus, Tone> = {
  parity_ok: "green",
  partially_backfilled: "amber",
  not_backfilled: "blue",
  mismatch: "red",
  unmapped: "red",
};

function humanize(value: string): string {
  return value
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-medium",
        TONE_CLS[tone],
      )}
    >
      {children}
    </span>
  );
}

function FlagPill({ on }: { on: boolean }) {
  return <Pill tone={on ? "green" : "muted"}>{on ? "ON" : "OFF"}</Pill>;
}

/** A single labelled count card. */
function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Database;
  label: string;
  value: number | string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xl font-semibold tabular-nums leading-none">{value}</p>
        <p className="mt-1 truncate text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

/** Sanitized result of one backfill / dry-run / validation action. */
interface ActionResult {
  title: string;
  ok: boolean;
  lines: Array<{ label: string; value: string }>;
  notes: string[];
}

/** Action keys, used to drive per-row spinners. */
type RunningAction = { kind: "dry" | "exec" | "validate"; companyId: string } | { kind: "preflight" } | null;

export default function EmployeeMigration() {
  const { currentUser } = useApp();
  const { toast } = useToast();

  const [inspection, setInspection] = useState<EmployeeBackfillInspection | null>(null);
  const [running, setRunning] = useState<RunningAction>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [confirmCompany, setConfirmCompany] = useState<EmployeeCompanyReadiness | null>(null);
  const [telemetryTick, setTelemetryTick] = useState<number>(0);

  const readOnWriteOff = EMPLOYEES_SUPABASE_READ && !EMPLOYEES_DUAL_WRITE;

  const dualWrite = useMemo(() => getEmployeeDualWriteState(), [telemetryTick]);
  const cutover = useMemo(() => getEmployeeCutoverState(), [telemetryTick]);

  const refreshTelemetry = useCallback(() => setTelemetryTick((t) => t + 1), []);

  const runPreflight = useCallback(async () => {
    setRunning({ kind: "preflight" });
    try {
      const report = await inspectEmployeeBackfill();
      setInspection(report);
      refreshTelemetry();
      if (report.error) {
        toast({ title: "Preflight could not complete", description: report.error, variant: "destructive" });
      }
    } catch (err) {
      toast({
        title: "Preflight failed",
        description: err instanceof Error ? err.message : "Unknown error.",
        variant: "destructive",
      });
    } finally {
      setRunning(null);
    }
  }, [refreshTelemetry, toast]);

  const runDryRun = useCallback(
    async (companyId: string) => {
      setResult({
        title: `Dry-run disabled · ${companyId}`,
        ok: false,
        lines: [
          { label: "Planned upserts", value: "0" },
          { label: "Wrote anything", value: "No" },
          { label: "Reason", value: "Phase 2B browser-domain quarantine" },
        ],
        notes: [
          BROWSER_DOMAIN_TOOL_DISABLED_REASON,
          "SELECT-style preflight counts and Supabase shadow validation remain available.",
        ],
      });
      toast({
        title: "Dry-run disabled",
        description: "Phase 2B prevents browser-persistent domain data from driving migration tooling.",
        variant: "destructive",
      });
    },
    [toast],
  );

  const runBackfill = useCallback(
    async (companyId: string) => {
      setResult({
        title: `Backfill disabled · ${companyId}`,
        ok: false,
        lines: [
          { label: "Written", value: "0" },
          { label: "Reason", value: "Phase 1 browser-storage safety" },
        ],
        notes: [
          BROWSER_DOMAIN_TOOL_DISABLED_REASON,
          "Run a reviewed server-side migration plan instead; SELECT-style preflight and validation remain available.",
        ],
      });
      toast({
        title: "Backfill disabled",
        description: "Phase 1 prevents browser-persistent data from being upserted into Supabase.",
        variant: "destructive",
      });
    },
    [toast],
  );

  const runValidate = useCallback(
    async (companyId: string) => {
      setRunning({ kind: "validate", companyId });
      try {
        const report = await shadowReadEmployees(companyId);
        refreshTelemetry();
        setResult({
          title: `Validation · ${companyId}`,
          ok: report.ok,
          lines: [
            { label: "Local count", value: String(report.localCount) },
            { label: "Supabase count", value: String(report.supabaseCount) },
            { label: "Missing in Supabase", value: String(report.missingInSupabase.length) },
            { label: "Extra in Supabase", value: String(report.extraInSupabase.length) },
            { label: "Count match", value: report.countMatch ? "Yes" : "No" },
            { label: "Summary match", value: report.summaryMatch ? "Yes" : "No" },
            { label: "Detail match", value: report.detailMatch ? "Yes" : "No" },
          ],
          notes: report.notes,
        });
      } finally {
        setRunning(null);
      }
    },
    [refreshTelemetry],
  );

  const copyDiagnostics = useCallback(async () => {
    // PII-free: counts, flags, company ids + status, and sanitized telemetry
    // (mismatch field names only — never the local/supabase values, which could
    // be an employee name or email).
    const diagnostic = {
      generatedAt: new Date().toISOString(),
      flags: {
        EMPLOYEES_SUPABASE_READ,
        EMPLOYEES_DUAL_WRITE,
        EMPLOYEES_SHADOW_VALIDATE,
      },
      warning: readOnWriteOff
        ? "Employee reads are Supabase-primary while the write mirror is OFF — backfill before relying on Supabase."
        : null,
      preflight: inspection
        ? {
            ok: inspection.ok,
            totals: inspection.totals,
            companies: inspection.companies.map((c) => ({
              companyId: c.companyId,
              mapped: c.mapped,
              localCount: c.localCount,
              supabaseActiveCount: c.supabaseActiveCount,
              supabaseDeletedCount: c.supabaseDeletedCount,
              status: c.status,
            })),
          }
        : null,
      dualWriteState: {
        runs: dualWrite.runs,
        created: dualWrite.created,
        updated: dualWrite.updated,
        removed: dualWrite.removed,
        skipped: dualWrite.skipped,
        validations: dualWrite.validations,
        mismatches: dualWrite.mismatches,
        shadowDrift: dualWrite.shadowDrift,
        failures: dualWrite.failures,
        lastRunAt: dualWrite.lastRunAt,
        mismatchFields: [...new Set(dualWrite.recentMismatches.map((m) => m.field))],
      },
      cutoverState: {
        supabaseRead: cutover.supabaseRead,
        readSource: cutover.readSource,
        supabaseReads: cutover.supabaseReads,
        localReads: cutover.localReads,
        fallbacks: cutover.fallbacks,
        failures: cutover.failures,
        shadowDrift: cutover.shadowDrift,
        unsafeEmptyReads: cutover.unsafeEmptyReads,
        lastEventAt: cutover.lastEventAt,
      },
    };
    const text = JSON.stringify(diagnostic, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Diagnostic summary copied", description: "Sanitized — no employee PII included." });
    } catch {
      toast({ title: "Copy not available", description: "Clipboard access was blocked by the browser.", variant: "destructive" });
    }
  }, [cutover, dualWrite, inspection, readOnWriteOff, toast]);

  if (currentUser?.role !== "super_admin") return <AccessDenied />;

  const busyPreflight = running?.kind === "preflight";

  return (
    <DashboardLayout wide>
      <PageHeader
        title="Employee Supabase Migration"
        description="Super Admin operational surface for the EMP-4 Employee backfill & validation rollout — runs only safe, non-destructive helpers in the deployed environment. No flag toggles, no row editing, no employee PII."
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={copyDiagnostics}>
              <ClipboardCopy className="h-4 w-4" /> Copy diagnostics
            </Button>
            <Button onClick={runPreflight} disabled={busyPreflight}>
              {busyPreflight ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Run preflight
            </Button>
          </div>
        }
      />

      {/* Flag telemetry */}
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Feature flags</h2>
          <span className="text-xs text-muted-foreground">Read-only — flips happen at build time, never here.</span>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
            <span className="font-mono text-xs">EMPLOYEES_SUPABASE_READ</span>
            <FlagPill on={EMPLOYEES_SUPABASE_READ} />
          </div>
          <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
            <span className="font-mono text-xs">EMPLOYEES_DUAL_WRITE</span>
            <FlagPill on={EMPLOYEES_DUAL_WRITE} />
          </div>
          <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
            <span className="font-mono text-xs">EMPLOYEES_SHADOW_VALIDATE</span>
            <FlagPill on={EMPLOYEES_SHADOW_VALIDATE} />
          </div>
        </div>
        {readOnWriteOff ? (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              EmployeeDialog create/edit is now <strong>Supabase-authoritative</strong> and does not use the legacy dual-write
              mirror. Deferred employee actions — login creation, archive/delete and status toggles — still need separate
              review before smoke testing.
            </p>
          </div>
        ) : null}
      </div>

      {/* Preflight */}
      <section className="mt-6">
        <div className="mb-3 flex items-center gap-2">
          <Database className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Preflight inspection</h2>
          <span className="text-xs text-muted-foreground">localStorage vs Supabase, counts only.</span>
        </div>

        {inspection === null ? (
          <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
            Run preflight to inspect per-company employee parity. Nothing is written.
          </div>
        ) : (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard icon={Database} label="Companies" value={inspection.companies.length} />
              <StatCard icon={HardDriveDownload} label="Local employees" value={inspection.totals.localCount} />
              <StatCard icon={Database} label="Supabase active" value={inspection.totals.supabaseActiveCount} />
              <StatCard icon={Trash2} label="Supabase soft-deleted" value={inspection.totals.supabaseDeletedCount} />
            </div>

            <div className="overflow-hidden rounded-2xl border border-border bg-card">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">Company</th>
                      <th className="px-4 py-3 font-medium">Mapped</th>
                      <th className="px-4 py-3 font-medium tabular-nums">Local</th>
                      <th className="px-4 py-3 font-medium tabular-nums">Supabase active</th>
                      <th className="px-4 py-3 font-medium tabular-nums">Soft-deleted</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {inspection.companies.map((c) => {
                      const isDry = running?.kind === "dry" && running.companyId === c.companyId;
                      const isExec = running?.kind === "exec" && running.companyId === c.companyId;
                      const isVal = running?.kind === "validate" && running.companyId === c.companyId;
                      const anyRow = isDry || isExec || isVal;
                      return (
                        <tr key={c.companyId} className="align-middle">
                          <td className="px-4 py-3">
                            <span className="font-mono text-xs">{c.companyId}</span>
                          </td>
                          <td className="px-4 py-3">
                            <Pill tone={c.mapped ? "green" : "red"}>{c.mapped ? "Mapped" : "Unmapped"}</Pill>
                          </td>
                          <td className="px-4 py-3 tabular-nums">{c.localCount}</td>
                          <td className="px-4 py-3 tabular-nums">{c.supabaseActiveCount}</td>
                          <td className="px-4 py-3 tabular-nums text-muted-foreground">{c.supabaseDeletedCount}</td>
                          <td className="px-4 py-3">
                            <Pill tone={READINESS_TONE[c.status]}>{humanize(c.status)}</Pill>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex justify-end gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={anyRow}
                                onClick={() => runDryRun(c.companyId)}
                              >
                                {isDry ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
                                Dry-run
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={anyRow || !c.mapped}
                                onClick={() => setConfirmCompany(c)}
                              >
                                {isExec ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <HardDriveDownload className="h-3.5 w-3.5" />}
                                Backfill
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={anyRow}
                                onClick={() => runValidate(c.companyId)}
                              >
                                {isVal ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                                Validate
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {inspection.companies.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-12 text-center text-sm text-muted-foreground">
                          No companies found in either source.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
            {inspection.error ? (
              <p className="mt-2 text-xs text-red-600 dark:text-red-400">{inspection.error}</p>
            ) : null}
          </>
        )}
      </section>

      {/* Action result */}
      {result ? (
        <section className="mt-6">
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-3">
              {result.ok ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-amber-500" />
              )}
              <h3 className="text-sm font-semibold">{result.title}</h3>
              <Pill tone={result.ok ? "green" : "amber"}>{result.ok ? "OK" : "Needs attention"}</Pill>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 p-4 sm:grid-cols-3">
              {result.lines.map((l) => (
                <div key={l.label} className="flex items-center justify-between gap-3">
                  <span className="text-xs text-muted-foreground">{l.label}</span>
                  <span className="text-sm font-medium tabular-nums">{l.value}</span>
                </div>
              ))}
            </div>
            {result.notes.length > 0 ? (
              <div className="border-t border-border px-4 py-3">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notes</p>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {result.notes.map((n, i) => (
                    <li key={i} className="font-mono">{n}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* Telemetry */}
      <section className="mt-8">
        <div className="mb-3 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Write-mirror &amp; read telemetry</h2>
          <Button variant="ghost" size="sm" onClick={refreshTelemetry} className="ml-auto h-7">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-border bg-card p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dual-write (mirror)</p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <TeleRow label="Runs" value={dualWrite.runs} />
              <TeleRow label="Created" value={dualWrite.created} />
              <TeleRow label="Updated" value={dualWrite.updated} />
              <TeleRow label="Removed" value={dualWrite.removed} />
              <TeleRow label="Skipped" value={dualWrite.skipped} />
              <TeleRow label="Validations" value={dualWrite.validations} />
              <TeleRow label="Mismatches" value={dualWrite.mismatches} danger={dualWrite.mismatches > 0} />
              <TeleRow label="Shadow drift" value={dualWrite.shadowDrift} danger={dualWrite.shadowDrift > 0} />
              <TeleRow label="Failures" value={dualWrite.failures} danger={dualWrite.failures > 0} />
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Read cutover</p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <TeleRow label="Read source" value={cutover.readSource} />
              <TeleRow label="Supabase reads" value={cutover.supabaseReads} />
              <TeleRow label="Local reads" value={cutover.localReads} />
              <TeleRow label="Fallbacks" value={cutover.fallbacks} danger={cutover.fallbacks > 0} />
              <TeleRow label="Unsafe empty" value={cutover.unsafeEmptyReads} danger={cutover.unsafeEmptyReads > 0} />
              <TeleRow label="Shadow drift" value={cutover.shadowDrift} danger={cutover.shadowDrift > 0} />
              <TeleRow label="Failures" value={cutover.failures} danger={cutover.failures > 0} />
            </div>
          </div>
        </div>
      </section>

      <AlertDialog open={confirmCompany !== null} onOpenChange={(open) => !open && setConfirmCompany(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Backfill {confirmCompany?.companyId}?</AlertDialogTitle>
            <AlertDialogDescription>
              This upserts {confirmCompany?.localCount ?? 0} local employee(s) into Supabase for this company
              (idempotent — re-running refreshes existing rows, never duplicates). It writes only this one company and
              is quarantined in normal app runtime. No browser-origin localStorage data will be upserted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = confirmCompany;
                setConfirmCompany(null);
                if (target) void runBackfill(target.companyId);
              }}
            >
              Run backfill
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}

function TeleRow({ label, value, danger }: { label: string; value: number | string; danger?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("text-sm font-medium tabular-nums", danger ? "text-red-600 dark:text-red-400" : "")}>
        {value}
      </span>
    </div>
  );
}
