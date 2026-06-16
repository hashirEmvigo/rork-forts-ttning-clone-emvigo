import { cn } from "@/lib/utils";
import { ROLE_LABELS, type UserRole } from "@/types";

const ROLE_STYLES: Record<UserRole, string> = {
  super_admin: "border-primary/20 bg-primary/10 text-primary",
  company_admin: "border-accent-foreground/20 bg-accent text-accent-foreground",
  employee: "border-border bg-secondary text-secondary-foreground",
  customer: "border-warning/20 bg-warning/10 text-warning",
};

/** Color-coded pill for a user role. */
export function RoleBadge({ role, className }: { role: UserRole; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        ROLE_STYLES[role],
        className,
      )}
    >
      {ROLE_LABELS[role]}
    </span>
  );
}
