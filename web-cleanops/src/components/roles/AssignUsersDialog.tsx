import { useMemo, useState } from "react";
import { Check, Search } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { initials } from "@/lib/format";
import { userHoldsRole } from "@/lib/employeeRoles";
import type { Role } from "@/types";

interface AssignUsersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: Role | null;
}

/** Assign users within the role's company to that role. */
export function AssignUsersDialog({ open, onOpenChange, role }: AssignUsersDialogProps) {
  const { users, roles, assignUserRole } = useApp();
  const { toast } = useToast();
  const [query, setQuery] = useState<string>("");

  const candidates = useMemo(
    () => users.filter((u) => u.companyId === (role?.companyId ?? null)),
    [users, role?.companyId],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter(
      (u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
    );
  }, [candidates, query]);

  if (!role) return null;

  const roleNameFor = (roleId: string | null | undefined): string | null => {
    if (!roleId) return null;
    return roles.find((r) => r.id === roleId)?.name ?? null;
  };

  const handleAssign = (userId: string, userName: string) => {
    // Guard against duplicate assignment: a user who already holds this role
    // (by explicit roleId or matching base role) must never be re-assigned.
    const target = candidates.find((u) => u.id === userId);
    if (target && userHoldsRole(role, target)) return;
    assignUserRole(userId, role.id);
    toast({ title: "Role assigned", description: `${userName} is now a ${role.name}.` });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="border-b border-border px-6 py-5">
          <DialogTitle>Assign users to {role.name}</DialogTitle>
          <DialogDescription>
            Choose who should take on this role. They inherit its permissions instantly.
          </DialogDescription>
        </DialogHeader>

        <div className="border-b border-border px-6 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search people…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        <ul className="max-h-80 divide-y divide-border overflow-y-auto">
          {filtered.length === 0 ? (
            <li className="px-6 py-10 text-center text-sm text-muted-foreground">
              No people to assign here yet.
            </li>
          ) : (
            filtered.map((user) => {
              // Single shared rule: a user holds the role via an explicit custom
              // roleId OR via the matching built-in role for their base role —
              // the same matcher the role count and member list use.
              const isCurrent = userHoldsRole(role, user);
              const currentRole = roleNameFor(user.roleId);
              return (
                <li key={user.id} className="flex items-center gap-3 px-6 py-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
                    {initials(user.name)}
                  </div>
                  <div className="min-w-0 flex-1 leading-tight">
                    <p className="truncate text-sm font-medium">{user.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {currentRole ? currentRole : "No role assigned"}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isCurrent}
                    onClick={() => handleAssign(user.id, user.name)}
                    className={cn(
                      isCurrent &&
                        "pointer-events-none border-blue-200 bg-blue-50 text-blue-700 disabled:opacity-100 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300",
                    )}
                  >
                    {isCurrent ? (
                      <>
                        <Check className="h-4 w-4" /> Assigned
                      </>
                    ) : (
                      "Assign"
                    )}
                  </Button>
                </li>
              );
            })
          )}
        </ul>

        <DialogFooter className="border-t border-border px-6 py-4">
          <Button type="button" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
