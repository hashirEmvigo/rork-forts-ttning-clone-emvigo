import { useMemo } from "react";
import { CalendarClock, Headset, LayoutGrid, UserCircle } from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { StatCard } from "@/components/dashboard/StatCard";
import { WelcomeWidget } from "@/components/customer/WelcomeWidget";
import { QuickActionsWidget, type QuickAction } from "@/components/customer/QuickActionsWidget";
import { AssignedModulesWidget } from "@/components/customer/AssignedModulesWidget";
import { CompanyNewsWidget } from "@/components/customer/CompanyNewsWidget";
import { RecentActivityWidget } from "@/components/customer/RecentActivityWidget";
import { useApp } from "@/context/AppContext";

/**
 * The customer portal home. Composed from independent widgets so future modules
 * can plug new areas in without redesigning the page. Everything visible here is
 * driven by Module Management and Roles & Permissions — never hardcoded.
 */
export default function CustomerDashboard() {
  const { currentUser, companies, auditEvents, getAccessibleModules, canAccessModule } = useApp();

  const companyName = useMemo(
    () => companies.find((c) => c.id === currentUser?.companyId)?.name ?? "your provider",
    [companies, currentUser?.companyId],
  );

  const services = useMemo(
    () => (currentUser ? getAccessibleModules(currentUser) : []),
    [currentUser, getAccessibleModules],
  );

  // Shortcuts: the first few available modules plus the profile, so the portal
  // adapts to whatever services the company has enabled.
  const quickActions = useMemo<QuickAction[]>(() => {
    const moduleActions: QuickAction[] = services.slice(0, 3).map((def) => ({
      label: def.name,
      description: "Open",
      to: `/modules/${def.id}`,
      icon: def.icon,
    }));
    return [
      ...moduleActions,
      {
        label: "Cleaning days & times",
        description: "Set preferences",
        to: "/my-cleaning-preferences",
        icon: CalendarClock,
      },
      {
        label: "My profile",
        description: "View details",
        to: "/profile",
        icon: UserCircle,
      },
    ];
  }, [services]);

  // Only the signed-in customer's own events — never other customers' actions.
  const myEvents = useMemo(
    () =>
      currentUser
        ? auditEvents.filter((e) => e.actorId === currentUser.id).slice(0, 5)
        : [],
    [auditEvents, currentUser],
  );

  const newsEnabled = useMemo(
    () => (currentUser ? canAccessModule(currentUser, "news") : false),
    [currentUser, canAccessModule],
  );

  if (!currentUser) return null;

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <WelcomeWidget name={currentUser.name} companyName={companyName} />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <StatCard
            label="Available services"
            value={services.length}
            icon={LayoutGrid}
            hint="Tools shared with you"
          />
          <StatCard
            label="Your provider"
            value={companyName}
            icon={Headset}
            hint="Cleaning partner"
          />
        </div>

        <QuickActionsWidget actions={quickActions} />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <AssignedModulesWidget modules={services} />
          </div>
          <div className="space-y-6">
            <CompanyNewsWidget enabled={newsEnabled} companyName={companyName} />
            <RecentActivityWidget events={myEvents} />
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
