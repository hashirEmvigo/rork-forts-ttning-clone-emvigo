import { User, Users } from "lucide-react";

import { resolveStaffingIndicator } from "@/lib/staffingIndicator";
import { cn } from "@/lib/utils";

/**
 * Compact, scannable staffing indicator for the upper-right corner of Schedule
 * Board cards and Booking Queue rows. The number is the primary information; the
 * person glyph is intentionally subtle. Open staffing slots are shown as a
 * separate amber "+N" affordance and are never counted as assigned employees.
 *
 * This is a presentation-only component — see {@link resolveStaffingIndicator}
 * for the (tested, pure) display logic. It also future-proofs the slot for
 * staffing warnings, availability conflicts and scheduling recommendations.
 */
export function StaffingIndicator({
  assignedCount,
  openSlots,
  className,
}: {
  assignedCount: number;
  openSlots: number;
  className?: string;
}) {
  const indicator = resolveStaffingIndicator(assignedCount, openSlots);
  if (!indicator.hasContent) return null;

  const Icon = indicator.icon === "single" ? User : Users;

  return (
    <span
      className={cn("inline-flex items-center gap-1 tabular-nums", className)}
      aria-label={`${indicator.assignedCount} assigned${
        indicator.openSlots > 0 ? `, ${indicator.openSlots} open` : ""
      }`}
    >
      {indicator.countLabel ? (
        <span className="inline-flex items-center gap-0.5 text-muted-foreground">
          <Icon className="h-3 w-3 shrink-0 opacity-60" strokeWidth={2} />
          {indicator.showGroupPlus ? (
            <span className="text-[9px] font-semibold leading-none opacity-60">+</span>
          ) : null}
          <span className="text-[11px] font-semibold leading-none text-foreground">
            {indicator.countLabel}
          </span>
        </span>
      ) : null}
      {indicator.openSlotLabel ? (
        <span className="text-[11px] font-semibold leading-none text-amber-600">
          {indicator.openSlotLabel}
        </span>
      ) : null}
    </span>
  );
}
