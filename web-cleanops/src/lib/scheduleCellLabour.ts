/**
 * Presentation-only labour summary for a Schedule Board occurrence chip.
 *
 * Derived purely from values already carried by Schedule Core
 * ({@link ScheduleEntry.visitMinutes}, `labourMinutes`, `perEmployeeMinutes`,
 * `assignedEmployeeNames`, `isLabourRedistributed`). It performs no staffing,
 * occurrence, or labour calculation — it only formats existing numbers so the
 * planner can see workload at a glance.
 *
 * The planner-facing format is the compact `[Duration / Labour]` badge, e.g.
 * `[2.0h / 4.0h]`, where Duration is the actual on-site scheduled duration and
 * Labour is the total labour. The per-employee figure is kept internally (and
 * used by callers' tooltips) but is no longer surfaced as standalone text.
 */
export interface VisitChipLabour {
  /**
   * Compact `[Duration / Labour]` badge, e.g. `[2.0h / 4.0h]`. Null when the
   * on-site duration or total labour is unknown.
   */
  summaryLabel: string | null;
  /** Per-employee planned hours, kept internally (e.g. for tooltips). Null when unavailable. */
  perEmployeeMinutes: number | null;
  /** Mirrors the entry flag so callers can show a "redistributed" indicator. */
  isRedistributed: boolean;
}

/**
 * Formats minutes as a compact decimal-hours label with at least one decimal
 * place: 120 → "2.0h", 40 → "0.67h", 150 → "2.5h", 360 → "6.0h".
 */
function hoursLabel(minutes: number): string {
  const rounded = Math.round((minutes / 60) * 100) / 100;
  let text = rounded.toFixed(2);
  // Drop a single trailing zero but keep at least one decimal ("2.00" → "2.0").
  if (text.endsWith("0")) text = text.slice(0, -1);
  return `${text}h`;
}

/**
 * Builds the compact labour badge shown on Schedule Board chips and Booking
 * Queue rows. Pure and side-effect free; safe with missing/partial data.
 */
export function buildVisitChipLabour(input: {
  visitMinutes: number | null;
  labourMinutes: number | null;
  perEmployeeMinutes: number | null;
  assignedEmployeeNames: string[];
  isLabourRedistributed: boolean;
}): VisitChipLabour {
  const hasVisit = input.visitMinutes != null && input.visitMinutes > 0;
  const hasLabour = input.labourMinutes != null && input.labourMinutes > 0;

  const summaryLabel =
    hasVisit && hasLabour
      ? `[${hoursLabel(input.visitMinutes as number)} / ${hoursLabel(input.labourMinutes as number)}]`
      : null;

  return {
    summaryLabel,
    perEmployeeMinutes:
      input.perEmployeeMinutes != null && input.perEmployeeMinutes > 0
        ? input.perEmployeeMinutes
        : null,
    isRedistributed: input.isLabourRedistributed === true,
  };
}
