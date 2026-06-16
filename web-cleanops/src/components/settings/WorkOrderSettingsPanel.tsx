import { Archive, Clock4, FileX2, Info, Lock } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/hooks/use-toast";
import { AUTO_ARCHIVE_OPTIONS } from "@/types";

interface WorkOrderSettingsPanelProps {
  companyId: string;
}

/** Encodes the nullable day value for the Select component. */
const VALUE_DISABLED = "disabled";

function toSelectValue(days: number | null): string {
  return days == null ? VALUE_DISABLED : String(days);
}

function fromSelectValue(value: string): number | null {
  return value === VALUE_DISABLED ? null : Number(value);
}

/**
 * Company Admin controls for automatic Work Order cleanup. Old, empty or
 * completed work moves out of the daily workflow automatically while archived
 * data stays searchable and recoverable — nothing is ever permanently deleted.
 */
export function WorkOrderSettingsPanel({ companyId }: WorkOrderSettingsPanelProps) {
  const { getWorkOrderSettingsFor, updateWorkOrderSettings, isServiceAvailableForCompany } =
    useApp();
  const { toast } = useToast();

  const settings = getWorkOrderSettingsFor(companyId);
  // Available only when globally on AND this company is entitled to the add-on.
  const masterAllowsPreferredTime = isServiceAvailableForCompany(
    companyId,
    "preferred_time_evaluation",
  );

  const update = (
    patch: Partial<{
      autoArchiveEmptyAfterDays: number | null;
      autoArchiveCompletedRowsAfterDays: number | null;
      preferredTimeEvaluationEnabled: boolean;
    }>,
  ) => {
    const res = updateWorkOrderSettings(companyId, patch);
    if (!res.ok) {
      toast({ title: "Couldn't save", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: "Work Order settings saved" });
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Auto-archive empty work orders */}
        <div className="rounded-xl border border-border bg-background p-5">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-warning/10 text-warning">
              <Archive className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">Auto-archive empty work orders</h3>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Automatically archive work orders that have zero active services after the
                selected number of days. A work order with no active service rows is treated
                as inactive.
              </p>
            </div>
          </div>
          <div className="mt-4 max-w-[220px]">
            <Select
              value={toSelectValue(settings.autoArchiveEmptyAfterDays)}
              onValueChange={(v) => update({ autoArchiveEmptyAfterDays: fromSelectValue(v) })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AUTO_ARCHIVE_OPTIONS.map((o) => (
                  <SelectItem key={o.label} value={toSelectValue(o.value)}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Auto-archive completed service rows */}
        <div className="rounded-xl border border-border bg-background p-5">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FileX2 className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">Auto-archive completed service rows</h3>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Automatically archive service rows once their end date has passed and the
                service has been invoiced and/or exported to payroll, after the selected
                number of days.
              </p>
            </div>
          </div>
          <div className="mt-4 max-w-[220px]">
            <Select
              value={toSelectValue(settings.autoArchiveCompletedRowsAfterDays)}
              onValueChange={(v) =>
                update({ autoArchiveCompletedRowsAfterDays: fromSelectValue(v) })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AUTO_ARCHIVE_OPTIONS.map((o) => (
                  <SelectItem key={o.label} value={toSelectValue(o.value)}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Preferred Time Evaluation (optional add-on) */}
      <div className="rounded-xl border border-border bg-background p-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Clock4 className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold">Preferred Time Evaluation</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Show whether scheduled service times match the customer's preferred days and
              time ranges — Optimal, Acceptable or Outside the approved range. Status icons
              appear in Work Order services and the future Schedule module.
            </p>
          </div>
          {masterAllowsPreferredTime ? (
            <Switch
              checked={settings.preferredTimeEvaluationEnabled}
              onCheckedChange={(v) => update({ preferredTimeEvaluationEnabled: v })}
              aria-label="Enable Preferred Time Evaluation"
            />
          ) : (
            <span className="mt-0.5 inline-flex h-5 items-center gap-1 rounded-full bg-muted px-2 text-xs font-medium text-muted-foreground">
              <Lock className="h-3 w-3" /> Locked
            </span>
          )}
        </div>
        {!masterAllowsPreferredTime ? (
          <p className="mt-3 text-xs text-muted-foreground">
            This is an optional add-on. Contact your platform administrator to unlock it.
          </p>
        ) : null}
      </div>

      <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Archiving keeps your daily workflow focused on active, relevant work while archived
          work orders and service rows stay searchable and recoverable — nothing is ever
          permanently deleted. Future invoicing, payroll, scheduling and reporting workflows
          will use these thresholds to trigger archiving automatically.
        </p>
      </div>
    </div>
  );
}
