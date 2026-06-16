import { CircleCheck, CircleHelp, CircleSlash, TriangleAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  PreferredTimeEvaluationResult,
  PreferredTimeStatus,
} from "@/lib/evaluatePreferredTime";
import { cn } from "@/lib/utils";

/**
 * Visual presentation for a {@link PreferredTimeStatus}. `none` is intentionally
 * absent — it must render nothing so rows without preferences stay clean.
 */
const STATUS_META: Record<
  Exclude<PreferredTimeStatus, "none">,
  { label: string; icon: LucideIcon; className: string }
> = {
  optimal: {
    label: "Optimal time",
    icon: CircleCheck,
    className: "text-emerald-600 dark:text-emerald-400",
  },
  acceptable: {
    label: "Acceptable time",
    icon: TriangleAlert,
    className: "text-amber-500 dark:text-amber-400",
  },
  outside_range: {
    label: "Outside approved time range",
    icon: CircleSlash,
    className: "text-red-600 dark:text-red-400",
  },
  not_evaluated: {
    label: "Time could not be evaluated",
    icon: CircleHelp,
    className: "text-muted-foreground",
  },
};

interface PreferredTimeStatusIconProps {
  result: PreferredTimeEvaluationResult;
  /** Hide the neutral `not_evaluated` icon. Defaults to showing it. */
  hideNotEvaluated?: boolean;
  className?: string;
}

/**
 * Reusable status indicator for the optional Preferred Time Evaluation add-on.
 * Renders a colour-coded icon with an accessible label and a tooltip that
 * includes the evaluator's reason text. Decoupled from any screen so it can be
 * reused across Work Order services, the future Schedule module and the Booking
 * Queue. Renders nothing for the `none` status (no preferences configured) — the
 * caller is responsible for gating on feature availability.
 */
export function PreferredTimeStatusIcon({
  result,
  hideNotEvaluated = false,
  className,
}: PreferredTimeStatusIconProps) {
  if (result.status === "none") return null;
  if (result.status === "not_evaluated" && hideNotEvaluated) return null;

  const meta = STATUS_META[result.status];
  const Icon = meta.icon;
  const tooltip = result.reason ? `${meta.label} — ${result.reason}` : meta.label;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label={meta.label}
          className={cn("inline-flex shrink-0 items-center", meta.className, className)}
        >
          <Icon className="h-4 w-4" />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[16rem]">{tooltip}</TooltipContent>
    </Tooltip>
  );
}
