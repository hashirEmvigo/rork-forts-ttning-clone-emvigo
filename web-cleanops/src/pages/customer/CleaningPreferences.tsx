import { useMemo } from "react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { AccessDenied } from "@/components/AccessDenied";
import { CustomerSchedulingSummary } from "@/components/customer/CustomerSchedulingSummary";
import { useApp } from "@/context/AppContext";

/**
 * Customer-portal page where customers can view their cleaning day/time
 * preferences. V2 editing is intentionally deferred until the admin Customer
 * Card model is stable, so this portal surface is read-only in A1.1.
 */
export default function CustomerCleaningPreferences() {
  const { currentUser, customers } = useApp();

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

  if (!currentUser || currentUser.role !== "customer" || !customer) {
    return <AccessDenied />;
  }

  return (
    <DashboardLayout>
      <PageHeader
        title="Cleaning days & times"
        description="View the planning preferences your cleaning provider uses when scheduling visits."
      />

      <div className="grid gap-6">
        <div className="rounded-2xl border border-border bg-card p-6">
          <CustomerSchedulingSummary preferences={customer.schedulingPreferences} />
        </div>
        <p className="text-xs text-muted-foreground/70">
          Preference editing is currently handled by your cleaning provider. Contact them if these
          recurring or temporary scheduling preferences need to change.
        </p>
      </div>
    </DashboardLayout>
  );
}
