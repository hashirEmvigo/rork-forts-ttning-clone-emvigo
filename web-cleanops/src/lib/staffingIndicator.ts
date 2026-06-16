/**
 * Pure resolver for the at-a-glance staffing indicator shown in the upper-right
 * corner of Schedule Board cards and Booking Queue rows. It performs no data
 * fetching and reads only the currently assigned employee count and the number
 * of open (unassigned) staffing slots.
 *
 * Display rules (icon is intentionally secondary to the number):
 * - 1 assigned          → single-person icon + "1"
 * - 2 assigned          → group icon + "2"
 * - 3+ assigned         → group icon with a "+" affordance + the count
 * - any assigned + open → an additional "+N" open-slot affordance
 * - 0 assigned + open   → only the "+N" open-slot affordance (no person icon)
 * - 0 assigned + 0 open → nothing to render
 *
 * Open slots are NEVER folded into the assigned count.
 */
export type StaffingIndicatorIcon = "single" | "group" | "none";

export interface StaffingIndicator {
  /** Currently assigned employees (open slots excluded). */
  readonly assignedCount: number;
  /** Open / unassigned staffing slots. */
  readonly openSlots: number;
  /** Which person glyph to render. */
  readonly icon: StaffingIndicatorIcon;
  /** Whether the group icon shows the "3 or more" plus affordance. */
  readonly showGroupPlus: boolean;
  /** The assigned-count label, or null when no employees are assigned. */
  readonly countLabel: string | null;
  /** The open-slot affordance label (e.g. "+1"), or null when none. */
  readonly openSlotLabel: string | null;
  /** True when the indicator has anything at all to display. */
  readonly hasContent: boolean;
}

export function resolveStaffingIndicator(
  assignedCountInput: number | null | undefined,
  openSlotsInput: number | null | undefined,
): StaffingIndicator {
  const assignedCount = Math.max(0, Math.floor(assignedCountInput ?? 0));
  const openSlots = Math.max(0, Math.floor(openSlotsInput ?? 0));

  const icon: StaffingIndicatorIcon =
    assignedCount === 0 ? "none" : assignedCount === 1 ? "single" : "group";
  const showGroupPlus = assignedCount >= 3;
  const countLabel = assignedCount > 0 ? String(assignedCount) : null;
  const openSlotLabel = openSlots > 0 ? `+${openSlots}` : null;
  const hasContent = assignedCount > 0 || openSlots > 0;

  return {
    assignedCount,
    openSlots,
    icon,
    showGroupPlus,
    countLabel,
    openSlotLabel,
    hasContent,
  };
}
