import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { AccessDenied } from "@/components/AccessDenied";
import { EntitlementValidationPanel } from "@/components/settings/EntitlementValidationPanel";
import { useApp } from "@/context/AppContext";

/**
 * Phase 5 (real-data) — temporary Super Admin validation page.
 *
 * Thin wrapper around {@link EntitlementValidationPanel}, which holds the actual
 * report logic and UI. The same panel is also surfaced as a tab inside the
 * Settings hub so super-admins can reach it without typing a URL.
 *
 * The page is read-only: it never writes, never flips a feature flag, and is
 * not part of any production flow. The new resolver remains unwired.
 */
export default function EntitlementValidation() {
  const { currentUser } = useApp();

  if (currentUser?.role !== "super_admin") return <AccessDenied />;

  return (
    <DashboardLayout wide>
      <PageHeader
        title="Entitlement Shadow Validation"
        description="Real-data parity check between the legacy entitlement path and the new bundle pipeline. Read-only — nothing is written and no flag is changed."
      />
      <EntitlementValidationPanel />
    </DashboardLayout>
  );
}
