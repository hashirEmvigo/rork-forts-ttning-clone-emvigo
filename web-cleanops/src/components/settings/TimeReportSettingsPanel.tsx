import { useMemo } from "react";
import { CheckCircle2, Clock, Info, Timer } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/hooks/use-toast";
import {
  TIME_DEVIATION_TOLERANCE_OPTIONS,
  resolveTimeReportApproval,
} from "@/types";

interface TimeReportSettingsPanelProps {
  companyId: string;
}

/**
 * Company Admin controls for employee time-report approval. Admins can enable
 * automatic approval and set how much deviation between scheduled and actual
 * time is tolerated before a report needs manual approval. Future time-reporting
 * workflows consume these values when an employee submits and confirms a report.
 */
export function TimeReportSettingsPanel({ companyId }: TimeReportSettingsPanelProps) {
  const { getTimeReportSettingsFor, updateTimeReportSettings } = useApp();
  const { toast } = useToast();

  const settings = getTimeReportSettingsFor(companyId);

  const update = (
    patch: Partial<{ autoApproveEnabled: boolean; deviationToleranceMinutes: number }>,
  ) => {
    const res = updateTimeReportSettings(companyId, patch);
    if (!res.ok) {
      toast({ title: "Couldn't save", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: "Time Reporting settings saved" });
  };

  /** Worked example using the configured tolerance, mirroring the business rule. */
  const example = useMemo(() => {
    const scheduled = 180;
    const actual = 184;
    return {
      scheduled,
      actual,
      ...resolveTimeReportApproval(settings, scheduled, actual),
    };
  }, [settings]);

  return (
    <div className="space-y-5">
      {/* Automatic approval toggle */}
      <div className="rounded-xl border border-border bg-background p-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-success/10 text-success">
            <CheckCircle2 className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <Label htmlFor="time-auto-approve" className="text-sm font-semibold">
                  Enable automatic time report approval
                </Label>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  When on, employee time reports within the tolerance below are approved
                  automatically. When off, every time report requires administrator approval.
                </p>
              </div>
              <Switch
                id="time-auto-approve"
                checked={settings.autoApproveEnabled}
                onCheckedChange={(checked) => update({ autoApproveEnabled: checked })}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Deviation tolerance */}
      <div className="rounded-xl border border-border bg-background p-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Timer className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">Time deviation tolerance</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              The maximum difference, in minutes, between scheduled and actual time that
              still qualifies for automatic approval. It applies equally to time over and
              under the schedule. Reports exceeding it always require administrator approval.
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="w-[140px]">
            <Input
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={settings.deviationToleranceMinutes}
              onChange={(e) => {
                const parsed = Number(e.target.value);
                if (!Number.isFinite(parsed) || parsed < 0) return;
                update({ deviationToleranceMinutes: Math.round(parsed) });
              }}
              aria-label="Time deviation tolerance in minutes"
            />
          </div>
          <span className="text-sm text-muted-foreground">minutes</span>
          <div className="flex flex-wrap gap-2">
            {TIME_DEVIATION_TOLERANCE_OPTIONS.map((o) => {
              const active = o.value === settings.deviationToleranceMinutes;
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => update({ deviationToleranceMinutes: o.value })}
                  className={
                    active
                      ? "rounded-full border border-primary bg-primary/10 px-3 py-1 text-xs font-medium text-primary"
                      : "rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground hover:bg-muted"
                  }
                >
                  {o.value}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Worked example */}
      <div className="rounded-xl border border-border bg-muted/40 p-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-warning/10 text-warning">
            <Clock className="h-4 w-4" />
          </div>
          <div className="min-w-0 text-sm">
            <h3 className="font-semibold">How it works</h3>
            <p className="mt-1 text-muted-foreground">
              Deviation is the absolute difference: <code>|actual − scheduled|</code>.
            </p>
            <div className="mt-2 space-y-1 text-muted-foreground">
              <p>
                Scheduled {example.scheduled} min · Actual {example.actual} min · Deviation{" "}
                <span className="font-medium text-foreground">{example.deviationMinutes} min</span>{" "}
                (tolerance {settings.deviationToleranceMinutes} min).
              </p>
              <p>
                Result:{" "}
                {example.outcome === "auto_approve" ? (
                  <span className="font-medium text-success">Eligible for automatic approval</span>
                ) : (
                  <span className="font-medium text-foreground">Requires administrator approval</span>
                )}
                {!settings.autoApproveEnabled ? " (automatic approval is currently off)" : null}.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          These settings are saved for your company and will be used by upcoming time
          reporting workflows. They don't change any existing time reports on their own.
        </p>
      </div>
    </div>
  );
}
