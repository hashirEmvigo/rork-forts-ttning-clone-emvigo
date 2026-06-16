import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Ban,
  Layers,
  ListChecks,
  SquareStack,
  StickyNote,
} from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { AccessDenied } from "@/components/AccessDenied";
import { ProtocolStatusBadge } from "@/components/checklist/ProtocolStatusBadge";
import { useApp } from "@/context/AppContext";
import { cn } from "@/lib/utils";
import type { ProtocolRoom, ProtocolTask } from "@/types";

/** A customer-specific note rendered consistently at any level. */
function CustomerNote({ notes }: { notes?: string }) {
  if (!notes?.trim()) return null;
  return (
    <div className="mt-2 flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-foreground">
      <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
      <span>{notes}</span>
    </div>
  );
}

/** Read-only row for a single cleaning task. */
function TaskRow({ task }: { task: ProtocolTask }) {
  const excluded = task.state === "excluded";
  return (
    <li className="px-3 py-2.5">
      <div className="flex items-start gap-2">
        <span
          className={cn(
            "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
            excluded ? "border-warning/50 bg-warning/10" : "border-success/50 bg-success/10",
          )}
        >
          {excluded ? (
            <Ban className="h-2.5 w-2.5 text-warning" />
          ) : (
            <ListChecks className="h-2.5 w-2.5 text-success" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p
              className={cn(
                "text-sm",
                excluded && "text-muted-foreground line-through decoration-warning/60",
              )}
            >
              {task.name}
            </p>
            {excluded ? (
              <span className="inline-flex items-center rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning">
                Not included
              </span>
            ) : null}
          </div>
          {task.description ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{task.description}</p>
          ) : null}
          {excluded && task.exclusionReason?.trim() ? (
            <p className="mt-0.5 text-xs text-warning">{task.exclusionReason}</p>
          ) : null}
          <CustomerNote notes={task.notes} />
        </div>
      </div>
    </li>
  );
}

/** Read-only card for one active room and its visible tasks. */
function RoomCard({ room }: { room: ProtocolRoom }) {
  // Customers see tasks that are performed (active) or intentionally excluded;
  // inactive (hidden) tasks are not relevant to them.
  const tasks = [...room.tasks]
    .filter((k) => !k.archived && k.state !== "inactive")
    .sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <SquareStack className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{room.name}</p>
          <p className="text-xs text-muted-foreground">
            {tasks.filter((k) => k.state === "active").length} tasks
          </p>
        </div>
      </div>
      {room.notes?.trim() ? (
        <div className="px-3 pb-1">
          <CustomerNote notes={room.notes} />
        </div>
      ) : null}
      {tasks.length === 0 ? (
        <p className="px-3 py-3 text-xs text-muted-foreground">No tasks listed for this room.</p>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Read-only customer view of a single cleaning protocol. Mirrors the admin
 * structure (floors → rooms → tasks + customer notes) with every editing control
 * removed. Access is enforced at the route, UI and data layers: a customer can
 * only open a protocol connected to their own account and company.
 */
export default function CustomerCleaningProtocolView() {
  const { protocolId = "" } = useParams<{ protocolId: string }>();
  const navigate = useNavigate();
  const { currentUser, hasPermission, canAccessModule, customerProtocols, canViewMyProtocol } =
    useApp();

  const protocol = useMemo(
    () => customerProtocols.find((p) => p.id === protocolId) ?? null,
    [customerProtocols, protocolId],
  );

  // Layered access control.
  if (!currentUser || currentUser.role !== "customer") return <AccessDenied />;
  if (!hasPermission("my_cleaning_protocols.view")) return <AccessDenied />;
  if (!canAccessModule(currentUser, "my-cleaning-protocols")) return <AccessDenied />;
  if (!protocol || !canViewMyProtocol(currentUser, protocol)) return <AccessDenied />;

  const sortedFloors = [...protocol.floors]
    .filter((f) => !f.archived)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((f) => ({
      ...f,
      rooms: [...f.rooms]
        .filter((r) => !r.archived && r.active)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    }))
    .filter((f) => f.rooms.length > 0);

  const totals = sortedFloors.reduce(
    (acc, f) => {
      f.rooms.forEach((r) => {
        acc.rooms += 1;
        acc.tasks += r.tasks.filter((k) => !k.archived && k.state === "active").length;
      });
      return acc;
    },
    { rooms: 0, tasks: 0 },
  );

  return (
    <DashboardLayout>
      <button
        onClick={() => navigate("/modules/my-cleaning-protocols")}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to my protocols
      </button>

      <PageHeader title={protocol.name} description={protocol.description} />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <ProtocolStatusBadge status={protocol.status} />
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Layers className="h-3.5 w-3.5" /> {sortedFloors.length} floors
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <SquareStack className="h-3.5 w-3.5" /> {totals.rooms} rooms
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <ListChecks className="h-3.5 w-3.5" /> {totals.tasks} tasks
        </span>
      </div>

      {protocol.notes?.trim() ? (
        <div className="mb-6">
          <CustomerNote notes={protocol.notes} />
        </div>
      ) : null}

      {sortedFloors.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card px-6 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Layers className="h-6 w-6" />
          </div>
          <p className="mt-4 text-sm font-medium">Nothing scheduled yet</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            This protocol doesn't have any active rooms yet. Contact your provider if you have
            questions.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {sortedFloors.map((floor) => (
            <div key={floor.id} className="overflow-hidden rounded-2xl border border-border bg-card">
              <div className="flex items-center gap-2.5 px-4 py-3.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                  <Layers className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{floor.name}</p>
                  <p className="text-xs text-muted-foreground">{floor.rooms.length} rooms</p>
                </div>
              </div>
              <div className="space-y-2.5 border-t border-border bg-muted/20 px-3 py-3 sm:px-4">
                {floor.notes?.trim() ? <CustomerNote notes={floor.notes} /> : null}
                {floor.rooms.map((room) => (
                  <RoomCard key={room.id} room={room} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </DashboardLayout>
  );
}
