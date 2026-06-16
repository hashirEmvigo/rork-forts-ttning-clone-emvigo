import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ClipboardList, Layers, ListChecks, ScrollText, SquareStack } from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { AccessDenied } from "@/components/AccessDenied";
import { Button } from "@/components/ui/button";
import { ProtocolStatusBadge } from "@/components/checklist/ProtocolStatusBadge";
import { useApp } from "@/context/AppContext";
import { formatDate } from "@/lib/format";
import type { CustomerProtocol } from "@/types";

/** Counts the active rooms and tasks a customer would actually see. */
function visibleStats(p: CustomerProtocol): { rooms: number; tasks: number } {
  let rooms = 0;
  let tasks = 0;
  for (const f of p.floors) {
    if (f.archived) continue;
    for (const r of f.rooms) {
      if (r.archived || !r.active) continue;
      rooms += 1;
      tasks += r.tasks.filter((k) => !k.archived && k.state === "active").length;
    }
  }
  return { rooms, tasks };
}

/**
 * Customer-facing list of the cleaning protocols connected to the signed-in
 * customer's own account. Read-only: customers can open a protocol to read it,
 * but never edit, create, archive or see other customers' data.
 */
export default function CustomerCleaningProtocols() {
  const { currentUser, hasPermission, canAccessModule, getMyProtocols } = useApp();
  const navigate = useNavigate();

  const protocols = useMemo(
    () => (currentUser ? getMyProtocols(currentUser) : []),
    [currentUser, getMyProtocols],
  );

  // Access control beyond navigation: enforce role, permission and module state.
  if (!currentUser || currentUser.role !== "customer") return <AccessDenied />;
  if (!hasPermission("my_cleaning_protocols.view")) return <AccessDenied />;
  if (!canAccessModule(currentUser, "my-cleaning-protocols")) return <AccessDenied />;

  const sorted = [...protocols].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );

  const openProtocol = (p: CustomerProtocol) =>
    navigate(`/modules/my-cleaning-protocols/${p.id}`);

  return (
    <DashboardLayout>
      <PageHeader
        title="My Cleaning Protocols"
        description="The cleaning protocols set up for your account by your provider."
      />

      {sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card px-6 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ClipboardList className="h-6 w-6" />
          </div>
          <p className="mt-4 text-sm font-medium">No cleaning protocols are currently available.</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            When your provider sets up a cleaning protocol for your account, it will appear here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sorted.map((p) => {
            const stats = visibleStats(p);
            return (
              <div
                key={p.id}
                className="flex flex-col rounded-2xl border border-border bg-card p-5"
              >
                <div className="flex items-start gap-2.5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <ScrollText className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 leading-tight">
                    <p className="truncate text-sm font-semibold">{p.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Updated {formatDate(p.updatedAt)}
                    </p>
                  </div>
                </div>

                {p.description ? (
                  <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{p.description}</p>
                ) : null}

                <div className="mt-4">
                  <ProtocolStatusBadge status={p.status} />
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5" />{" "}
                    {p.floors.filter((f) => !f.archived).length} floors
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <SquareStack className="h-3.5 w-3.5" /> {stats.rooms} rooms
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <ListChecks className="h-3.5 w-3.5" /> {stats.tasks} tasks
                  </span>
                </div>

                <div className="mt-5 border-t border-border pt-4">
                  <Button variant="outline" size="sm" onClick={() => openProtocol(p)}>
                    Open protocol
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </DashboardLayout>
  );
}
