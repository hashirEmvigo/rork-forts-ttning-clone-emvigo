import { Info } from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { AccessDenied } from "@/components/AccessDenied";
import { GlobalTemplatesPanel } from "@/components/settings/GlobalTemplatesPanel";
import { ChecklistTabs } from "@/components/checklist/ChecklistTabs";
import { useApp } from "@/context/AppContext";

/**
 * Super Admin — Global Templates. The platform-level management home for the
 * system-owned best-practice template library that seeds company templates and
 * customer protocols. Restricted to the Super Admin (route guard) and gated on
 * the `global_templates.edit` permission for write access; company admins never
 * reach this surface.
 */
export default function GlobalTemplates() {
  const { currentUser, hasPermission } = useApp();

  if (currentUser?.role !== "super_admin") return <AccessDenied />;

  const canManage = hasPermission("global_templates.edit");

  return (
    <DashboardLayout wide>
      <ChecklistTabs />
      <PageHeader
        title="Global Templates"
        description="System-owned best-practice templates companies start from. Edits only affect future copies."
      />

      <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          This library is platform-wide. Company admins can view and copy these
          templates, but only the Super Admin can create, edit or archive them.
        </p>
      </div>

      <GlobalTemplatesPanel canManage={canManage} />
    </DashboardLayout>
  );
}
