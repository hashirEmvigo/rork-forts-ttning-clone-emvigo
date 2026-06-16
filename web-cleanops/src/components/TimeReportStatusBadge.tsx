import { CheckCircle2, Clock3 } from "lucide-react";

import { cn } from "@/lib/utils";
import { TIME_REPORT_APPROVAL_STATUS_LABELS } from "@/types";
import type { TimeReportApprovalStatus } from "@/types";
import { WORK_ORDER_BADGE_CLASS } from "@/components/WorkOrderStatusBadge";

const STYLE: Record<TimeReportApprovalStatus, string> = {
  auto_approved: "border-transparent bg-success/10 text-success",
  pending_admin_approval: "border-transparent bg-warning/10 text-warning",
};

const ICON: Record<TimeReportApprovalStatus, typeof CheckCircle2> = {
  auto_approved: CheckCircle2,
  pending_admin_approval: Clock3,
};

/** Renders a uniformly-sized status badge for an employee time report. */
export function TimeReportStatusBadge({ status }: { status: TimeReportApprovalStatus }) {
  const Icon = ICON[status];
  return (
    <span className={cn(WORK_ORDER_BADGE_CLASS, "gap-1 border", STYLE[status])}>
      <Icon className="h-3.5 w-3.5" />
      {TIME_REPORT_APPROVAL_STATUS_LABELS[status]}
    </span>
  );
}
