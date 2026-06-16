import { cn } from "@/lib/utils";
import type { CustomerProtocolStatus } from "@/types";

interface ProtocolStatusBadgeProps {
  status: CustomerProtocolStatus;
  className?: string;
}

const STYLES: Record<CustomerProtocolStatus, { label: string; classes: string; dot: string }> = {
  draft: {
    label: "Draft",
    classes: "border-amber-500/20 bg-amber-500/10 text-amber-600",
    dot: "bg-amber-500",
  },
  active: {
    label: "Active",
    classes: "border-success/20 bg-success/10 text-success",
    dot: "bg-success",
  },
  archived: {
    label: "Archived",
    classes: "border-border bg-muted text-muted-foreground",
    dot: "bg-muted-foreground/60",
  },
  inactive_customer: {
    label: "Inactive customer",
    classes: "border-destructive/20 bg-destructive/10 text-destructive",
    dot: "bg-destructive",
  },
};

/** Compact pill showing a customer protocol's lifecycle status. */
export function ProtocolStatusBadge({ status, className }: ProtocolStatusBadgeProps) {
  const style = STYLES[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        style.classes,
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", style.dot)} />
      {style.label}
    </span>
  );
}
