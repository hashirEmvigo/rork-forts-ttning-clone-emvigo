import { Link } from "react-router-dom";
import { ArrowLeft, ClipboardList } from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { AccessDenied } from "@/components/AccessDenied";
import { ChecklistSettingsOverview } from "@/components/settings/ChecklistSettingsOverview";
import { ChecklistTabs } from "@/components/checklist/ChecklistTabs";
import { useApp } from "@/context/AppContext";

/**
 * Settings → Checklists landing page. Central configuration area for Checklist
 * Manager V2. Ticket 1 establishes structure only — each module links to its
 * own dedicated placeholder route.
 */
export default function ChecklistSettings() {
  const { hasPermission, currentUser } = useApp();

  if (!hasPermission("checklists.settings.view")) return <AccessDenied />;

  const isSuperAdmin = currentUser?.role === "super_admin";

  return (
    <DashboardLayout wide>
      {isSuperAdmin ? (
        <ChecklistTabs />
      ) : (
        <Link
          to="/settings"
          className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Settings
        </Link>
      )}

      <PageHeader
        title={isSuperAdmin ? "Checklist Configuration" : "Checklists"}
        description="Configure the structure and categories used when building checklist libraries, templates and protocols."
      />

      <section className="rounded-2xl border border-border bg-card">
        <div className="flex items-start gap-3 border-b border-border px-5 py-4 sm:px-6">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ClipboardList className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-base font-semibold">Configuration modules</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              This area controls the reusable structure and categories behind checklist
              creation — not checklist execution. Manage Floor Presets, Room, Task,
              Instruction, Quality, Media, Template and Industry categories here.
            </p>
          </div>
        </div>
        <div className="px-5 py-5 sm:px-6">
          <ChecklistSettingsOverview />
        </div>
      </section>
    </DashboardLayout>
  );
}
