import { addMinutesToTime } from "./time";

/**
 * Two distinct time concepts a booking carries:
 *
 *  - **Customer / original allowed window** — the window the customer booked
 *    (`plannedStartTime` → `plannedEndTime`). It never changes when staffing
 *    changes; it is the contractual window the work must happen within.
 *  - **Actual scheduled work window** — the wall-clock window the crew is
 *    physically on-site. When work is split across a larger crew working in
 *    parallel, the crew finishes faster, so the on-site window is SHORTER than
 *    the allowed window; when work is redistributed onto a smaller crew, a
 *    single person is on-site LONGER.
 *
 * The actual on-site duration equals the per-employee planned minutes
 * ({@link ScheduledWindowSource.perEmployeeMinutes}) — everyone works in
 * parallel, so the time the crew is present equals what each person works.
 * Without redistribution, per-employee minutes equal the visit window, so the
 * scheduled window is identical to the allowed window (fully backward
 * compatible). Falls back to the visit window when no per-employee value exists.
 */
export interface ScheduledWindowSource {
  /** Customer/original allowed window start "HH:MM". */
  plannedStartTime: string | null | undefined;
  /** Customer/original allowed window end "HH:MM". */
  plannedEndTime: string | null | undefined;
  /** Wall-clock visit/allowed window in minutes (or null when invalid). */
  visitMinutes: number | null | undefined;
  /** Planned minutes carried by each assigned employee (parallel on-site time). */
  perEmployeeMinutes: number | null | undefined;
}

/** The resolved windows: actual scheduled work time vs customer allowed time. */
export interface ScheduledWindow {
  /** Actual on-site work window start "HH:MM" (= allowed window start). */
  scheduledStartTime: string | null;
  /** Actual on-site work window end "HH:MM" (start + on-site minutes). */
  scheduledEndTime: string | null;
  /** Actual on-site work duration in minutes (or null when unknown). */
  onSiteMinutes: number | null;
  /** Customer/original allowed window start "HH:MM". */
  allowedStartTime: string | null;
  /** Customer/original allowed window end "HH:MM". */
  allowedEndTime: string | null;
  /** Customer/original allowed window duration in minutes (or null). */
  allowedMinutes: number | null;
  /**
   * True when the actual on-site window differs from the customer/allowed
   * window — i.e. the scheduled TIME must NOT be confused with the booked
   * window, so callers should label the allowed window separately.
   */
  differsFromAllowed: boolean;
}

function positiveOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

/**
 * Resolves the actual scheduled work window (what TIME columns / cards must
 * show) from a resolved occurrence's planned window plus its per-employee
 * planned minutes. The scheduled window starts at the allowed window's start
 * and lasts the on-site duration (per-employee minutes, falling back to the
 * visit window). Pure — safe during render.
 */
export function resolveScheduledWindow(
  source: ScheduledWindowSource,
): ScheduledWindow {
  const allowedStartTime = source.plannedStartTime?.trim()
    ? source.plannedStartTime
    : null;
  const allowedEndTime = source.plannedEndTime?.trim()
    ? source.plannedEndTime
    : null;
  const allowedMinutes = positiveOrNull(source.visitMinutes);

  // On-site duration = parallel per-employee time, falling back to the visit
  // window when no per-employee figure is available.
  const onSiteMinutes =
    positiveOrNull(source.perEmployeeMinutes) ?? allowedMinutes;

  let scheduledEndTime = allowedEndTime;
  if (allowedStartTime != null && onSiteMinutes != null) {
    scheduledEndTime = addMinutesToTime(allowedStartTime, onSiteMinutes) ?? allowedEndTime;
  }

  const differsFromAllowed =
    onSiteMinutes != null &&
    allowedMinutes != null &&
    onSiteMinutes !== allowedMinutes;

  return {
    scheduledStartTime: allowedStartTime,
    scheduledEndTime,
    onSiteMinutes,
    allowedStartTime,
    allowedEndTime,
    allowedMinutes,
    differsFromAllowed,
  };
}
