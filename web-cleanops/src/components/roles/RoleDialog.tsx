import { useEffect, useMemo, useState } from "react";

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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/hooks/use-toast";
import { useRoleMutations } from "@/hooks/use-role-mutations";
import { cn } from "@/lib/utils";
import { PERMISSION_MODULES } from "@/lib/permissions";
import type { Role } from "@/types";

interface RoleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Company the role belongs to, or null for a global template. */
  companyId: string | null;
  /** Pass a role to edit; omit to create a new one. */
  role?: Role | null;
}

/** Create or edit a role and choose which features the role can access. */
export function RoleDialog({ open, onOpenChange, companyId, role }: RoleDialogProps) {
  const { currentUser, hasPermission } = useApp();
  const { toast } = useToast();
  const mutations = useRoleMutations({
    companyId,
    isSuperAdmin: currentUser?.role === "super_admin",
    canManageRoles: Boolean(currentUser) && hasPermission("roles.manage"),
  });
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [permissions, setPermissions] = useState<string[]>([]);
  const [error, setError] = useState<string>("");
  const isEdit = Boolean(role);
  const lockName = Boolean(role?.isSystem);

  useEffect(() => {
    if (open) {
      setName(role?.name ?? "");
      setDescription(role?.description ?? "");
      setPermissions(role?.permissions ?? []);
      setError("");
    }
  }, [open, role]);

  const selected = useMemo(() => new Set(permissions), [permissions]);

  const toggle = (key: string) => {
    setPermissions((prev) =>
      prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key],
    );
  };

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (mutations.isPending) return;
    setError("");
    if (!name.trim()) {
      setError("Role name is required.");
      return;
    }

    try {
      if (role) {
        const patch = lockName
          ? { description: description.trim(), permissions }
          : { name: name.trim(), description: description.trim(), permissions };
        await mutations.updateRole({ role, patch });
        toast({ title: "Role updated", description: `${name.trim()} has been saved.` });
      } else {
        await mutations.createCompanyRole({
          name: name.trim(),
          description: description.trim(),
          permissions,
        });
        toast({ title: "Role created", description: `${name.trim()} is ready to assign.` });
      }
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to save role.";
      setError(message);
      toast({ title: "Couldn't save role", description: message, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!mutations.isPending) onOpenChange(next); }}>
      <DialogContent className="max-h-[90vh] gap-0 overflow-hidden p-0 sm:max-w-lg">
        <form onSubmit={handleSubmit} className="flex max-h-[90vh] flex-col">
          <DialogHeader className="border-b border-border px-6 py-5">
            <DialogTitle>{isEdit ? "Edit role" : "Create role"}</DialogTitle>
            <DialogDescription>
              Name the role and choose which features it can access.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
            <div className="space-y-1.5">
              <Label htmlFor="role-name">Role name</Label>
              <Input
                id="role-name"
                placeholder="e.g. Site Supervisor"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={lockName}
                autoFocus={!lockName}
                required
              />
              {lockName ? (
                <p className="text-xs text-muted-foreground">
                  Built-in roles keep their name; you can still adjust permissions.
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="role-desc">Description</Label>
              <Textarea
                id="role-desc"
                placeholder="What is this role responsible for?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label>Permissions</Label>
              <p className="text-xs text-muted-foreground">
                These control both the menu items shown and the pages and actions this role can use.
              </p>
              <div className="space-y-2 pt-1">
                {PERMISSION_MODULES.map((module) => (
                  <div
                    key={module.id}
                    className={cn(
                      "rounded-xl border border-border bg-card",
                      module.comingSoon && "opacity-70",
                    )}
                  >
                    <div className="flex items-center justify-between gap-3 px-4 pt-3">
                      <div>
                        <p className="text-sm font-medium">
                          {module.label}
                          {module.comingSoon ? (
                            <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                              Soon
                            </span>
                          ) : null}
                        </p>
                        <p className="text-xs text-muted-foreground">{module.description}</p>
                      </div>
                    </div>
                    <div className="space-y-1 px-4 py-3">
                      {module.permissions.map((p) => (
                        <label
                          key={p.key}
                          htmlFor={p.key}
                          className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-1 py-1.5 text-sm"
                        >
                          <span className="text-foreground/90">{p.label}</span>
                          <Switch
                            id={p.key}
                            checked={selected.has(p.key)}
                            disabled={module.comingSoon}
                            onCheckedChange={() => toggle(p.key)}
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {error ? (
              <p
                className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                role="alert"
              >
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter className="border-t border-border px-6 py-4">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={mutations.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutations.isPending}>
              {mutations.isPending ? "Saving…" : isEdit ? "Save changes" : "Create role"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
