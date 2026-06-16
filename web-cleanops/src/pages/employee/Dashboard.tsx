import { useMemo } from "react";
import { Briefcase, LayoutGrid, UserCircle, Users2 } from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { StatCard } from "@/components/dashboard/StatCard";
import { WelcomeWidget } from "@/components/customer/WelcomeWidget";
import { QuickActionsWidget, type QuickAction } from "@/components/customer/QuickActionsWidget";
import { AssignedModulesWidget } from "@/components/customer/AssignedModulesWidget";
import { RecentActivityWidget } from "@/components/customer/RecentActivityWidget";
import { NotificationsWidget } from "@/components/employee/NotificationsWidget";
import { useApp } from "@/context/AppContext";

/**
 * The employee portal home. Composed from independent widgets so future modules
 * can plug new areas in without redesigning the page. Everything visible here is
 * driven by Module Management and Roles & Permissions — never hardcoded.
 */
export default function EmployeeDashboard() {
  const { currentUser, companies, employees, teams, auditEvents, getAccessibleModules } = useApp();

  const companyName = useMemo(
    () => companies.find((c) => c.id === currentUser?.companyId)?.name ?? "your company",
    [companies, currentUser?.companyId],
  );

  const profile = useMemo(
    () =>
      employees.find(
        (e) => e.id === currentUser?.linkedEmployeeId || e.userId === currentUser?.id,
      ) ?? null,
    [employees, currentUser?.linkedEmployeeId, currentUser?.id],
  );

  const myTeams = useMemo(
    () => (profile ? teams.filter((t) => profile.teamIds.includes(t.id)) : []),
    [teams, profile],
  );

  const tools = useMemo(
    () => (currentUser ? getAccessibleModules(currentUser) : []),
    [currentUser, getAccessibleModules],
  );

  // Shortcuts: the first few available tools plus the profile, so the portal
  // adapts to whatever modules the company has enabled.
  const quickActions = useMemo<QuickAction[]>(() => {
    const moduleActions: QuickAction[] = tools.slice(0, 3).map((def) => ({
      label: def.name,
      description: "Open",
      to: `/modules/${def.id}`,
      icon: def.icon,
    }));
    return [
      ...moduleActions,
      {
        label: "My profile",
        description: "View details",
        to: "/profile",
        icon: UserCircle,
      },
    ];
  }, [tools]);

  // Only the signed-in employee's own events — never other people's actions.
  const myEvents = useMemo(
    () =>
      currentUser
        ? auditEvents.filter((e) => e.actorId === currentUser.id).slice(0, 5)
        : [],
    [auditEvents, currentUser],
  );

  if (!currentUser) return null;

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <WelcomeWidget
          name={currentUser.name}
          companyName={companyName}
          portalLabel="Employee portal"
          description={`Your workspace at ${companyName}. Your teams and tools live here.`}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            label="Available tools"
            value={tools.length}
            icon={LayoutGrid}
            hint="Modules enabled for you"
          />
          <StatCard
            label="My teams"
            value={myTeams.length}
            icon={Users2}
            hint="Groups you belong to"
          />
          <StatCard
            label="Role"
            value={profile?.title ?? "Employee"}
            icon={Briefcase}
            hint={profile ? "From your staff profile" : "No staff profile linked"}
          />
        </div>

        <QuickActionsWidget actions={quickActions} />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <AssignedModulesWidget
              modules={tools}
              title="Your tools"
              description="Modules your company has enabled for you."
              emptyText="No tools are enabled for you yet."
            />
          </div>
          <div className="space-y-6">
            <NotificationsWidget />
            <RecentActivityWidget events={myEvents} />
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
