import { useEffect, useMemo, useState } from "react";
import { Clock } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  buildTime,
  isValidTime24,
  parseTime24,
  splitTime,
} from "@/lib/time";

interface TimePickerProps {
  /** Canonical "HH:MM" value, or empty string when unset. */
  value: string;
  /** Called with a canonical "HH:MM" string, or "" when cleared. */
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  "aria-label"?: string;
}

type Stage = "hour" | "minute";

const CLOCK_SIZE = 232;
const CENTER = CLOCK_SIZE / 2;
const OUTER_RADIUS = 92;
const INNER_RADIUS = 60;
const NUMBER_RADIUS = 18;

/** Outer-ring hours 1–12 and inner-ring hours 13–23 + 00. */
const OUTER_HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const INNER_HOURS = [0, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

/** Position of a clock number around the dial; index 0 is the 12-o'clock slot. */
function pointAt(index: number, radius: number): { x: number; y: number } {
  const angle = (index / 12) * Math.PI * 2 - Math.PI / 2;
  return { x: CENTER + radius * Math.cos(angle), y: CENTER + radius * Math.sin(angle) };
}

/**
 * A modern 24-hour time picker. Administrators can either type the time manually
 * (forgiving input like "8", "830", "13.30" is normalised to "HH:MM") or open a
 * clock-style dial: first pick the hour (outer ring 1–12, inner ring 00 & 13–23),
 * then the minute. Always 24-hour — never AM/PM.
 */
export function TimePicker({
  value,
  onChange,
  placeholder = "HH:MM",
  disabled,
  id,
  className,
  "aria-label": ariaLabel,
}: TimePickerProps) {
  const [open, setOpen] = useState<boolean>(false);
  const [stage, setStage] = useState<Stage>("hour");
  const [text, setText] = useState<string>(value);

  // Keep the manual-input text in sync when the value changes externally.
  useEffect(() => {
    setText(value);
  }, [value]);

  // Reset to the hour stage each time the dial opens.
  useEffect(() => {
    if (open) setStage("hour");
  }, [open]);

  const parts = useMemo(() => splitTime(value), [value]);
  const selectedHour = parts?.hour ?? null;
  const selectedMinute = parts?.minute ?? null;

  const commitText = () => {
    const trimmed = text.trim();
    if (!trimmed) {
      onChange("");
      return;
    }
    const parsed = parseTime24(trimmed);
    if (parsed) {
      onChange(parsed);
      setText(parsed);
    } else {
      // Revert invalid input back to the last good value.
      setText(value);
    }
  };

  const pickHour = (hour: number) => {
    onChange(buildTime(hour, selectedMinute ?? 0));
    setStage("minute");
  };

  const pickMinute = (minute: number) => {
    onChange(buildTime(selectedHour ?? 0, minute));
    setOpen(false);
  };

  const valid = !text.trim() || isValidTime24(text.trim()) || parseTime24(text.trim()) != null;

  return (
    <div className={cn("relative", className)}>
      <Input
        id={id}
        inputMode="numeric"
        placeholder={placeholder}
        value={text}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-invalid={!valid}
        className={cn("pr-9 tabular-nums", !valid && "border-destructive focus-visible:ring-destructive")}
        onChange={(e) => setText(e.target.value)}
        onBlur={commitText}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitText();
          }
        }}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label="Open clock picker"
            className="absolute right-0 top-0 flex h-10 w-9 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            <Clock className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-3" align="end">
          <div className="mb-3 flex items-center justify-center gap-1 text-2xl font-semibold tabular-nums">
            <button
              type="button"
              onClick={() => setStage("hour")}
              className={cn(
                "rounded-md px-2 py-0.5 transition-colors",
                stage === "hour" ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted",
              )}
            >
              {selectedHour != null ? String(selectedHour).padStart(2, "0") : "--"}
            </button>
            <span className="text-muted-foreground">:</span>
            <button
              type="button"
              onClick={() => setStage("minute")}
              className={cn(
                "rounded-md px-2 py-0.5 transition-colors",
                stage === "minute" ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted",
              )}
            >
              {selectedMinute != null ? String(selectedMinute).padStart(2, "0") : "--"}
            </button>
          </div>

          <p className="mb-2 text-center text-xs text-muted-foreground">
            {stage === "hour" ? "Select hour" : "Select minutes"}
          </p>

          <svg
            width={CLOCK_SIZE}
            height={CLOCK_SIZE}
            viewBox={`0 0 ${CLOCK_SIZE} ${CLOCK_SIZE}`}
            className="touch-none select-none"
          >
            <circle cx={CENTER} cy={CENTER} r={OUTER_RADIUS + NUMBER_RADIUS} className="fill-muted" />
            {stage === "hour"
              ? [
                  ...OUTER_HOURS.map((h, i) => ({ value: h, ...pointAt(i, OUTER_RADIUS) })),
                  ...INNER_HOURS.map((h, i) => ({ value: h, ...pointAt(i, INNER_RADIUS) })),
                ].map(({ value: h, x, y }) => {
                  const active = selectedHour === h;
                  return (
                    <g key={`h-${h}`} onClick={() => pickHour(h)} className="cursor-pointer">
                      <circle cx={x} cy={y} r={NUMBER_RADIUS} className={active ? "fill-primary" : "fill-transparent"} />
                      <text
                        x={x}
                        y={y}
                        textAnchor="middle"
                        dominantBaseline="central"
                        className={cn(
                          "text-[13px] tabular-nums",
                          active ? "fill-primary-foreground font-semibold" : "fill-foreground",
                        )}
                      >
                        {String(h).padStart(2, "0")}
                      </text>
                    </g>
                  );
                })
              : MINUTES.map((m, i) => {
                  const { x, y } = pointAt(i, OUTER_RADIUS);
                  const active = selectedMinute === m;
                  return (
                    <g key={`m-${m}`} onClick={() => pickMinute(m)} className="cursor-pointer">
                      <circle cx={x} cy={y} r={NUMBER_RADIUS} className={active ? "fill-primary" : "fill-transparent"} />
                      <text
                        x={x}
                        y={y}
                        textAnchor="middle"
                        dominantBaseline="central"
                        className={cn(
                          "text-[13px] tabular-nums",
                          active ? "fill-primary-foreground font-semibold" : "fill-foreground",
                        )}
                      >
                        {String(m).padStart(2, "0")}
                      </text>
                    </g>
                  );
                })}
            <circle cx={CENTER} cy={CENTER} r={3} className="fill-primary" />
          </svg>
        </PopoverContent>
      </Popover>
    </div>
  );
}
