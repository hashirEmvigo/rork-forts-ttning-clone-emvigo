import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Building2, CheckCircle2, Plus, UserCog, Users } from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { StatCard } from "@/components/dashboard/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { CompanyDialog } from "@/components/companies/CompanyDialog";
import { useApp } from "@/context/AppContext";
import { useDirectoryProfiles } from "@/hooks/use-directory-profiles";
import { formatDate } from "@/lib/format";

/**
 * Temporary deploy/runtime diagnostic marker. If this string is NOT visible on
 * the Overview in the deployed preview, the environment is serving a stale
 * bundle that predates the Agreement Templates route. Safe to remove once the
 * routing/deploy issue is confirmed resolved.
 */
const BUILD_MARKER = "diag-2026-06-03-agreement-templates";

export default function SuperAdminDashboard() {
  const { currentUser, companies, hasPermission } = useApp();
  // Supabase profiles are the authority for platform user/admin counts — not the
  // localStorage `users` collection, which is empty/stale and showed 0 before.
  const { profiles } = useDirectoryProfiles();
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);

  const canManageTemplates = hasPermission("settings_templates.manage");

  // Platform-wide counts:
  //  - Users: every Supabase profile (auth/profile users across all companies).
  //  - Company admins: profiles with base_role company_admin across all companies.
  const stats = useMemo(() => {
    const active = companies.filter((c) => c.status === "active").length;
    const admins = profiles.filter((p) => p.baseRole === "company_admin").length;
    return {
      total: companies.length,
      active,
      inactive: companies.length - active,
      users: profiles.length,
      admins,
    };
  }, [companies, profiles]);

  const recent = useMemo(
    () =>
      [...companies]
        .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
        .slice(0, 5),
    [companies],
  );

  return (
    <DashboardLayout>
      <PageHeader
        title={`Good to see you, ${currentUser?.name.split(" ")[0]}`}
        description="A platform-wide view of every cleaning company and their teams."
        action={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4" /> New company
          </Button>
        }
      />

      <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-900">
        <p className="font-semibold uppercase tracking-wide">Runtime diagnostic (temporary)</p>
        <ul className="mt-2 space-y-1 font-mono">
          <li>build marker: {BUILD_MARKER}</li>
          <li>role: {currentUser?.role ?? "(none)"}</li>
          <li>settings_templates.manage: {canManageTemplates ? "true" : "false"}</li>
          <li>
            agreement-templates nav visible:{" "}
            {currentUser?.role === "super_admin" && canManageTemplates ? "true" : "false"}
          </li>
        </ul>
        <a href="/agreement-templates" className="mt-2 inline-block font-semibold underline">
          Open /agreement-templates
        </a>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Companies" value={stats.total} icon={Building2} hint={`${stats.inactive} inactive`} />
        <StatCard label="Active companies" value={stats.active} icon={CheckCircle2} hint="Currently operating" />
        <StatCard label="Total users" value={stats.users} icon={Users} hint="Profiles across all companies" />
        <StatCard label="Company admins" value={stats.admins} icon={UserCog} hint="Managing their teams" />
      </div>

      <div className="mt-8 overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">Recently added companies</h2>
            <p className="text-xs text-muted-foreground">The latest organisations to join the platform.</p>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link to="/companies">View all</Link>
          </Button>
        </div>
        <ul className="divide-y divide-border">
          {recent.map((company) => (
            <li key={company.id} className="flex items-center gap-4 px-5 py-3.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                <Building2 className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{company.name}</p>
                <p className="font-mono text-xs text-muted-foreground">{company.id}</p>
              </div>
              <span className="hidden text-xs text-muted-foreground sm:block">
                {formatDate(company.createdAt)}
              </span>
              <StatusBadge status={company.status} />
            </li>
          ))}
        </ul>
      </div>

      <CompanyDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </DashboardLayout>
  );
}
