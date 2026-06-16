import { useMemo } from "react";
import { Building2, Hash, Mail, ShieldCheck, UserCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { AccessDenied } from "@/components/AccessDenied";
import { RoleBadge } from "@/components/RoleBadge";
import { StatusBadge } from "@/components/StatusBadge";
import { initials } from "@/lib/format";
import { useApp } from "@/context/AppContext";

interface DetailRowProps {
  icon: LucideIcon;
  label: string;
  children: React.ReactNode;
}

function DetailRow({ icon: Icon, label, children }: DetailRowProps) {
  return (
    <div className="flex items-center gap-4 px-5 py-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="mt-0.5 text-sm font-medium">{children}</div>
      </div>
    </div>
  );
}

/**
 * Read-only customer profile. Customers see only their own account; the page is
 * scoped to the signed-in user so no other customer's data is ever shown.
 */
export default function CustomerProfile() {
  const { currentUser, companies, customers } = useApp();

  const companyName = useMemo(
    () => companies.find((c) => c.id === currentUser?.companyId)?.name ?? "—",
    [companies, currentUser?.companyId],
  );

  // Resolve the customer record for this login, staying within tenant scope.
  const customer = useMemo(() => {
    if (!currentUser) return null;
    return (
      customers.find(
        (c) =>
          c.id === currentUser.linkedCustomerId ||
          (c.companyId === currentUser.companyId && c.userIds.includes(currentUser.id)),
      ) ?? null
    );
  }, [customers, currentUser]);

  if (!currentUser || currentUser.role !== "customer") {
    return <AccessDenied />;
  }

  const email = customer?.email ?? currentUser.email;
  const status = customer?.status ?? currentUser.status;

  return (
    <DashboardLayout>
      <PageHeader title="My profile" description="Your account details with your provider." />

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center gap-4 border-b border-border bg-gradient-to-br from-primary/5 to-card px-5 py-6">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-lg font-semibold text-primary">
            {initials(currentUser.name)}
          </div>
          <div className="min-w-0">
            <h2 className="truncate font-display text-xl tracking-tight">{currentUser.name}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <RoleBadge role={currentUser.role} />
              <StatusBadge status={status} />
            </div>
          </div>
        </div>

        <div className="divide-y divide-border">
          <DetailRow icon={UserCircle} label="Customer name">
            {currentUser.name}
          </DetailRow>
          <DetailRow icon={Building2} label="Company">
            {companyName}
          </DetailRow>
          {customer?.customerNumber ? (
            <DetailRow icon={Hash} label="Customer number">
              {customer.customerNumber}
            </DetailRow>
          ) : null}
          <DetailRow icon={Mail} label="Contact email">
            <a href={`mailto:${email}`} className="text-primary hover:underline">
              {email}
            </a>
          </DetailRow>
          <DetailRow icon={ShieldCheck} label="Assigned role">
            <RoleBadge role={currentUser.role} />
          </DetailRow>
        </div>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Need to update your details? Contact {companyName} and they'll make the change for you.
      </p>
    </DashboardLayout>
  );
}
