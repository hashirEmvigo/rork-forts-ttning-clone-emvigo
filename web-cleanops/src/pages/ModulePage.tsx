import { useParams } from "react-router-dom";
import { Sparkles } from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { AccessDenied } from "@/components/AccessDenied";
import { useApp } from "@/context/AppContext";
import { getModuleDefinition } from "@/lib/modules";

/**
 * Generic landing page for a module. Enforces access control: a signed-in user
 * who can't access the module (disabled, unavailable, or wrong user type) sees
 * the Access Denied screen even when navigating directly by URL.
 */
export default function ModulePage() {
  const { moduleId = "" } = useParams<{ moduleId: string }>();
  const { currentUser, canAccessModule } = useApp();

  const def = getModuleDefinition(moduleId);

  if (!currentUser || !def || !canAccessModule(currentUser, moduleId)) {
    return <AccessDenied />;
  }

  const Icon = def.icon;

  return (
    <DashboardLayout>
      <PageHeader title={def.name} description={def.description} />

      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card px-6 py-20 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Icon className="h-7 w-7" />
        </div>
        <h2 className="mt-5 font-display text-xl tracking-tight">{def.name} is ready to build</h2>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          This module is enabled for your company. Its features are coming soon —
          the foundation, access control and navigation are all in place.
        </p>
        <span className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
          <Sparkles className="h-3.5 w-3.5" /> Coming soon
        </span>
      </div>
    </DashboardLayout>
  );
}
