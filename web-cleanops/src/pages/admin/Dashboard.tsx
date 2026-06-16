import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Briefcase, Plus, ShieldCheck, UserCheck, Users } from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { StatCard } from "@/components/dashboard/StatCard";
import { RoleBadge } from "@/components/RoleBadge";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { UserDialog } from "@/components/users/UserDialog";
import { useApp } from "@/context/AppContext";
import { useDirectoryProfiles } from "@/hooks/use-directory-profiles";
import { useCustomerListSource } from "@/hooks/use-customer-list-source";
import { initials } from "@/lib/format";
import { perf } from "@/lib/perf";

export default function CompanyAdminDashboard() {
  // Dev-only render accounting (no-op in production).
  perf.count("Dashboard.render");
  const { currentUser, companies, employees, customers: localCustomers } = useApp();
  // Supabase profiles are the authority for company-admin identity counts — never
  // the localStorage `users` collection, which can be empty/stale per device.
  const { profiles } = useDirectoryProfiles();
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);

  const companyId = currentUser?.companyId ?? "";
  const company = useMemo(
    () => companies.find((c) => c.id === companyId) ?? null,
    [companies, companyId],
  );

  // Customer records exactly as the Customers page sees them (Supabase-authoritative
  // list source, then company-scoped) so the Overview count matches that page.
  const { customers: sourcedCustomers } = useCustomerListSource(localCustomers, companyId);

  // Overview counts, by their explicit definitions:
  //  - Company Admins: Supabase profiles with base_role company_admin in this company.
  //  - Employees: employee records shown on the Employees page (incl. logins-less).
  //  - Customers: customer records shown on the Customers page.
  //  - People: the sum of the three.
  const stats = useMemo(() => {
    const companyAdmins = profiles.filter(
      (p) => p.baseRole === "company_admin" && p.companyId === companyId,
    ).length;
    const employeeCount = employees.filter((e) => e.companyId === companyId).length;
    const customerCount = sourcedCustomers.filter((c) => c.companyId === companyId).length;
    return {
      companyAdmins,
      employeeCount,
      customerCount,
      people: companyAdmins + employeeCount + customerCount,
    };
  }, [profiles, employees, sourcedCustomers, companyId]);

  // "Recently added members" reads the SAME Supabase profile roster as the
  // Overview counts above — never the localStorage `users` collection — so both
  // surfaces agree on who belongs to this company. Scoped to the logged-in
  // company and ordered newest-first by profile creation time.
  const recentMembers = useMemo(
    () =>
      profiles
        .filter((p) => p.companyId === companyId)
        .sort((a, b) => +new Date(b.createdAt ?? 0) - +new Date(a.createdAt ?? 0))
        .slice(0, 5),
    [profiles, companyId],
  );

  return (
    <DashboardLayout>
      <PageHeader
        title={company?.name ?? "Your company"}
        description="Manage your team, roles and access from one place."
        action={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4" /> Add user
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="People" value={stats.people} icon={Users} hint="Admins, employees & customers" />
        <StatCard label="Company admins" value={stats.companyAdmins} icon={ShieldCheck} hint="Manage the company" />
        <StatCard label="Employees" value={stats.employeeCount} icon={Briefcase} hint="On the ground" />
        <StatCard label="Customers" value={stats.customerCount} icon={UserCheck} hint="Client accounts" />
      </div>

      <div className="mt-8 overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">Recently added members</h2>
            <p className="text-xs text-muted-foreground">The newest people in {company?.name ?? "your company"}.</p>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link to="/users">Manage team</Link>
          </Button>
        </div>
        <ul className="divide-y divide-border">
          {recentMembers.length === 0 ? (
            <li className="px-5 py-8 text-center text-sm text-muted-foreground">
              No team members yet. Add your first user to get started.
            </li>
          ) : (
            recentMembers.map((member) => {
              const name = member.fullName ?? member.email ?? "Unknown member";
              return (
                <li key={member.id} className="flex items-center gap-4 px-5 py-3.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
                    {initials(name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{name}</p>
                    <p className="truncate text-xs text-muted-foreground">{member.email ?? "—"}</p>
                  </div>
                  <span className="hidden sm:block">
                    <RoleBadge role={member.baseRole} />
                  </span>
                  <StatusBadge status={member.status} />
                </li>
              );
            })
          )}
        </ul>
      </div>

      <UserDialog open={dialogOpen} onOpenChange={setDialogOpen} companyId={companyId} />
    </DashboardLayout>
  );
}
