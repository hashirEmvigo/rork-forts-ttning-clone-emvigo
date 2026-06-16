import { cn } from "@/lib/utils";
import type { EntityStatus } from "@/types";

interface StatusBadgeProps {
  status: EntityStatus;
  className?: string;
}

/** Compact pill showing active/inactive state with a status dot. */
export function StatusBadge({ status, className }: StatusBadgeProps) {
  const isActive = status === "active";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        isActive
          ? "border-success/20 bg-success/10 text-success"
          : "border-border bg-muted text-muted-foreground",
        className,
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          isActive ? "bg-success" : "bg-muted-foreground/60",
        )}
      />
      {isActive ? "Active" : "Inactive"}
    </span>
  );
}
