import { Archive, Info } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/hooks/use-toast";
import { AUTO_ARCHIVE_DELAY_OPTIONS } from "@/types";
import { SERVICE_LIFECYCLE_STAGE_LABELS } from "@/lib/archiveValidation";

interface AOSettingsPanelProps {
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

/** The Work Order Service lifecycle, in order, for the help section. */
const LIFECYCLE_STAGES = [
  {
    key: "active" as const,
    description: "The service is running and future occurrences may still be generated.",
  },
  {
    key: "ended" as const,
    description: "The service has reached its end date and is no longer active.",
  },
  {
    key: "archive_upcoming" as const,
    description:
      "The service is eligible for archival and stays visible for the retention period below, giving administrators time to review it.",
  },
  {
    key: "archived" as const,
    description: "The service is fully archived — hidden by default but searchable and recoverable.",
  },
];

/**
 * AO (Work Order Services) settings. Houses operational settings for Work Order
 * services. The first setting, Auto Archive Delay, controls how long a service
 * remains in the Archive Upcoming stage before the future auto-archive process
 * archives it automatically. The automation itself is not implemented yet — this
 * only configures it.
 */
export function AOSettingsPanel({ companyId }: AOSettingsPanelProps) {
  const { getWorkOrderSettingsFor, updateWorkOrderSettings } = useApp();
  const { toast } = useToast();

  const settings = getWorkOrderSettingsFor(companyId);

  const update = (days: number | null) => {
    const res = updateWorkOrderSettings(companyId, { autoArchiveDelayDays: days });
    if (!res.ok) {
      toast({ title: "Couldn't save", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: "AO settings saved" });
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold">Archive Management</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Control how Work Order services move through their lifecycle towards archival.
        </p>
      </div>

      {/* Auto Archive Delay */}
      <div className="rounded-xl border border-border bg-background p-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Archive className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h4 className="text-sm font-semibold">Auto Archive Delay</h4>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Controls how many days a completed service remains in Archive Upcoming before
              being archived automatically.
            </p>
          </div>
        </div>
        <div className="mt-4 max-w-[220px]">
          <Select
            value={toSelectValue(settings.autoArchiveDelayDays)}
            onValueChange={(v) => update(fromSelectValue(v))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AUTO_ARCHIVE_DELAY_OPTIONS.map((o) => (
                <SelectItem key={o.label} value={toSelectValue(o.value)}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Lifecycle reference */}
      <div className="rounded-xl border border-border bg-background p-5">
        <h4 className="text-sm font-semibold">Service lifecycle</h4>
        <ol className="mt-3 space-y-3">
          {LIFECYCLE_STAGES.map((stage, idx) => (
            <li key={stage.key} className="flex items-start gap-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                {idx + 1}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {SERVICE_LIFECYCLE_STAGE_LABELS[stage.key]}
                </p>
                <p className="text-sm text-muted-foreground">{stage.description}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          This setting is saved for your company and prepares the upcoming automatic
          archival process. Nothing is archived automatically yet — services that reach
          Archive Upcoming stay visible until an administrator archives them.
        </p>
      </div>
    </div>
  );
}
