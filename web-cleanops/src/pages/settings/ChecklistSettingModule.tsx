import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { AccessDenied } from "@/components/AccessDenied";
import { FloorPresetsPanel } from "@/components/settings/FloorPresetsPanel";
import { CategoryPanel } from "@/components/settings/CategoryPanel";
import { TemplatesPanel } from "@/components/settings/TemplatesPanel";
import NotFound from "@/pages/NotFound";
import { getChecklistSettingsModule } from "@/lib/checklistSettingsModules";
import { useApp } from "@/context/AppContext";
import type { ChecklistCategoryType } from "@/types";

interface ChecklistSettingModuleProps {
  /** Id / route slug of the module to render. */
  moduleId: string;
}

/**
 * Maps a category module's route slug to its category type and singular label.
 * Modules absent here (e.g. floor-presets) are handled separately.
 */
const CATEGORY_MODULES: Record<string, { type: ChecklistCategoryType; label: string }> = {
  "room-categories": { type: "room", label: "room category" },
  "task-categories": { type: "task", label: "task category" },
  "instruction-categories": { type: "instruction", label: "instruction category" },
  "quality-categories": { type: "quality", label: "quality category" },
  "media-categories": { type: "media", label: "media category" },
  "template-categories": { type: "template", label: "template category" },
  "industry-categories": { type: "industry", label: "industry category" },
};

/**
 * Shared placeholder page for a single Checklist Manager configuration module.
 * Each module has its own dedicated route (passing a fixed `moduleId`), so a
 * future ticket can replace just that route's element with the real UI without
 * any routing changes. Ticket 1 renders structure and placeholder copy only.
 */
export default function ChecklistSettingModule({ moduleId }: ChecklistSettingModuleProps) {
  const { currentUser, hasPermission } = useApp();
  const module = getChecklistSettingsModule(moduleId);

  if (!hasPermission("checklists.settings.view")) return <AccessDenied />;
  if (!module) return <NotFound />;

  const Icon = module.icon;
  const companyId = currentUser?.companyId ?? null;
  const canManage = hasPermission("checklists.settings.manage");
  const category = CATEGORY_MODULES[moduleId];

  const noCompanyNotice = (
    <section className="rounded-2xl border border-border bg-card">
      <p className="px-6 py-12 text-center text-sm text-muted-foreground">
        This is managed per company. Sign in as a company administrator to configure it.
      </p>
    </section>
  );

  return (
    <DashboardLayout wide>
      <Link
        to="/settings/checklists"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Checklists
      </Link>

      <PageHeader title={module.title} description={module.description} />

      {moduleId === "checklist-templates" ? (
        companyId ? (
          <TemplatesPanel companyId={companyId} canManage={canManage} />
        ) : (
          noCompanyNotice
        )
      ) : moduleId === "floor-presets" ? (
        companyId ? (
          <FloorPresetsPanel companyId={companyId} canManage={canManage} />
        ) : (
          noCompanyNotice
        )
      ) : category ? (
        companyId ? (
          <CategoryPanel
            companyId={companyId}
            type={category.type}
            typeLabel={category.label}
            canManage={canManage}
          />
        ) : (
          noCompanyNotice
        )
      ) : (
        <section className="rounded-2xl border border-border bg-card">
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Icon className="h-6 w-6" />
            </div>
            <p className="mt-4 text-sm font-medium text-muted-foreground">{module.placeholder}</p>
          </div>
        </section>
      )}
    </DashboardLayout>
  );
}
