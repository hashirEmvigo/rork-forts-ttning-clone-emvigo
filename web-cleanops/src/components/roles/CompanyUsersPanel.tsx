import { useState } from "react";
import { Users } from "lucide-react";

import { AssignedUsersTable } from "@/components/roles/AssignedUsersTable";

/**
 * Company Admin "Users" section for Settings → Roles & Permissions. Surfaces the
 * same assigned-user directory and lifecycle actions (resend invite, send
 * password reset, disable / enable) as the Super Admin view, but scoped to the
 * admin's own company: the roster is already company-scoped by
 * {@link import("@/hooks/use-assigned-users").useAssignedUsers}, and the table is
 * rendered in `singleCompany` mode so the redundant Company filter/column are
 * hidden. Server-side authorization still re-checks company scope.
 */
export function CompanyUsersPanel() {
  const [roleFilter, setRoleFilter] = useState<string>("all");

  return (
    <div>
      <div className="mb-4 flex items-center gap-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <Users className="h-4 w-4" />
        </div>
        <div className="leading-tight">
          <h3 className="text-sm font-semibold text-foreground">Users</h3>
          <p className="text-xs text-muted-foreground">
            Manage your team's access — resend invites, send password resets, and enable or
            disable accounts.
          </p>
        </div>
      </div>

      <AssignedUsersTable
        companyFilter="all"
        onCompanyFilterChange={() => {}}
        roleFilter={roleFilter}
        onRoleFilterChange={setRoleFilter}
        singleCompany
      />
    </div>
  );
}
