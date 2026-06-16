import { useState } from "react";
import { Timer } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { addMinutesToTime, formatDurationHoursLabel } from "@/lib/time";
import { DEFAULT_DURATION_PRESETS_MINUTES } from "@/types";

interface QuickDurationHelperProps {
  /** Current planned start time as canonical "HH:MM" (empty when unset). */
  startTime: string;
  /** Called with the recalculated planned end time ("HH:MM") and the chosen duration in minutes. */
  onApply: (endTime: string, minutes: number) => void;
  /**
   * When set, highlights the matching preset as the currently active quick
   * duration. Cleared by callers when the end time is manually overridden, so
   * the highlight always reflects the live form state.
   */
  activeMinutes?: number | null;
  /**
   * Ordered duration presets, in minutes. Defaults to the built-in presets so
   * the helper works standalone; callers usually pass company Settings values.
   */
  presetMinutes?: number[];
  disabled?: boolean;
  className?: string;
}

/**
 * Reusable Quick Duration helper. Renders preset buttons (labelled in decimal
 * hours, e.g. "1.75") plus a Custom minutes entry. Clicking a preset recomputes
 * the planned end as start + duration and reports it through {@link onApply}.
 * It never selects/holds an "active" state — manual edits to the end time stay
 * intact, and the next click always recalculates from the current start.
 *
 * Decoupled from any specific form: it only needs a start time and a setter, so
 * it can be reused in Add/Edit Service, the Variation Wizard, Schedule, and
 * Quick Booking dialogs. Durations are handled in MINUTES throughout.
 */
export function QuickDurationHelper({
  startTime,
  onApply,
  presetMinutes = DEFAULT_DURATION_PRESETS_MINUTES,
  disabled = false,
  activeMinutes = null,
  className,
}: QuickDurationHelperProps) {
  const [customOpen, setCustomOpen] = useState<boolean>(false);
  const [customValue, setCustomValue] = useState<string>("");

  const hasStart = startTime.trim().length > 0;
  const isDisabled = disabled || !hasStart;

  const apply = (minutes: number) => {
    const end = addMinutesToTime(startTime, minutes);
    if (end) onApply(end, minutes);
  };

  const applyCustom = () => {
    const minutes = Number.parseInt(customValue, 10);
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    apply(minutes);
    setCustomValue("");
    setCustomOpen(false);
  };

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Timer className="h-3.5 w-3.5" />
        <span>Quick duration</span>
        {!hasStart ? (
          <span className="font-normal text-muted-foreground/70">· set a start time first</span>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {presetMinutes.map((minutes) => {
          const isActive = !isDisabled && activeMinutes === minutes;
          return (
            <button
              key={minutes}
              type="button"
              disabled={isDisabled}
              aria-pressed={isActive}
              onClick={() => apply(minutes)}
              title={`${formatDurationHoursLabel(minutes)} h · ${minutes} min`}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium tabular-nums transition-colors disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border disabled:hover:bg-background disabled:hover:text-foreground",
                isActive
                  ? "border-primary bg-primary text-primary-foreground hover:bg-primary"
                  : "border-border bg-background text-foreground hover:border-primary hover:bg-primary/5 hover:text-primary",
              )}
            >
              {formatDurationHoursLabel(minutes)}
            </button>
          );
        })}
        <Popover open={customOpen} onOpenChange={setCustomOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={isDisabled}
              className="rounded-full border border-dashed border-border bg-background px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              Custom
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56 p-3">
            <Label htmlFor="quick-duration-custom" className="text-xs font-medium">
              Duration (minutes)
            </Label>
            <div className="mt-1.5 flex items-center gap-2">
              <Input
                id="quick-duration-custom"
                type="number"
                min={1}
                inputMode="numeric"
                placeholder="105"
                className="h-9 tabular-nums"
                value={customValue}
                autoFocus
                onChange={(e) => setCustomValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    applyCustom();
                  }
                }}
              />
              <Button type="button" size="sm" className="h-9 shrink-0" onClick={applyCustom}>
                Apply
              </Button>
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Any minute count, e.g. 45, 70, 105, 240.
            </p>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
