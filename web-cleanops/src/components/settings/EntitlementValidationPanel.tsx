import { useMemo, useState } from "react";
import {
  CheckCircle2,
  XCircle,
  RefreshCw,
  ShieldCheck,
  Building2,
  GitCompare,
  AlertTriangle,
  ClipboardList,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useApp } from "@/context/AppContext";
import {
  buildRealDataValidationReport,
  type RealDataValidationReport,
} from "@/lib/entitlements/realDataValidation";

/**
 * Phase 5 (real-data) — Super Admin entitlement shadow-validation report body.
 *
 * Runs {@link buildRealDataValidationReport} directly against the live
 * AppContext / localStorage datasets (companies, per-company entitlements,
 * global entitlements, and the Preferred Time Evaluation master gate) so a
 * super-admin can repeatably check cutover readiness without any manual JSON
 * export step.
 *
 * This is the layout-agnostic body so it can be rendered both as a standalone
 * page and as a tab inside the Settings hub. It is read-only: it never writes,
 * never flips a feature flag, and is not part of any production flow. The new
 * resolver remains unwired — computing this report cannot change app behaviour.
 *
 * Cutover gate: PASS only when mismatchCount === 0, loadIssueCount === 0, and
 * invariantViolationCount === 0.
 */
export function EntitlementValidationPanel() {
  const {
    companies,
    companyServiceEntitlements,
    serviceGlobalEntitlements,
    systemSettings,
  } = useApp();

  // Re-run is opt-in via a nonce so the snapshot is stable until requested.
  const [runNonce, setRunNonce] = useState<number>(0);
  const [lastRunAt, setLastRunAt] = useState<string>(() =>
    new Date().toLocaleString(),
  );

  // Computing the report is pure and synchronous, but we still guard every
  // input (AppContext arrays may be undefined mid-bootstrap) and wrap the call
  // so a malformed dataset surfaces a readable error state instead of throwing
  // up to the ErrorBoundary or leaving the screen stuck.
  const { report, error } = useMemo<{
    report: RealDataValidationReport | null;
    error: string | null;
  }>(() => {
    try {
      const built = buildRealDataValidationReport({
        companies: (companies ?? []).map((c) => ({ id: c.id })),
        companyEntitlements: companyServiceEntitlements ?? [],
        globalEntitlements: serviceGlobalEntitlements ?? [],
        systemSettings: {
          allowPreferredTimeEvaluation:
            systemSettings?.allowPreferredTimeEvaluation === true,
        },
      });
      return { report: built, error: null };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("Entitlement validation report failed:", e);
      return { report: null, error: message };
    }
    // runNonce is an intentional re-run trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    companies,
    companyServiceEntitlements,
    serviceGlobalEntitlements,
    systemSettings?.allowPreferredTimeEvaluation,
    runNonce,
  ]);

  const onRerun = () => {
    setRunNonce((n) => n + 1);
    setLastRunAt(new Date().toLocaleString());
  };

  // Report computation failed — render a readable error state, never a spinner.
  if (!report) {
    return (
      <div className="flex flex-col gap-4 rounded-2xl border border-destructive/30 bg-destructive/5 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-destructive/15 text-destructive">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-semibold">Could not build report</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              The validation report could not be computed from the current
              datasets. This is read-only and affects nothing in production.
            </p>
            {error ? (
              <p className="mt-3 rounded-lg border border-border bg-muted px-3 py-2 text-left font-mono text-xs text-muted-foreground">
                {error}
              </p>
            ) : null}
          </div>
        </div>
        <Button onClick={onRerun} variant="outline" className="shrink-0">
          <RefreshCw className="mr-2 h-4 w-4" />
          Re-run
        </Button>
      </div>
    );
  }

  const passed = report.passed;
  const fieldSummary = Object.entries(report.summaryByField).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );

  return (
    <div className="space-y-5">
      {/* Gate banner */}
      <div
        className={[
          "flex flex-col gap-4 rounded-2xl border p-5 sm:flex-row sm:items-center sm:justify-between",
          passed
            ? "border-emerald-500/30 bg-emerald-500/5"
            : "border-destructive/30 bg-destructive/5",
        ].join(" ")}
      >
        <div className="flex items-start gap-3">
          <div
            className={[
              "mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
              passed
                ? "bg-emerald-500/15 text-emerald-600"
                : "bg-destructive/15 text-destructive",
            ].join(" ")}
          >
            {passed ? (
              <CheckCircle2 className="h-5 w-5" />
            ) : (
              <XCircle className="h-5 w-5" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold">
                {passed ? "PASS" : "FAIL"}
              </h3>
              <Badge variant={passed ? "default" : "destructive"}>
                {passed ? "Cutover-ready" : "Not ready"}
              </Badge>
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {passed
                ? "All three gates are zero. Phase 6 planning can be approved."
                : "One or more gates are non-zero. Resolve the differences below before cutover."}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Resolved at {report.now} · last run {lastRunAt}
            </p>
          </div>
        </div>
        <Button onClick={onRerun} variant="outline" className="shrink-0">
          <RefreshCw className="mr-2 h-4 w-4" />
          Re-run
        </Button>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <MetricCard
          icon={<Building2 className="h-4 w-4" />}
          label="Companies analysed"
          value={report.companiesAnalysed}
        />
        <MetricCard
          icon={<ShieldCheck className="h-4 w-4" />}
          label="Services compared"
          value={report.servicesCompared}
        />
        <MetricCard
          icon={<GitCompare className="h-4 w-4" />}
          label="Feature comparisons"
          value={report.featureComparisons}
        />
        <MetricCard
          icon={<XCircle className="h-4 w-4" />}
          label="Mismatches"
          value={report.mismatchCount}
          tone={report.mismatchCount === 0 ? "ok" : "bad"}
        />
        <MetricCard
          icon={<ClipboardList className="h-4 w-4" />}
          label="Load issues"
          value={report.loadIssueCount}
          tone={report.loadIssueCount === 0 ? "ok" : "bad"}
        />
        <MetricCard
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Invariant violations"
          value={report.invariantViolationCount}
          tone={report.invariantViolationCount === 0 ? "ok" : "bad"}
        />
      </div>

      {/* Mismatch summary by field */}
      {report.mismatchCount > 0 && fieldSummary.length > 0 ? (
        <div className="rounded-2xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold">Mismatches by field</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {fieldSummary.map(([field, count]) => (
              <Badge key={field} variant="secondary" className="font-mono">
                {field}: {count}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}

      {/* Expandable detail sections */}
      <Accordion type="multiple" className="rounded-2xl border border-border bg-card px-5">
        <AccordionItem value="mismatches" className="border-b-0 [&:not(:last-child)]:border-b">
          <AccordionTrigger className="text-sm font-semibold">
            Mismatch details
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              showing {report.sampleMismatches.length} of {report.mismatchCount}
            </span>
          </AccordionTrigger>
          <AccordionContent>
            {report.sampleMismatches.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">
                No mismatches. The new pipeline matched the legacy path on every
                compared field.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="py-2 pr-4 font-medium">Company</th>
                      <th className="py-2 pr-4 font-medium">Service</th>
                      <th className="py-2 pr-4 font-medium">Field</th>
                      <th className="py-2 pr-4 font-medium">Legacy</th>
                      <th className="py-2 font-medium">New</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono text-xs">
                    {report.sampleMismatches.map((m, i) => (
                      <tr key={i} className="border-t border-border/60">
                        <td className="py-2 pr-4">{m.companyId}</td>
                        <td className="py-2 pr-4">{m.serviceKey}</td>
                        <td className="py-2 pr-4">{m.field}</td>
                        <td className="py-2 pr-4 text-amber-600">{m.legacy}</td>
                        <td className="py-2 text-sky-600">{m.new}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {report.mismatchCount > report.sampleMismatches.length ? (
                  <p className="mt-3 text-xs text-muted-foreground">
                    {report.mismatchCount - report.sampleMismatches.length} more
                    mismatch(es) not shown.
                  </p>
                ) : null}
              </div>
            )}
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="load-issues" className="border-b-0 [&:not(:last-child)]:border-b">
          <AccordionTrigger className="text-sm font-semibold">
            Load issues
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {report.loadIssueCount}
            </span>
          </AccordionTrigger>
          <AccordionContent>
            {report.loadIssues.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">
                No normalization findings on the synthetic rows.
              </p>
            ) : (
              <ul className="space-y-2 py-1">
                {report.loadIssues.map((issue, i) => (
                  <li
                    key={i}
                    className="rounded-lg border border-border/60 bg-muted/30 p-3 text-xs"
                  >
                    <span className="font-mono font-semibold">{issue.kind}</span>
                    <span className="ml-2 text-muted-foreground">
                      {issue.message}
                    </span>
                    {issue.serviceKey ? (
                      <span className="ml-2 text-muted-foreground">
                        service={issue.serviceKey}
                      </span>
                    ) : null}
                    {issue.limitKey ? (
                      <span className="ml-2 text-muted-foreground">
                        limit={issue.limitKey}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="invariants" className="border-b-0">
          <AccordionTrigger className="text-sm font-semibold">
            Invariant violations
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {report.invariantViolationCount}
            </span>
          </AccordionTrigger>
          <AccordionContent>
            {report.invariantViolations.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">
                All structural invariants held. Every analysed company received
                exactly one active base assignment.
              </p>
            ) : (
              <ul className="space-y-2 py-1">
                {report.invariantViolations.map((v, i) => (
                  <li
                    key={i}
                    className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs"
                  >
                    <span className="font-mono font-semibold">{v.kind}</span>
                    <span className="ml-2 text-muted-foreground">{v.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone?: "neutral" | "ok" | "bad";
}) {
  const valueClass =
    tone === "ok"
      ? "text-emerald-600"
      : tone === "bad"
        ? "text-destructive"
        : "text-foreground";
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted/60">
          {icon}
        </span>
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className={`mt-2 text-2xl font-semibold tabular-nums ${valueClass}`}>
        {value.toLocaleString()}
      </p>
    </div>
  );
}
