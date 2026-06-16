import { AlertTriangle, CheckCircle2, Info, ShieldAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ConfigHealthItem, ConfigHealthLevel } from "@/lib/calculator/calculatorConfigAdmin";

const LEVEL_META: Record<
  ConfigHealthLevel,
  { label: string; icon: typeof AlertTriangle; row: string; chip: string }
> = {
  blocking: {
    label: "Blocking",
    icon: ShieldAlert,
    row: "border-red-500/30 bg-red-500/5",
    chip: "bg-red-500/10 text-red-600 dark:text-red-400",
  },
  warning: {
    label: "Warning",
    icon: AlertTriangle,
    row: "border-amber-500/30 bg-amber-500/5",
    chip: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  info: {
    label: "Info",
    icon: Info,
    row: "border-sky-500/30 bg-sky-500/5",
    chip: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  },
};

const LEVEL_ORDER: ConfigHealthLevel[] = ["blocking", "warning", "info"];

/**
 * Configuration health panel — renders the detected unsafe/incomplete config
 * issues, grouped severity-first. Read-only: it only surfaces what
 * {@link computeCalculatorConfigHealth} found; it never mutates anything.
 */
export function ConfigHealthPanel({ items }: { items: ConfigHealthItem[] }) {
  if (items.length === 0) {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <div>
          <p className="text-sm font-semibold">Configuration looks healthy</p>
          <p className="text-sm text-muted-foreground">
            No blocking issues or warnings were detected in the current calculator configuration.
          </p>
        </div>
      </div>
    );
  }

  const sorted = [...items].sort(
    (a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level),
  );

  return (
    <div className="space-y-2" aria-label="Configuration health">
      {sorted.map((item, index) => {
        const meta = LEVEL_META[item.level];
        const Icon = meta.icon;
        return (
          <div
            key={`${item.code}-${item.context ?? index}`}
            className={cn("flex items-start gap-3 rounded-xl border p-3", meta.row)}
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                    meta.chip,
                  )}
                >
                  {meta.label}
                </span>
                {item.context ? (
                  <span className="font-mono text-[11px] text-muted-foreground">{item.context}</span>
                ) : null}
              </div>
              <p className="mt-1 text-sm">{item.message}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default ConfigHealthPanel;
