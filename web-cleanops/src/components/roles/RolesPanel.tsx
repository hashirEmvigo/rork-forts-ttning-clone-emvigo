import { useMemo, useState } from "react";
import { Lock, MoreHorizontal, Pencil, Plus, Shield, Trash2, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RoleDialog } from "@/components/roles/RoleDialog";
import { RoleMembersDialog } from "@/components/roles/RoleMembersDialog";
import { RolePermissionsDialog } from "@/components/roles/RolePermissionsDialog";
import { useAssignedUsers } from "@/hooks/use-assigned-users";
import { permissionLabel } from "@/lib/permissions";
import { userHoldsRole } from "@/lib/employeeRoles";
import { activeAssignedUsers, type AssignedUser } from "@/lib/assignedUsersRoster";
import type { Role } from "@/types";

interface RolesPanelProps {
  /** Roles to display. */
  roles: Role[];
  /** Company these roles belong to when creating new ones (null = global template). */
  companyId: string | null;
  /** When false, the panel is view-only (e.g. Super Admin browsing other companies). */
  editable?: boolean;
  /** Hide the "New role" button (e.g. read-only cross-company view). */
  allowCreate?: boolean;
}

export function RolesPanel({
  roles,
  companyId,
  editable = true,
  allowCreate = true,
}: RolesPanelProps) {
  const { roster } = useAssignedUsers();
  const activeRoster = activeAssignedUsers(roster);
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const [editing, setEditing] = useState<Role | null>(null);
  const [viewingMembers, setViewingMembers] = useState<Role | null>(null);
  const [viewingPermissions, setViewingPermissions] = useState<Role | null>(null);

  /** Members per role id, derived once from the shared assigned-user roster. */
  const membersByRoleId = useMemo(() => {
    const map = new Map<string, AssignedUser[]>();
    for (const role of roles) {
      map.set(
        role.id,
        activeRoster.filter((member) => userHoldsRole(role, member)),
      );
    }
    return map;
  }, [roles, activeRoster]);

  const viewingMembersList = viewingMembers
    ? membersByRoleId.get(viewingMembers.id) ?? []
    : [];

  const sorted = useMemo(
    () =>
      [...roles].sort((a, b) => {
        if (a.isSystem !== b.isSystem) return a.isSystem ? -1 : 1;
        return a.name.localeCompare(b.name);
      }),
    [roles],
  );

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (role: Role) => {
    setEditing(role);
    setDialogOpen(true);
  };

  return (
    <div>
      {allowCreate && editable ? (
        <div className="mb-4 flex justify-end">
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" /> New role
          </Button>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {sorted.map((role) => {
          const members = membersByRoleId.get(role.id) ?? [];
          const count = members.length;
          return (
            <div
              key={role.id}
              className="flex flex-col rounded-2xl border border-border bg-card p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                    <Shield className="h-4 w-4" />
                  </div>
                  <div className="leading-tight">
                    <p className="flex items-center gap-1.5 text-sm font-semibold">
                      {role.name}
                      {role.isSystem ? (
                        <Lock className="h-3 w-3 text-muted-foreground" aria-label="Built-in role" />
                      ) : null}
                    </p>
                    <button
                      type="button"
                      onClick={() => setViewingMembers(role)}
                      className="-mx-1 -my-0.5 rounded px-1 py-0.5 text-left text-xs text-muted-foreground transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {count} {count === 1 ? "member" : "members"}
                    </button>
                  </div>
                </div>

                {editable ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEdit(role)}>
                        <Pencil className="h-4 w-4" /> Edit role
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled>
                        <UserPlus className="h-4 w-4" /> Assign users (deferred)
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled className="text-muted-foreground">
                        <Trash2 className="h-4 w-4" /> Delete role (deferred)
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>

              {role.description ? (
                <p className="mt-3 text-sm text-muted-foreground">{role.description}</p>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-1.5">
                {role.permissions.length === 0 ? (
                  <span className="text-xs text-muted-foreground">No permissions granted</span>
                ) : (
                  role.permissions.slice(0, 4).map((key) => (
                    <span
                      key={key}
                      className="rounded-md border border-border bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground"
                    >
                      {permissionLabel(key)}
                    </span>
                  ))
                )}
                {role.permissions.length > 4 ? (
                  <button
                    type="button"
                    onClick={() => setViewingPermissions(role)}
                    className="rounded-md border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    +{role.permissions.length - 4} more
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <RoleDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        companyId={companyId}
        role={editing}
      />
      <RoleMembersDialog
        open={Boolean(viewingMembers)}
        onOpenChange={(open) => !open && setViewingMembers(null)}
        roleName={viewingMembers?.name ?? ""}
        members={viewingMembersList}
      />
      <RolePermissionsDialog
        open={Boolean(viewingPermissions)}
        onOpenChange={(open) => !open && setViewingPermissions(null)}
        roleName={viewingPermissions?.name ?? ""}
        description={viewingPermissions?.description}
        permissions={viewingPermissions?.permissions ?? []}
      />
    </div>
  );
}
