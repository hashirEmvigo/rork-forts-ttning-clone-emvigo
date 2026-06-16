import {
  ArrowRightLeft,
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  Hourglass,
  PencilLine,
  Sparkles,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type {
  BookingModifierBadge as BookingModifierModel,
  BookingStatusColor,
  BookingStatusIcon,
  ConfirmationStatusBadge as ConfirmationStatusModel,
  OperationalStatusBadge as OperationalStatusModel,
} from "@/lib/bookingStatus";

/** Maps a platform-agnostic icon key to its lucide-react component. */
const ICONS: Record<BookingStatusIcon, LucideIcon> = {
  cancelled: XCircle,
  rebooked: ArrowRightLeft,
  variation: Sparkles,
  scheduled: CalendarCheck,
  unscheduled: CalendarClock,
  changed: PencilLine,
  "auto-confirmed": CheckCircle2,
  "needs-confirmation": Hourglass,
};

/** Maps a semantic colour token to its badge classes. */
const COLOR_CLASS: Record<BookingStatusColor, string> = {
  red: "border-transparent bg-destructive text-destructive-foreground",
  blue: "border-blue-200 bg-blue-50 text-blue-700",
  violet: "border-violet-300 bg-violet-50 text-violet-700",
  green: "border-emerald-200 bg-emerald-50 text-emerald-700",
  orange: "border-amber-300 bg-amber-50 text-amber-700",
  neutral: "border-border bg-muted text-muted-foreground",
};

function StatusBadge({
  color,
  icon,
  label,
  tooltip,
}: {
  color: BookingStatusColor;
  icon: BookingStatusIcon;
  label: string;
  tooltip?: string;
}) {
  const Icon = ICONS[icon];
  const badge = (
    <Badge className={cn("gap-1", COLOR_CLASS[color])}>
      <Icon className="h-3 w-3" />
      {label}
    </Badge>
  );
  if (!tooltip) return badge;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{badge}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[16rem] whitespace-pre-line">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

/** Renders the single operational status badge (cancelled/rebooked/variation/…). */
export function BookingOperationalStatusBadge({ status }: { status: OperationalStatusModel }) {
  return (
    <StatusBadge
      color={status.color}
      icon={status.icon}
      label={status.label}
      tooltip={status.tooltip}
    />
  );
}

/** Maps a semantic colour token to its smaller modifier-chip classes. */
const MODIFIER_COLOR_CLASS: Record<BookingStatusColor, string> = {
  red: "border-red-200 bg-red-50 text-red-700",
  blue: "border-blue-200 bg-blue-50 text-blue-700",
  violet: "border-violet-200 bg-violet-50 text-violet-700",
  green: "border-emerald-200 bg-emerald-50 text-emerald-700",
  orange: "border-amber-300 bg-amber-50 text-amber-700",
  neutral: "border-border bg-muted text-muted-foreground",
};

/**
 * A modifier chip — smaller and lighter than the primary operational badge so it
 * never visually competes with it. Used for Changed / Auto / Pending.
 */
function ModifierChip({ modifier }: { modifier: BookingModifierModel }) {
  const Icon = ICONS[modifier.icon];
  const chip = (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-none",
        MODIFIER_COLOR_CLASS[modifier.color],
      )}
    >
      <Icon className="h-2.5 w-2.5" />
      {modifier.label}
    </span>
  );
  if (!modifier.tooltip) return chip;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{chip}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[16rem] whitespace-pre-line">
        {modifier.tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Renders the ordered list of booking modifiers (Changed, then Auto / Pending)
 * as small secondary chips. Renders nothing when the list is empty.
 */
export function BookingModifiers({ modifiers }: { modifiers: BookingModifierModel[] }) {
  if (modifiers.length === 0) return null;
  return (
    <span className="inline-flex flex-col items-start gap-1">
      {modifiers.map((modifier) => (
        <ModifierChip key={modifier.modifier} modifier={modifier} />
      ))}
    </span>
  );
}

/** Renders the optional confirmation status badge (auto-confirmed/needs confirmation). */
export function BookingConfirmationStatusBadge({
  status,
}: {
  status: ConfirmationStatusModel;
}) {
  return (
    <StatusBadge
      color={status.color}
      icon={status.icon}
      label={status.label}
      tooltip={status.tooltip}
    />
  );
}

/**
 * Renders the two independent status layers together: the operational status
 * (always shown) and, when present, the confirmation status beneath it. The
 * confirmation badge is suppressed for cancelled bookings — there is nothing to
 * confirm. Used by the Booking Queue Schedule column and reusable across the
 * future Schedule, Mobile App, Customer Portal and Booking Details surfaces.
 */
export function BookingStatusBadges({
  operational,
  confirmation,
}: {
  operational: OperationalStatusModel;
  confirmation?: ConfirmationStatusModel | null;
}) {
  const showConfirmation = confirmation && operational.status !== "cancelled";
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <BookingOperationalStatusBadge status={operational} />
      {showConfirmation ? <BookingConfirmationStatusBadge status={confirmation} /> : null}
    </span>
  );
}
