import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { AccessDenied } from "@/components/AccessDenied";
import { ProtocolRunsPanel } from "@/components/execution/ProtocolRunsPanel";
import { useApp } from "@/context/AppContext";

/**
 * Checklist execution landing page (Phase 3B). Lists a company's protocol runs
 * and lets users with `checklists.execution.complete` action items. Gated by
 * `checklists.execution.view`; the panel reads through the resolver only.
 */
export default function ProtocolRuns() {
  const { currentUser, hasPermission } = useApp();

  if (!hasPermission("checklists.execution.view")) return <AccessDenied />;

  const companyId = currentUser?.companyId ?? null;
  const canComplete = hasPermission("checklists.execution.complete");

  return (
    <DashboardLayout wide>
      <PageHeader
        title="Protocol Runs"
        description="View and complete checklist protocols generated from your templates."
      />

      {companyId ? (
        <ProtocolRunsPanel
          companyId={companyId}
          canComplete={canComplete}
          actorId={currentUser?.id ?? "unknown"}
        />
      ) : (
        <section className="rounded-2xl border border-border bg-card">
          <p className="px-6 py-12 text-center text-sm text-muted-foreground">
            Protocol runs are managed per company. Sign in as a company user to view them.
          </p>
        </section>
      )}
    </DashboardLayout>
  );
}
