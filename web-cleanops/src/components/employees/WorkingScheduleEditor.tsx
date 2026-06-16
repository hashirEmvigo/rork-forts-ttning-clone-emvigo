import { useCallback } from "react";
import { CopyCheck, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { TimePicker } from "@/components/ui/time-picker";
import { cn } from "@/lib/utils";
import {
  WEEKDAYS,
  WEEKDAY_LABELS,
  copyMondayToAll,
  dailyCapacityMinutes,
  defaultWorkingSchedule,
  normalizeWorkingSchedule,
} from "@/lib/employeeSchedule";
import type { EmployeeWorkingSchedule, Weekday } from "@/types";

interface WorkingScheduleEditorProps {
  value: EmployeeWorkingSchedule;
  onChange: (next: EmployeeWorkingSchedule) => void;
}

function formatCapacity(minutes: number): string {
  if (minutes <= 0) return "0h";
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}

/**
 * Editor for an employee's normal weekly working schedule (availability, hours,
 * break and daily capacity). Fully controlled: it never persists — the parent
 * owns the value and decides when to save. The derived daily capacity is shown
 * live from the shared {@link dailyCapacityMinutes} so the editor and every
 * planner check agree on the number.
 */
export function WorkingScheduleEditor({ value, onChange }: WorkingScheduleEditorProps) {
  const schedule = normalizeWorkingSchedule(value);

  const patchDay = useCallback(
    (weekday: Weekday, patch: Partial<EmployeeWorkingSchedule[number]>) => {
      onChange(
        normalizeWorkingSchedule(
          schedule.map((d) => (d.weekday === weekday ? { ...d, ...patch } : d)),
        ),
      );
    },
    [schedule, onChange],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8"
          onClick={() => onChange(copyMondayToAll(schedule))}
        >
          <CopyCheck className="h-3.5 w-3.5" /> Copy Monday to all
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8"
          onClick={() => onChange(defaultWorkingSchedule())}
        >
          <RotateCcw className="h-3.5 w-3.5" /> Reset to default
        </Button>
      </div>

      <div className="space-y-1.5">
        {WEEKDAYS.map((weekday) => {
          const day = schedule.find((d) => d.weekday === weekday)!;
          const capacity = dailyCapacityMinutes(day);
          return (
            <div
              key={weekday}
              className={cn(
                "grid grid-cols-[7.5rem_auto] items-center gap-x-3 gap-y-2 rounded-lg border border-border px-3 py-2.5 sm:grid-cols-[7.5rem_minmax(0,1fr)]",
                !day.isAvailable && "bg-muted/40",
              )}
            >
              <label className="flex items-center gap-2 text-sm font-medium">
                <Switch
                  checked={day.isAvailable}
                  onCheckedChange={(checked) => patchDay(weekday, { isAvailable: checked })}
                />
                {WEEKDAY_LABELS[weekday]}
              </label>

              {day.isAvailable ? (
                <div className="flex flex-wrap items-end gap-2">
                  <Field label="Start">
                    <TimePicker
                      value={day.startTime}
                      onChange={(v) => patchDay(weekday, { startTime: v })}
                      className="w-[7.5rem]"
                    />
                  </Field>
                  <Field label="End">
                    <TimePicker
                      value={day.endTime}
                      onChange={(v) => patchDay(weekday, { endTime: v })}
                      className="w-[7.5rem]"
                    />
                  </Field>
                  <Field label="Break (min)">
                    <Input
                      type="number"
                      min={0}
                      step={5}
                      value={day.breakMinutes ?? 0}
                      onChange={(e) =>
                        patchDay(weekday, { breakMinutes: Math.max(0, Number(e.target.value) || 0) })
                      }
                      className="h-10 w-20"
                    />
                  </Field>
                  <Field label="Capacity (h)">
                    <Input
                      type="number"
                      min={0}
                      step={0.5}
                      placeholder="auto"
                      value={day.capacityHours ?? ""}
                      onChange={(e) => {
                        const raw = e.target.value;
                        patchDay(weekday, {
                          capacityHours: raw === "" ? undefined : Math.max(0, Number(raw) || 0),
                        });
                      }}
                      className="h-10 w-20"
                    />
                  </Field>
                  <span className="ml-auto whitespace-nowrap pb-1.5 text-xs text-muted-foreground">
                    {formatCapacity(capacity)} capacity
                  </span>
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">Unavailable</span>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        This is the employee’s normal availability — not the customer cleaning
        schedule. Capacity defaults to working hours minus break; set a value to
        override it.
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
