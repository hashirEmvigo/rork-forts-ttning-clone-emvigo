import { useMemo, useState } from "react";
import { Building2, LayoutGrid, ShieldCheck, Users } from "lucide-react";

import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PageMenuTiles, type PageMenuTileItem } from "@/components/navigation/PageMenuTiles";
import { RoleTemplatesGrid } from "@/components/roles/RoleTemplatesGrid";
import { RolesPanel } from "@/components/roles/RolesPanel";
import { CompanyAssignmentsTable } from "@/components/roles/CompanyAssignmentsTable";
import { PermissionMatrixTable } from "@/components/roles/PermissionMatrixTable";
import { AssignedUsersTable } from "@/components/roles/AssignedUsersTable";
import { useApp } from "@/context/AppContext";
import { selectCustomGlobalTemplates } from "@/lib/companyRoleSeed";
import type { UserRole } from "@/types";

type RoleSection = "templates" | "companies" | "matrix" | "users";

/**
 * Section menu (Slice 11E) — shared icon-above-label tile standard. Long labels
 * are shortened ("Role Templates" → "Templates", "Company Assignments" →
 * "Companies", "Permission Matrix" → "Matrix", "Assigned Users" → "Users") so
 * tiles stay equal-sized; the SECTION_BLURB below still describes each section.
 */
const ROLE_SECTION_ITEMS: PageMenuTileItem[] = [
  { value: "templates", label: "Templates", icon: LayoutGrid },
  { value: "companies", label: "Companies", icon: Building2 },
  { value: "matrix", label: "Matrix", icon: ShieldCheck },
  { value: "users", label: "Users", icon: Users },
];

const SECTION_BLURB: Record<RoleSection, string> = {
  templates: "Manage the platform's role definitions and what each one grants.",
  companies: "See how roles are distributed across every company.",
  matrix: "Compare and audit every permission across all roles at a glance.",
  users: "Find exactly who holds each role, with company and status filters.",
};

/**
 * Super Admin Roles & Permissions experience, organised into four focused
 * sections: role templates, company assignments, the permission matrix, and the
 * assigned-users directory. Replaces the old card wall that mixed all concerns.
 */
export function SuperAdminRolesView() {
  const { roles } = useApp();
  const [section, setSection] = useState<RoleSection>("templates");
  const [userCompanyFilter, setUserCompanyFilter] = useState<string>("all");
  const [userRoleFilter, setUserRoleFilter] = useState<string>("all");

  // Custom global templates (e.g. "Prospect") that are not one of the four base
  // roles the grid renders. Surfaced here so the Super Admin can see and
  // configure their permissions alongside the built-in templates.
  const customTemplates = useMemo(() => selectCustomGlobalTemplates(roles), [roles]);

  const goToAssignedUsers = (role: UserRole) => {
    setUserRoleFilter(role);
    setUserCompanyFilter("all");
    setSection("users");
  };

  const goToCompanyUsers = (companyId: string) => {
    setUserCompanyFilter(companyId);
    setUserRoleFilter("all");
    setSection("users");
  };

  return (
    <Tabs value={section} onValueChange={(v) => setSection(v as RoleSection)} className="w-full">
      <PageMenuTiles items={ROLE_SECTION_ITEMS} ariaLabel="Roles sections" testId="roles-section-tiles" />

      <p className="mt-3 text-sm text-muted-foreground">{SECTION_BLURB[section]}</p>

      <TabsContent value="templates" className="mt-4">
        <RoleTemplatesGrid onViewAssignedUsers={goToAssignedUsers} />
        {customTemplates.length > 0 ? (
          <div className="mt-8">
            <h3 className="text-sm font-semibold text-foreground">Additional templates</h3>
            <p className="mt-1 mb-3 text-sm text-muted-foreground">
              Configurable role templates beyond the platform base roles. Edit their
              permissions here; every company inherits its own copy.
            </p>
            <RolesPanel roles={customTemplates} companyId={null} editable allowCreate={false} />
          </div>
        ) : null}
      </TabsContent>

      <TabsContent value="companies" className="mt-4">
        <CompanyAssignmentsTable onViewCompanyUsers={goToCompanyUsers} />
      </TabsContent>

      <TabsContent value="matrix" className="mt-4">
        <PermissionMatrixTable />
      </TabsContent>

      <TabsContent value="users" className="mt-4">
        <AssignedUsersTable
          companyFilter={userCompanyFilter}
          onCompanyFilterChange={setUserCompanyFilter}
          roleFilter={userRoleFilter}
          onRoleFilterChange={setUserRoleFilter}
        />
      </TabsContent>
    </Tabs>
  );
}
