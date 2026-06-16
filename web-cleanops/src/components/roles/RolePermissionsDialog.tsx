import { useMemo } from "react";
import { Check, Minus, Shield } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PERMISSION_MODULES } from "@/lib/permissions";

interface RolePermissionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Display name of the role being inspected. */
  roleName: string;
  /** Optional description shown under the title. */
  description?: string;
  /** The permission keys this role grants. */
  permissions: string[];
}

/**
 * Read-only overview of a single role's permissions, grouped by module. Used
 * from the Role Templates tab so a Super Admin can audit a role without opening
 * the edit dialog.
 */
export function RolePermissionsDialog({
  open,
  onOpenChange,
  roleName,
  description,
  permissions,
}: RolePermissionsDialogProps) {
  const granted = useMemo(() => new Set(permissions), [permissions]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="border-b border-border px-6 py-5">
          <DialogTitle className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Shield className="h-4 w-4" />
            </span>
            {roleName} permissions
          </DialogTitle>
          <DialogDescription>
            {description?.trim()
              ? description
              : `${granted.size} permission${granted.size === 1 ? "" : "s"} granted across the platform.`}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto px-6 py-5">
          {PERMISSION_MODULES.map((module) => {
            const moduleGranted = module.permissions.filter((p) => granted.has(p.key));
            return (
              <div key={module.id}>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm font-semibold">{module.label}</p>
                  <span className="text-xs text-muted-foreground">
                    {moduleGranted.length}/{module.permissions.length}
                  </span>
                </div>
                <ul className="mt-2 space-y-1">
                  {module.permissions.map((p) => {
                    const has = granted.has(p.key);
                    return (
                      <li
                        key={p.key}
                        className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm odd:bg-muted/30"
                      >
                        <span
                          className={
                            has ? "text-foreground" : "text-muted-foreground/70 line-through"
                          }
                        >
                          {p.label}
                        </span>
                        {has ? (
                          <Check className="h-4 w-4 shrink-0 text-success" aria-label="Granted" />
                        ) : (
                          <Minus
                            className="h-4 w-4 shrink-0 text-muted-foreground/40"
                            aria-label="Not granted"
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
