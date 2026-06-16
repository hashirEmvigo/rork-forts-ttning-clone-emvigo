import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { WORK_ORDER_SERVICE_STATUS_LABELS } from "@/types";
import type { WorkOrderServiceStatus } from "@/types";
import { WORK_ORDER_BADGE_CLASS } from "@/components/WorkOrderStatusBadge";

const VARIANT: Record<WorkOrderServiceStatus, "default" | "secondary" | "outline"> = {
  planned: "default",
  in_progress: "default",
  completed: "secondary",
  inactive: "outline",
};

/** Renders a uniformly-sized status badge for a work-order service row. */
export function WorkOrderServiceStatusBadge({ status }: { status: WorkOrderServiceStatus }) {
  return (
    <Badge
      variant={VARIANT[status]}
      className={cn(WORK_ORDER_BADGE_CLASS, status === "inactive" && "text-muted-foreground")}
    >
      {WORK_ORDER_SERVICE_STATUS_LABELS[status]}
    </Badge>
  );
}
