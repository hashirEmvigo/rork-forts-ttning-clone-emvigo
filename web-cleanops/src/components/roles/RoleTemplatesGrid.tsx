import { useState } from "react";
import { Building2, Copy, Eye, Lock, MoreHorizontal, Pencil, Shield, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RoleDialog } from "@/components/roles/RoleDialog";
import { RoleMembersDialog } from "@/components/roles/RoleMembersDialog";
import { RolePermissionsDialog } from "@/components/roles/RolePermissionsDialog";
import { useApp } from "@/context/AppContext";
import { useAssignedUsers } from "@/hooks/use-assigned-users";
import { activeAssignedUsers } from "@/lib/assignedUsersRoster";
import {
  BASE_ROLE_ORDER,
  companyCountForBaseRole,
  findGlobalTemplate,
  permissionsForBaseRole,
  userCountForBaseRole,
} from "@/lib/rolesOverview";
import { ROLE_LABELS, type Role, type UserRole } from "@/types";

/** Fallback copy for base roles when a template carries no description. */
const ROLE_BLURB: Record<UserRole, string> = {
  super_admin: "Platform owners. Full access across every company and setting.",
  company_admin: "Run a single company — its team, customers and configuration.",
  employee: "On-the-ground staff who execute scheduled work and checklists.",
  customer: "Clients who view their own cleaning protocols and portal.",
};

interface RoleTemplatesGridProps {
  /** Jumps to the Assigned Users tab pre-filtered to a base role. */
  onViewAssignedUsers: (role: UserRole) => void;
}

interface MetricProps {
  icon: typeof Users;
  value: number | string;
  label: string;
  /** When provided, the whole metric becomes a button (e.g. drill into members). */
  onClick?: () => void;
}

function Metric({ icon: Icon, value, label, onClick }: MetricProps) {
  const content = (
    <>
      <Icon className="h-4 w-4 text-muted-foreground" />
      <div className="leading-none">
        <p className="text-sm font-semibold">{value}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{label}</p>
      </div>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex items-center gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2 text-left transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {content}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2">
      {content}
    </div>
  );
}

/**
 * The primary role-management surface: one card per platform base role with its
 * usage metrics and management actions. Replaces the old multi-section card wall.
 */
export function RoleTemplatesGrid({ onViewAssignedUsers }: RoleTemplatesGridProps) {
  const { roles } = useApp();
  const { roster } = useAssignedUsers();
  const activeRoster = activeAssignedUsers(roster);
  const [editing, setEditing] = useState<Role | null>(null);
  const [editOpen, setEditOpen] = useState<boolean>(false);
  const [viewing, setViewing] = useState<UserRole | null>(null);
  const [viewingMembers, setViewingMembers] = useState<UserRole | null>(null);

  const memberList = viewingMembers
    ? activeRoster.filter((member) => member.role === viewingMembers)
    : [];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {BASE_ROLE_ORDER.map((baseRole) => {
        const template = findGlobalTemplate(roles, baseRole);
        const permissions = permissionsForBaseRole(roles, baseRole);
        const userCount = userCountForBaseRole(activeRoster, baseRole);
        const companyCount = companyCountForBaseRole(activeRoster, baseRole);
        const description = template?.description?.trim() || ROLE_BLURB[baseRole];

        return (
          <div
            key={baseRole}
            className="flex flex-col rounded-2xl border border-border bg-card p-5 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Shield className="h-5 w-5" />
                </div>
                <div className="leading-tight">
                  <p className="flex items-center gap-1.5 text-base font-semibold">
                    {template?.name ?? ROLE_LABELS[baseRole]}
                    <Lock className="h-3 w-3 text-muted-foreground" aria-label="Built-in role" />
                  </p>
                  <p className="text-xs text-muted-foreground">Platform role template</p>
                </div>
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onClick={() => setViewing(baseRole)}>
                    <Eye className="h-4 w-4" /> View permissions
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!template}
                    onClick={() => {
                      if (!template) return;
                      setEditing(template);
                      setEditOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" /> Edit role
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled>
                    <Copy className="h-4 w-4" /> Duplicate role (deferred)
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => onViewAssignedUsers(baseRole)}>
                    <Users className="h-4 w-4" /> View assigned users
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <p className="mt-3 text-sm text-muted-foreground">{description}</p>

            <div className="mt-4 grid grid-cols-3 gap-2">
              <Metric
                icon={Users}
                value={userCount}
                label={userCount === 1 ? "user" : "users"}
                onClick={() => setViewingMembers(baseRole)}
              />
              <Metric
                icon={Building2}
                value={baseRole === "super_admin" ? "All" : companyCount}
                label={baseRole === "super_admin" ? "platform" : companyCount === 1 ? "company" : "companies"}
              />
              <Metric icon={Shield} value={permissions.length} label="permissions" />
            </div>

            <div className="mt-4 flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => setViewing(baseRole)}
              >
                <Eye className="h-4 w-4" /> Permissions
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => onViewAssignedUsers(baseRole)}
              >
                <Users className="h-4 w-4" /> Users
              </Button>
            </div>
          </div>
        );
      })}

      <RoleDialog open={editOpen} onOpenChange={setEditOpen} companyId={null} role={editing} />

      <RoleMembersDialog
        open={viewingMembers !== null}
        onOpenChange={(open) => !open && setViewingMembers(null)}
        roleName={
          viewingMembers
            ? findGlobalTemplate(roles, viewingMembers)?.name ?? ROLE_LABELS[viewingMembers]
            : ""
        }
        members={memberList}
      />

      <RolePermissionsDialog
        open={viewing !== null}
        onOpenChange={(open) => !open && setViewing(null)}
        roleName={viewing ? findGlobalTemplate(roles, viewing)?.name ?? ROLE_LABELS[viewing] : ""}
        description={viewing ? findGlobalTemplate(roles, viewing)?.description : undefined}
        permissions={viewing ? permissionsForBaseRole(roles, viewing) : []}
      />
    </div>
  );
}
