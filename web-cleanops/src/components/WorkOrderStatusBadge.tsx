import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { WORK_ORDER_STATUS_LABELS } from "@/types";
import type { WorkOrderStatus } from "@/types";

/** Shared base class giving every work-order status badge a consistent size. */
export const WORK_ORDER_BADGE_CLASS =
  "inline-flex h-6 min-w-[88px] items-center justify-center whitespace-nowrap rounded-full px-2.5 py-0 text-xs font-medium";

const VARIANT: Record<WorkOrderStatus, "default" | "secondary" | "outline"> = {
  draft: "outline",
  planned: "default",
  in_progress: "default",
  completed: "secondary",
  inactive: "outline",
};

/** Renders a uniformly-sized status badge for a work order. */
export function WorkOrderStatusBadge({ status }: { status: WorkOrderStatus }) {
  return (
    <Badge
      variant={VARIANT[status]}
      className={cn(WORK_ORDER_BADGE_CLASS, status === "inactive" && "text-muted-foreground")}
    >
      {WORK_ORDER_STATUS_LABELS[status]}
    </Badge>
  );
}
