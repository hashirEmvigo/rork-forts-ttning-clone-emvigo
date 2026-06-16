import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ArrowRightLeft,
  Ban,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleCheck,
  EyeOff,
  FileText,
  Layers,
  Library,
  ListChecks,
  ListTodo,
  Lock,
  MoreHorizontal,
  Pencil,
  Plus,
  Save,
  Sparkles,
  SquareStack,
  StickyNote,
  Undo2,
} from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { AccessDenied } from "@/components/AccessDenied";
import { ProtocolStatusBadge } from "@/components/checklist/ProtocolStatusBadge";
import { ProtocolNotesDialog } from "@/components/checklist/ProtocolNotesDialog";
import { TaskExclusionDialog } from "@/components/checklist/TaskExclusionDialog";
import { NameDialog } from "@/components/checklist/NameDialog";
import { TaskDialog, type TaskFormValues } from "@/components/checklist/TaskDialog";
import { LibraryPicker, type LibraryPickerItem } from "@/components/checklist/LibraryPicker";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useApp, type ProtocolTarget } from "@/context/AppContext";
import { useToast } from "@/hooks/use-toast";
import { makeId } from "@/lib/store";
import { cn } from "@/lib/utils";
import {
  PROTOCOL_TASK_STATES,
  ROOM_LIBRARY_CATEGORIES,
  ROOM_LIBRARY_CATEGORY_LABELS,
  TASK_LIBRARY_CATEGORIES,
  TASK_LIBRARY_CATEGORY_LABELS,
  type CustomerProtocol,
  type CustomerProtocolStatus,
  type ProtocolFloor,
  type ProtocolRoom,
  type ProtocolTask,
  type ProtocolTaskState,
} from "@/types";

/** Returns ids reordered after moving the item at index by delta (-1 up / +1 down). */
function moveOrder(ids: string[], index: number, delta: number): string[] {
  const next = [...ids];
  const target = index + delta;
  if (target < 0 || target >= next.length) return ids;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Only the editable slice of a protocol, used for dirty comparison and saving. */
function editableSnapshot(p: CustomerProtocol): string {
  return JSON.stringify({
    name: p.name,
    description: p.description ?? "",
    status: p.status,
    notes: p.notes ?? "",
    floors: p.floors,
  });
}

/** Deep clone of a protocol so draft edits never mutate stored state. */
function cloneProtocol(p: CustomerProtocol): CustomerProtocol {
  return JSON.parse(JSON.stringify(p)) as CustomerProtocol;
}

/** Inline indicator that a node carries a customer note. */
function NoteBadge({ notes }: { notes?: string }) {
  if (!notes?.trim()) return null;
  return <StickyNote className="h-3.5 w-3.5 text-primary" />;
}

interface PreviewEntry {
  roomName: string;
  task: ProtocolTask;
}

/** A grouped column in the employee preview (To Do / Excluded / Hidden). */
function PreviewColumn({
  title,
  icon,
  tone,
  entries,
  showReason = false,
}: {
  title: string;
  icon: React.ReactNode;
  tone: "success" | "warning" | "muted";
  entries: PreviewEntry[];
  showReason?: boolean;
}) {
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : "text-muted-foreground";
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <span className={cn("flex items-center gap-1.5 text-sm font-semibold", toneClass)}>
          {icon} {title}
        </span>
        <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-secondary-foreground">
          {entries.length}
        </span>
      </div>
      {entries.length === 0 ? (
        <p className="px-3 py-4 text-xs text-muted-foreground">Nothing here.</p>
      ) : (
        <ul className="divide-y divide-border">
          {entries.map((e) => (
            <li key={e.task.id} className="px-3 py-2">
              <p
                className={cn(
                  "text-sm",
                  tone === "warning" && "line-through decoration-warning/60",
                  tone === "muted" && "text-muted-foreground",
                )}
              >
                {e.task.name}
              </p>
              <p className="text-[11px] text-muted-foreground">{e.roomName}</p>
              {showReason && e.task.exclusionReason?.trim() ? (
                <p className="mt-0.5 text-[11px] text-warning">{e.task.exclusionReason}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const STATUS_OPTIONS: { value: CustomerProtocolStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
];

interface NoteState {
  target: ProtocolTarget;
  label: string;
  levelLabel: string;
  notes: string;
}

interface ExclusionState {
  floorId: string;
  roomId: string;
  taskId: string;
  taskName: string;
  reason: string;
}

/** Compact segmented control for a task's three states. */
function TaskStateControl({
  value,
  onChange,
}: {
  value: ProtocolTaskState;
  onChange: (next: ProtocolTaskState) => void;
}) {
  return (
    <div className="inline-flex shrink-0 rounded-lg border border-border bg-muted/40 p-0.5">
      {PROTOCOL_TASK_STATES.map((s) => {
        const selected = s.value === value;
        return (
          <button
            key={s.value}
            type="button"
            onClick={() => onChange(s.value)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              selected
                ? s.value === "active"
                  ? "bg-success text-success-foreground"
                  : s.value === "excluded"
                    ? "bg-warning text-warning-foreground"
                    : "bg-secondary text-secondary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
            aria-pressed={selected}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

export default function ProtocolEditor() {
  const { protocolId = "" } = useParams<{ protocolId: string }>();
  const navigate = useNavigate();
  const {
    currentUser,
    hasPermission,
    canAccessModule,
    customerProtocols,
    customers,
    getVisibleProtocols,
    canEditProtocol,
    getVisibleLibraryRooms,
    getVisibleLibraryTasks,
    libraryRooms,
    libraryTasks,
    saveProtocol,
  } = useApp();
  const { toast } = useToast();

  const protocol = useMemo(
    () => customerProtocols.find((p) => p.id === protocolId) ?? null,
    [customerProtocols, protocolId],
  );

  const visibleIds = useMemo(
    () => new Set((currentUser ? getVisibleProtocols(currentUser) : []).map((p) => p.id)),
    [currentUser, getVisibleProtocols],
  );

  const [draft, setDraft] = useState<CustomerProtocol | null>(null);
  const [openFloors, setOpenFloors] = useState<Record<string, boolean>>({});
  const [showArchived, setShowArchived] = useState<boolean>(false);
  const [noteState, setNoteState] = useState<NoteState | null>(null);
  const [exclusion, setExclusion] = useState<ExclusionState | null>(null);
  const [floorDialog, setFloorDialog] = useState<{ open: boolean; floor: ProtocolFloor | null }>({
    open: false,
    floor: null,
  });
  const [roomDialog, setRoomDialog] = useState<{
    open: boolean;
    floorId: string;
    room: ProtocolRoom | null;
  }>({ open: false, floorId: "", room: null });
  const [taskDialog, setTaskDialog] = useState<{
    open: boolean;
    floorId: string;
    roomId: string;
    task: ProtocolTask | null;
  }>({ open: false, floorId: "", roomId: "", task: null });
  const [roomPicker, setRoomPicker] = useState<{ open: boolean; floorId: string }>({
    open: false,
    floorId: "",
  });
  const [taskPicker, setTaskPicker] = useState<{ open: boolean; floorId: string; roomId: string }>({
    open: false,
    floorId: "",
    roomId: "",
  });
  const [leaveConfirm, setLeaveConfirm] = useState<boolean>(false);

  // Initialise / refresh the draft when the underlying protocol id changes.
  useEffect(() => {
    setDraft(protocol ? cloneProtocol(protocol) : null);
  }, [protocol?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = useMemo(() => {
    if (!protocol || !draft) return false;
    return editableSnapshot(protocol) !== editableSnapshot(draft);
  }, [protocol, draft]);

  // Warn on browser-level navigation while there are unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  /** Applies a pure updater to the working draft. */
  const mutate = useCallback((updater: (p: CustomerProtocol) => CustomerProtocol) => {
    setDraft((prev) => (prev ? updater(prev) : prev));
  }, []);

  const mapFloor = useCallback(
    (floorId: string, fn: (f: ProtocolFloor) => ProtocolFloor) =>
      mutate((p) => ({ ...p, floors: p.floors.map((f) => (f.id === floorId ? fn(f) : f)) })),
    [mutate],
  );

  const mapRoom = useCallback(
    (floorId: string, roomId: string, fn: (r: ProtocolRoom) => ProtocolRoom) =>
      mapFloor(floorId, (f) => ({
        ...f,
        rooms: f.rooms.map((r) => (r.id === roomId ? fn(r) : r)),
      })),
    [mapFloor],
  );

  const mapTask = useCallback(
    (floorId: string, roomId: string, taskId: string, fn: (k: ProtocolTask) => ProtocolTask) =>
      mapRoom(floorId, roomId, (r) => ({
        ...r,
        tasks: r.tasks.map((k) => (k.id === taskId ? fn(k) : k)),
      })),
    [mapRoom],
  );

  // Access control beyond the UI.
  if (!currentUser || !hasPermission("customer_protocols.view")) return <AccessDenied />;
  if (currentUser.role !== "super_admin" && !canAccessModule(currentUser, "checklist-manager")) {
    return <AccessDenied />;
  }
  if (!protocol || !visibleIds.has(protocol.id)) return <AccessDenied />;
  if (!draft) return <DashboardLayout>{null}</DashboardLayout>;

  const editable = canEditProtocol(currentUser, protocol);
  // Suspended (inactive customer) and archived protocols are not editable here.
  const locked = protocol.status === "archived" || protocol.status === "inactive_customer";
  const readOnly = !editable || locked;
  const customer = customers.find((c) => c.id === protocol.customerId);

  const isOpen = (floorId: string): boolean => openFloors[floorId] ?? true;
  const toggleFloor = (floorId: string) =>
    setOpenFloors((prev) => ({ ...prev, [floorId]: !isOpen(floorId) }));

  const leaveEditor = () => navigate("/modules/checklist-manager/protocols");
  const handleBack = () => {
    if (dirty) setLeaveConfirm(true);
    else leaveEditor();
  };

  const handleSave = () => {
    const result = saveProtocol(protocol.id, {
      name: draft.name,
      description: draft.description,
      status: draft.status,
      notes: draft.notes,
      floors: draft.floors,
    });
    if (!result.ok) {
      toast({ title: "Couldn't save", description: result.error, variant: "destructive" });
      return;
    }
    toast({ title: "Changes saved", description: "This customer protocol has been updated." });
  };

  const handleCancel = () => setDraft(cloneProtocol(protocol));

  // ── Floor operations (draft-local) ──
  const addFloor = (name: string): string | null => {
    mutate((p) => ({
      ...p,
      floors: [
        ...p.floors,
        {
          id: makeId("pflr"),
          name,
          sortOrder: p.floors.length,
          rooms: [],
        },
      ],
    }));
    return null;
  };
  const renameFloor = (floorId: string, name: string): string | null => {
    mapFloor(floorId, (f) => ({ ...f, name }));
    return null;
  };
  const reorderFloors = (orderedIds: string[]) =>
    mutate((p) => ({
      ...p,
      floors: orderedIds
        .map((id, i) => {
          const f = p.floors.find((x) => x.id === id);
          return f ? { ...f, sortOrder: i } : null;
        })
        .filter((f): f is ProtocolFloor => f !== null),
    }));
  const setFloorArchived = (floorId: string, archived: boolean) =>
    mapFloor(floorId, (f) => ({ ...f, archived }));

  // ── Room operations ──
  const addRoom = (floorId: string, name: string): string | null => {
    mapFloor(floorId, (f) => ({
      ...f,
      rooms: [
        ...f.rooms,
        { id: makeId("prm"), name, active: false, sortOrder: f.rooms.length, tasks: [] },
      ],
    }));
    return null;
  };
  const renameRoom = (floorId: string, roomId: string, name: string): string | null => {
    mapRoom(floorId, roomId, (r) => ({ ...r, name }));
    return null;
  };
  const reorderRooms = (floorId: string, orderedIds: string[]) =>
    mapFloor(floorId, (f) => ({
      ...f,
      rooms: orderedIds
        .map((id, i) => {
          const r = f.rooms.find((x) => x.id === id);
          return r ? { ...r, sortOrder: i } : null;
        })
        .filter((r): r is ProtocolRoom => r !== null),
    }));
  const setRoomArchived = (floorId: string, roomId: string, archived: boolean) =>
    mapRoom(floorId, roomId, (r) => ({ ...r, archived }));
  const moveRoom = (floorId: string, roomId: string, targetFloorId: string) =>
    mutate((p) => {
      const room = p.floors.find((f) => f.id === floorId)?.rooms.find((r) => r.id === roomId);
      if (!room) return p;
      return {
        ...p,
        floors: p.floors.map((f) => {
          if (f.id === floorId) return { ...f, rooms: f.rooms.filter((r) => r.id !== roomId) };
          if (f.id === targetFloorId)
            return { ...f, rooms: [...f.rooms, { ...room, sortOrder: f.rooms.length }] };
          return f;
        }),
      };
    });
  const setRoomActive = (floorId: string, roomId: string, active: boolean) =>
    mapRoom(floorId, roomId, (r) => ({
      ...r,
      active,
      // Activating enables auto-enabled tasks; deactivating turns them all off.
      tasks: r.tasks.map((k) => ({
        ...k,
        state: (active ? (k.autoEnabled ? "active" : "inactive") : "inactive") as ProtocolTaskState,
        exclusionReason: undefined,
      })),
    }));

  // ── Task operations ──
  const addTask = (floorId: string, roomId: string, values: TaskFormValues): string | null => {
    mapRoom(floorId, roomId, (r) => ({
      ...r,
      tasks: [
        ...r.tasks,
        {
          id: makeId("ptsk"),
          name: values.name,
          description: values.description,
          autoEnabled: values.autoEnabled,
          state: (r.active && values.autoEnabled ? "active" : "inactive") as ProtocolTaskState,
          sortOrder: r.tasks.length,
        },
      ],
    }));
    return null;
  };
  const updateTask = (
    floorId: string,
    roomId: string,
    taskId: string,
    values: TaskFormValues,
  ): string | null => {
    mapTask(floorId, roomId, taskId, (k) => ({
      ...k,
      name: values.name,
      description: values.description,
      autoEnabled: values.autoEnabled,
    }));
    return null;
  };
  const reorderTasks = (floorId: string, roomId: string, orderedIds: string[]) =>
    mapRoom(floorId, roomId, (r) => ({
      ...r,
      tasks: orderedIds
        .map((id, i) => {
          const k = r.tasks.find((x) => x.id === id);
          return k ? { ...k, sortOrder: i } : null;
        })
        .filter((k): k is ProtocolTask => k !== null),
    }));
  const setTaskArchived = (floorId: string, roomId: string, taskId: string, archived: boolean) =>
    mapTask(floorId, roomId, taskId, (k) => ({ ...k, archived }));
  const setTaskState = (
    floorId: string,
    roomId: string,
    taskId: string,
    state: ProtocolTaskState,
    reason?: string,
  ) =>
    mapTask(floorId, roomId, taskId, (k) => ({
      ...k,
      state,
      exclusionReason: state === "excluded" ? reason?.trim() || k.exclusionReason : undefined,
    }));

  // ── Notes ──
  const setNotes = (target: ProtocolTarget, raw: string) => {
    const notes = raw.trim() || undefined;
    mutate((p) => {
      if (target.level === "protocol") return { ...p, notes };
      return {
        ...p,
        floors: p.floors.map((f) => {
          if (f.id !== target.floorId) return f;
          if (target.level === "floor") return { ...f, notes };
          return {
            ...f,
            rooms: f.rooms.map((r) => {
              if (r.id !== target.roomId) return r;
              if (target.level === "room") return { ...r, notes };
              return {
                ...r,
                tasks: r.tasks.map((k) => (k.id === target.taskId ? { ...k, notes } : k)),
              };
            }),
          };
        }),
      };
    });
  };

  // ── Library copy-in (independent copies; no live links) ──
  const roomPickerItems: LibraryPickerItem[] = getVisibleLibraryRooms(currentUser)
    .filter((r) => r.status === "active")
    .map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      category: r.category,
      categoryLabel: ROOM_LIBRARY_CATEGORY_LABELS[r.category],
      isGlobal: r.companyId === null,
    }));
  const taskPickerItems: LibraryPickerItem[] = getVisibleLibraryTasks(currentUser)
    .filter((t) => t.status === "active")
    .map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      category: t.category,
      categoryLabel: TASK_LIBRARY_CATEGORY_LABELS[t.category],
      isGlobal: t.companyId === null,
    }));

  const addRoomsFromLibrary = (floorId: string, ids: string[]) => {
    mapFloor(floorId, (f) => {
      const copies: ProtocolRoom[] = ids
        .map((id) => libraryRooms.find((r) => r.id === id))
        .filter((r): r is NonNullable<typeof r> => Boolean(r))
        .map((r, i) => ({
          id: makeId("prm"),
          name: r.name,
          active: false,
          sortOrder: f.rooms.length + i,
          tasks: [],
        }));
      return { ...f, rooms: [...f.rooms, ...copies] };
    });
    toast({ title: "Rooms added", description: `${ids.length} copied from the library.` });
  };

  const addTasksFromLibrary = (floorId: string, roomId: string, ids: string[]) => {
    mapRoom(floorId, roomId, (r) => {
      const copies: ProtocolTask[] = ids
        .map((id) => libraryTasks.find((t) => t.id === id))
        .filter((t): t is NonNullable<typeof t> => Boolean(t))
        .map((t, i) => ({
          id: makeId("ptsk"),
          name: t.name,
          description: t.description,
          autoEnabled: t.defaultAutoEnabled,
          state: (r.active && t.defaultAutoEnabled ? "active" : "inactive") as ProtocolTaskState,
          sortOrder: r.tasks.length + i,
        }));
      return { ...r, tasks: [...r.tasks, ...copies] };
    });
    toast({ title: "Tasks added", description: `${ids.length} copied from the library.` });
  };

  // ── Derived display data (from the draft) ──
  const sortedFloors = [...draft.floors].sort((a, b) => a.sortOrder - b.sortOrder);
  const floorIds = sortedFloors.map((f) => f.id);
  const visibleFloors = sortedFloors.filter((f) => showArchived || !f.archived);
  const archivedFloorCount = sortedFloors.filter((f) => f.archived).length;
  const activeFloorCount = sortedFloors.filter((f) => !f.archived).length;

  const totals = sortedFloors.reduce(
    (acc, f) => {
      if (f.archived) return acc;
      f.rooms.forEach((r) => {
        if (r.archived) return;
        acc.rooms += 1;
        if (r.active) {
          acc.activeRooms += 1;
          acc.activeTasks += r.tasks.filter((k) => !k.archived && k.state === "active").length;
          acc.excludedTasks += r.tasks.filter((k) => !k.archived && k.state === "excluded").length;
        }
      });
      return acc;
    },
    { rooms: 0, activeRooms: 0, activeTasks: 0, excludedTasks: 0 },
  );

  // Employee-preview grouping across all active rooms (non-archived only).
  const preview = sortedFloors.reduce(
    (acc, f) => {
      if (f.archived) return acc;
      f.rooms.forEach((r) => {
        if (!r.active || r.archived) return;
        [...r.tasks]
          .filter((k) => !k.archived)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .forEach((k) => {
            const entry = { roomName: r.name, task: k };
            if (k.state === "active") acc.todo.push(entry);
            else if (k.state === "excluded") acc.excluded.push(entry);
            else acc.hidden.push(entry);
          });
      });
      return acc;
    },
    { todo: [] as PreviewEntry[], excluded: [] as PreviewEntry[], hidden: [] as PreviewEntry[] },
  );

  return (
    <DashboardLayout>
      <button
        onClick={handleBack}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to protocols
      </button>

      <PageHeader
        title={draft.name}
        description={draft.description}
        action={
          !readOnly ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                onClick={() =>
                  setNoteState({
                    target: { level: "protocol", protocolId: protocol.id },
                    label: draft.name,
                    levelLabel: "Protocol",
                    notes: draft.notes ?? "",
                  })
                }
              >
                <FileText className="h-4 w-4" /> Customer note
              </Button>
              <Select
                value={draft.status === "active" ? "active" : "draft"}
                onValueChange={(value) =>
                  mutate((p) => ({ ...p, status: value as CustomerProtocolStatus }))
                }
              >
                <SelectTrigger className="w-[120px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : undefined
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <ProtocolStatusBadge status={protocol.status} />
        <span className="rounded-full border border-border bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">
          {customer?.name ?? "Unknown customer"}
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          From template: {protocol.sourceTemplateName}
        </span>
        <NoteBadge notes={draft.notes} />
        {(archivedFloorCount > 0 || showArchived) && !readOnly ? (
          <label className="ml-auto flex items-center gap-2 text-xs font-medium text-muted-foreground">
            Show archived
            <Switch
              checked={showArchived}
              onCheckedChange={setShowArchived}
              aria-label="Show archived items"
            />
          </label>
        ) : null}
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Layers className="h-3.5 w-3.5" /> {activeFloorCount} floors
        </span>
        <span className="inline-flex items-center gap-1.5">
          <SquareStack className="h-3.5 w-3.5" /> {totals.activeRooms}/{totals.rooms} rooms active
        </span>
        <span className="inline-flex items-center gap-1.5">
          <ListChecks className="h-3.5 w-3.5" /> {totals.activeTasks} tasks active
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Ban className="h-3.5 w-3.5" /> {totals.excludedTasks} excluded
        </span>
      </div>

      {readOnly ? (
        <div className="mb-6 flex items-center gap-2.5 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          <Lock className="h-4 w-4 shrink-0" />
          {currentUser.role === "super_admin"
            ? "Read-only view. Protocols are managed by the owning company."
            : protocol.status === "archived"
              ? "This protocol is archived. Restore it from the protocol list to make changes."
              : protocol.status === "inactive_customer"
                ? "This customer is inactive, so the protocol is suspended. Reactivate it from the protocol list once the customer is active again."
                : "You have read-only access to this protocol."}
        </div>
      ) : null}

      <div className="space-y-3">
        {visibleFloors.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card px-6 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Layers className="h-6 w-6" />
            </div>
            <p className="mt-4 text-sm font-medium">
              {archivedFloorCount > 0 ? "No active floors" : "No floors yet"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {readOnly
                ? "This protocol has no structure."
                : archivedFloorCount > 0
                  ? "All floors are archived. Enable “Show archived” to restore them."
                  : "Add a floor to start building this protocol."}
            </p>
          </div>
        ) : (
          sortedFloors.map((floor, floorIdx) => {
            if (!showArchived && floor.archived) return null;
            const sortedRooms = [...floor.rooms].sort((a, b) => a.sortOrder - b.sortOrder);
            const roomIds = sortedRooms.map((r) => r.id);
            const open = isOpen(floor.id);
            const otherFloors = sortedFloors.filter((f) => f.id !== floor.id && !f.archived);
            return (
              <div
                key={floor.id}
                className={cn(
                  "overflow-hidden rounded-2xl border border-border bg-card",
                  floor.archived && "opacity-60",
                )}
              >
                {/* Floor header */}
                <div className="flex items-center gap-2 px-4 py-3.5">
                  <button
                    onClick={() => toggleFloor(floor.id)}
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                    aria-label={open ? "Collapse floor" : "Expand floor"}
                  >
                    {open ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                      <Layers className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 truncate text-sm font-semibold">
                        {floor.name}
                        {floor.archived ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            Archived
                          </span>
                        ) : null}
                        <NoteBadge notes={floor.notes} />
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {floor.rooms.filter((r) => !r.archived && r.active).length}/
                        {floor.rooms.filter((r) => !r.archived).length} rooms active
                      </span>
                    </span>
                  </button>

                  {!readOnly ? (
                    <div className="flex items-center gap-0.5">
                      {!floor.archived ? (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            disabled={floorIdx === 0}
                            onClick={() => reorderFloors(moveOrder(floorIds, floorIdx, -1))}
                            aria-label="Move floor up"
                          >
                            <ChevronUp className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            disabled={floorIdx === floorIds.length - 1}
                            onClick={() => reorderFloors(moveOrder(floorIds, floorIdx, 1))}
                            aria-label="Move floor down"
                          >
                            <ChevronDown className="h-4 w-4" />
                          </Button>
                        </>
                      ) : null}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setFloorDialog({ open: true, floor })}>
                            <Pencil className="h-4 w-4" /> Rename floor
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              setNoteState({
                                target: { level: "floor", protocolId: protocol.id, floorId: floor.id },
                                label: floor.name,
                                levelLabel: "Floor",
                                notes: floor.notes ?? "",
                              })
                            }
                          >
                            <FileText className="h-4 w-4" /> Customer note
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setRoomDialog({ open: true, floorId: floor.id, room: null })}
                          >
                            <Plus className="h-4 w-4" /> Add custom room
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setRoomPicker({ open: true, floorId: floor.id })}>
                            <Library className="h-4 w-4" /> Add from library
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => setFloorArchived(floor.id, !floor.archived)}
                            className={floor.archived ? "" : "text-destructive focus:text-destructive"}
                          >
                            {floor.archived ? (
                              <>
                                <ArchiveRestore className="h-4 w-4" /> Restore floor
                              </>
                            ) : (
                              <>
                                <Archive className="h-4 w-4" /> Archive floor
                              </>
                            )}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  ) : null}
                </div>

                {/* Floor body */}
                {open ? (
                  <div className="space-y-2.5 border-t border-border bg-muted/20 px-3 py-3 sm:px-4">
                    {sortedRooms.filter((r) => showArchived || !r.archived).length === 0 ? (
                      <p className="px-1 py-2 text-sm text-muted-foreground">
                        No rooms on this floor.
                      </p>
                    ) : (
                      sortedRooms.map((room, roomIdx) => {
                        if (!showArchived && room.archived) return null;
                        const sortedTasks = [...room.tasks].sort((a, b) => a.sortOrder - b.sortOrder);
                        const taskIds = sortedTasks.map((k) => k.id);
                        return (
                          <div
                            key={room.id}
                            className={cn(
                              "rounded-xl border border-border bg-card",
                              (!room.active || room.archived) && "opacity-75",
                              room.archived && "opacity-60",
                            )}
                          >
                            {/* Room header */}
                            <div className="flex items-center gap-2 px-3 py-2.5">
                              <span
                                className={cn(
                                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
                                  room.active && !room.archived
                                    ? "bg-primary/10 text-primary"
                                    : "bg-secondary text-secondary-foreground",
                                )}
                              >
                                <SquareStack className="h-3.5 w-3.5" />
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="flex items-center gap-2 truncate text-sm font-medium">
                                  {room.name}
                                  {room.archived ? (
                                    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                      Archived
                                    </span>
                                  ) : null}
                                  <NoteBadge notes={room.notes} />
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {room.tasks.filter((k) => !k.archived && k.state === "active").length}/
                                  {room.tasks.filter((k) => !k.archived).length} tasks active
                                </p>
                              </div>
                              {!readOnly ? (
                                <div className="flex items-center gap-1">
                                  {!room.archived ? (
                                    <>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7"
                                        disabled={roomIdx === 0}
                                        onClick={() =>
                                          reorderRooms(floor.id, moveOrder(roomIds, roomIdx, -1))
                                        }
                                        aria-label="Move room up"
                                      >
                                        <ChevronUp className="h-3.5 w-3.5" />
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7"
                                        disabled={roomIdx === roomIds.length - 1}
                                        onClick={() =>
                                          reorderRooms(floor.id, moveOrder(roomIds, roomIdx, 1))
                                        }
                                        aria-label="Move room down"
                                      >
                                        <ChevronDown className="h-3.5 w-3.5" />
                                      </Button>
                                      <Switch
                                        checked={room.active}
                                        onCheckedChange={(next) =>
                                          setRoomActive(floor.id, room.id, next)
                                        }
                                        aria-label={`Toggle room ${room.name}`}
                                      />
                                    </>
                                  ) : null}
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button variant="ghost" size="icon" className="h-7 w-7">
                                        <MoreHorizontal className="h-3.5 w-3.5" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      <DropdownMenuItem
                                        onClick={() =>
                                          setRoomDialog({ open: true, floorId: floor.id, room })
                                        }
                                      >
                                        <Pencil className="h-4 w-4" /> Rename room
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        onClick={() =>
                                          setNoteState({
                                            target: {
                                              level: "room",
                                              protocolId: protocol.id,
                                              floorId: floor.id,
                                              roomId: room.id,
                                            },
                                            label: room.name,
                                            levelLabel: "Room",
                                            notes: room.notes ?? "",
                                          })
                                        }
                                      >
                                        <FileText className="h-4 w-4" /> Customer note
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        onClick={() =>
                                          setTaskDialog({
                                            open: true,
                                            floorId: floor.id,
                                            roomId: room.id,
                                            task: null,
                                          })
                                        }
                                      >
                                        <Plus className="h-4 w-4" /> Add custom task
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        onClick={() =>
                                          setTaskPicker({
                                            open: true,
                                            floorId: floor.id,
                                            roomId: room.id,
                                          })
                                        }
                                      >
                                        <Library className="h-4 w-4" /> Add tasks from library
                                      </DropdownMenuItem>
                                      {otherFloors.length > 0 && !room.archived ? (
                                        <DropdownMenuSub>
                                          <DropdownMenuSubTrigger>
                                            <ArrowRightLeft className="h-4 w-4" /> Move to floor
                                          </DropdownMenuSubTrigger>
                                          <DropdownMenuSubContent>
                                            {otherFloors.map((f) => (
                                              <DropdownMenuItem
                                                key={f.id}
                                                onClick={() => moveRoom(floor.id, room.id, f.id)}
                                              >
                                                {f.name}
                                              </DropdownMenuItem>
                                            ))}
                                          </DropdownMenuSubContent>
                                        </DropdownMenuSub>
                                      ) : null}
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem
                                        onClick={() =>
                                          setRoomArchived(floor.id, room.id, !room.archived)
                                        }
                                        className={
                                          room.archived ? "" : "text-destructive focus:text-destructive"
                                        }
                                      >
                                        {room.archived ? (
                                          <>
                                            <ArchiveRestore className="h-4 w-4" /> Restore room
                                          </>
                                        ) : (
                                          <>
                                            <Archive className="h-4 w-4" /> Archive room
                                          </>
                                        )}
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                              ) : (
                                <span
                                  className={cn(
                                    "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                                    room.active
                                      ? "bg-success/10 text-success"
                                      : "bg-muted text-muted-foreground",
                                  )}
                                >
                                  {room.active ? "Active" : "Inactive"}
                                </span>
                              )}
                            </div>

                            {/* Tasks (only relevant when the room is active and not archived) */}
                            {room.active && !room.archived ? (
                              <>
                                {sortedTasks.filter((k) => showArchived || !k.archived).length > 0 ? (
                                  <ul className="border-t border-border">
                                    {sortedTasks.map((task, taskIdx) => {
                                      if (!showArchived && task.archived) return null;
                                      return (
                                        <li
                                          key={task.id}
                                          className={cn(
                                            "flex flex-col gap-1.5 border-b border-border px-3 py-2.5 last:border-b-0 sm:flex-row sm:items-start sm:gap-2.5",
                                            task.archived && "opacity-60",
                                          )}
                                        >
                                          <span
                                            className={cn(
                                              "mt-0.5 hidden shrink-0 sm:block",
                                              task.state === "active"
                                                ? "text-success"
                                                : task.state === "excluded"
                                                  ? "text-warning"
                                                  : "text-muted-foreground/50",
                                            )}
                                          >
                                            {task.state === "active" ? (
                                              <CircleCheck className="h-4 w-4" />
                                            ) : task.state === "excluded" ? (
                                              <Ban className="h-4 w-4" />
                                            ) : (
                                              <EyeOff className="h-4 w-4" />
                                            )}
                                          </span>
                                          <div className="min-w-0 flex-1">
                                            <p
                                              className={cn(
                                                "flex flex-wrap items-center gap-2 text-sm",
                                                task.state === "excluded" &&
                                                  "line-through decoration-warning/60",
                                                task.state === "inactive" && "text-muted-foreground",
                                              )}
                                            >
                                              {task.name}
                                              {task.archived ? (
                                                <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                                  Archived
                                                </span>
                                              ) : null}
                                              {task.autoEnabled ? (
                                                <span
                                                  className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/5 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                                                  title="Auto enabled when the room is activated"
                                                >
                                                  <Sparkles className="h-3 w-3" /> Auto
                                                </span>
                                              ) : null}
                                              <NoteBadge notes={task.notes} />
                                            </p>
                                            {task.description ? (
                                              <p className="mt-0.5 text-xs text-muted-foreground">
                                                {task.description}
                                              </p>
                                            ) : null}
                                            {task.state === "excluded" ? (
                                              <button
                                                type="button"
                                                disabled={readOnly}
                                                onClick={() =>
                                                  setExclusion({
                                                    floorId: floor.id,
                                                    roomId: room.id,
                                                    taskId: task.id,
                                                    taskName: task.name,
                                                    reason: task.exclusionReason ?? "",
                                                  })
                                                }
                                                className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-warning/10 px-2 py-0.5 text-left text-[11px] font-medium text-warning disabled:cursor-default"
                                              >
                                                <Ban className="h-3 w-3 shrink-0" />
                                                {task.exclusionReason?.trim()
                                                  ? task.exclusionReason
                                                  : "Add exclusion reason"}
                                              </button>
                                            ) : null}
                                          </div>
                                          {!readOnly ? (
                                            <div className="flex items-center gap-1">
                                              {!task.archived ? (
                                                <>
                                                  <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-7 w-7"
                                                    disabled={taskIdx === 0}
                                                    onClick={() =>
                                                      reorderTasks(
                                                        floor.id,
                                                        room.id,
                                                        moveOrder(taskIds, taskIdx, -1),
                                                      )
                                                    }
                                                    aria-label="Move task up"
                                                  >
                                                    <ChevronUp className="h-3.5 w-3.5" />
                                                  </Button>
                                                  <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-7 w-7"
                                                    disabled={taskIdx === taskIds.length - 1}
                                                    onClick={() =>
                                                      reorderTasks(
                                                        floor.id,
                                                        room.id,
                                                        moveOrder(taskIds, taskIdx, 1),
                                                      )
                                                    }
                                                    aria-label="Move task down"
                                                  >
                                                    <ChevronDown className="h-3.5 w-3.5" />
                                                  </Button>
                                                  <TaskStateControl
                                                    value={task.state}
                                                    onChange={(next) => {
                                                      setTaskState(floor.id, room.id, task.id, next);
                                                      if (next === "excluded") {
                                                        setExclusion({
                                                          floorId: floor.id,
                                                          roomId: room.id,
                                                          taskId: task.id,
                                                          taskName: task.name,
                                                          reason: task.exclusionReason ?? "",
                                                        });
                                                      }
                                                    }}
                                                  />
                                                </>
                                              ) : null}
                                              <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                  <Button variant="ghost" size="icon" className="h-7 w-7">
                                                    <MoreHorizontal className="h-3.5 w-3.5" />
                                                  </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                  <DropdownMenuItem
                                                    onClick={() =>
                                                      setTaskDialog({
                                                        open: true,
                                                        floorId: floor.id,
                                                        roomId: room.id,
                                                        task,
                                                      })
                                                    }
                                                  >
                                                    <Pencil className="h-4 w-4" /> Edit task
                                                  </DropdownMenuItem>
                                                  <DropdownMenuItem
                                                    onClick={() =>
                                                      setNoteState({
                                                        target: {
                                                          level: "task",
                                                          protocolId: protocol.id,
                                                          floorId: floor.id,
                                                          roomId: room.id,
                                                          taskId: task.id,
                                                        },
                                                        label: task.name,
                                                        levelLabel: "Task",
                                                        notes: task.notes ?? "",
                                                      })
                                                    }
                                                  >
                                                    <FileText className="h-4 w-4" /> Customer note
                                                  </DropdownMenuItem>
                                                  <DropdownMenuSeparator />
                                                  <DropdownMenuItem
                                                    onClick={() =>
                                                      setTaskArchived(
                                                        floor.id,
                                                        room.id,
                                                        task.id,
                                                        !task.archived,
                                                      )
                                                    }
                                                    className={
                                                      task.archived
                                                        ? ""
                                                        : "text-destructive focus:text-destructive"
                                                    }
                                                  >
                                                    {task.archived ? (
                                                      <>
                                                        <ArchiveRestore className="h-4 w-4" /> Restore
                                                        task
                                                      </>
                                                    ) : (
                                                      <>
                                                        <Archive className="h-4 w-4" /> Archive task
                                                      </>
                                                    )}
                                                  </DropdownMenuItem>
                                                </DropdownMenuContent>
                                              </DropdownMenu>
                                            </div>
                                          ) : null}
                                        </li>
                                      );
                                    })}
                                  </ul>
                                ) : (
                                  <p className="border-t border-border px-3 py-2.5 text-xs text-muted-foreground">
                                    No tasks in this room yet.
                                  </p>
                                )}

                                {!readOnly ? (
                                  <div className="flex items-center gap-1 border-t border-border px-3 py-2">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-8 text-muted-foreground"
                                      onClick={() =>
                                        setTaskDialog({
                                          open: true,
                                          floorId: floor.id,
                                          roomId: room.id,
                                          task: null,
                                        })
                                      }
                                    >
                                      <Plus className="h-4 w-4" /> Add task
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-8 text-muted-foreground"
                                      onClick={() =>
                                        setTaskPicker({
                                          open: true,
                                          floorId: floor.id,
                                          roomId: room.id,
                                        })
                                      }
                                    >
                                      <Library className="h-4 w-4" /> From library
                                    </Button>
                                  </div>
                                ) : null}
                              </>
                            ) : (
                              <p className="border-t border-border px-3 py-2.5 text-xs text-muted-foreground">
                                {room.archived
                                  ? "This room is archived."
                                  : "Activate this room to enable its tasks."}
                              </p>
                            )}
                          </div>
                        );
                      })
                    )}

                    {!readOnly && !floor.archived ? (
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 border-dashed"
                          onClick={() => setRoomDialog({ open: true, floorId: floor.id, room: null })}
                        >
                          <Plus className="h-4 w-4" /> Add room
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 border-dashed"
                          onClick={() => setRoomPicker({ open: true, floorId: floor.id })}
                        >
                          <Library className="h-4 w-4" /> Add from library
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })
        )}

        {!readOnly ? (
          <Button
            variant="outline"
            className="w-full border-dashed"
            onClick={() => setFloorDialog({ open: true, floor: null })}
          >
            <Plus className="h-4 w-4" /> Add floor
          </Button>
        ) : null}
      </div>

      {/* Employee preview — how tasks will be grouped in the execution view later. */}
      {sortedFloors.length > 0 ? (
        <div className="mt-8">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-sm font-semibold">Employee preview</h2>
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-secondary-foreground">
              Read-only
            </span>
          </div>
          <p className="mb-4 text-xs text-muted-foreground">
            A glimpse of how an employee will see this protocol once the execution view is built.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <PreviewColumn
              title="To Do"
              icon={<ListTodo className="h-4 w-4" />}
              tone="success"
              entries={preview.todo}
            />
            <PreviewColumn
              title="Excluded"
              icon={<Ban className="h-4 w-4" />}
              tone="warning"
              entries={preview.excluded}
              showReason
            />
            <PreviewColumn
              title="Hidden / Inactive"
              icon={<EyeOff className="h-4 w-4" />}
              tone="muted"
              entries={preview.hidden}
            />
          </div>
        </div>
      ) : null}

      {/* Sticky save bar — only when editable and there are unsaved changes. */}
      {!readOnly && dirty ? (
        <div className="sticky bottom-4 z-10 mt-8 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card/95 px-4 py-3 shadow-lg backdrop-blur">
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
            <span className="h-2 w-2 rounded-full bg-warning" /> Unsaved changes
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" onClick={handleCancel}>
              <Undo2 className="h-4 w-4" /> Cancel
            </Button>
            <Button onClick={handleSave}>
              <Save className="h-4 w-4" /> Save changes
            </Button>
          </div>
        </div>
      ) : null}

      {/* Dialogs */}
      <NameDialog
        open={floorDialog.open}
        onOpenChange={(open) => setFloorDialog((prev) => ({ ...prev, open }))}
        title={floorDialog.floor ? "Rename floor" : "Add floor"}
        label="Floor name"
        placeholder="e.g. Ground Floor"
        initialValue={floorDialog.floor?.name ?? ""}
        submitLabel={floorDialog.floor ? "Save" : "Add floor"}
        onSubmit={(value) =>
          floorDialog.floor ? renameFloor(floorDialog.floor.id, value) : addFloor(value)
        }
      />

      <NameDialog
        open={roomDialog.open}
        onOpenChange={(open) => setRoomDialog((prev) => ({ ...prev, open }))}
        title={roomDialog.room ? "Rename room" : "Add room"}
        label="Room name"
        placeholder="e.g. Reception"
        initialValue={roomDialog.room?.name ?? ""}
        submitLabel={roomDialog.room ? "Save" : "Add room"}
        onSubmit={(value) =>
          roomDialog.room
            ? renameRoom(roomDialog.floorId, roomDialog.room.id, value)
            : addRoom(roomDialog.floorId, value)
        }
      />

      <TaskDialog
        open={taskDialog.open}
        onOpenChange={(open) => setTaskDialog((prev) => ({ ...prev, open }))}
        task={taskDialog.task}
        onSubmit={(values: TaskFormValues) =>
          taskDialog.task
            ? updateTask(taskDialog.floorId, taskDialog.roomId, taskDialog.task.id, values)
            : addTask(taskDialog.floorId, taskDialog.roomId, values)
        }
      />

      <ProtocolNotesDialog
        open={Boolean(noteState)}
        onOpenChange={(open) => !open && setNoteState(null)}
        entityLabel={noteState?.label ?? ""}
        levelLabel={noteState?.levelLabel ?? ""}
        notes={noteState?.notes ?? ""}
        onSave={(notes) => {
          if (noteState) setNotes(noteState.target, notes);
        }}
      />

      <TaskExclusionDialog
        open={Boolean(exclusion)}
        onOpenChange={(open) => !open && setExclusion(null)}
        taskName={exclusion?.taskName ?? ""}
        reason={exclusion?.reason ?? ""}
        onSave={(reason) => {
          if (exclusion) {
            setTaskState(exclusion.floorId, exclusion.roomId, exclusion.taskId, "excluded", reason);
          }
        }}
      />

      <LibraryPicker
        open={roomPicker.open}
        onOpenChange={(open) => setRoomPicker((prev) => ({ ...prev, open }))}
        title="Add rooms from library"
        description="Selected rooms are copied into this floor. Later library changes won't affect them."
        items={roomPickerItems}
        categories={ROOM_LIBRARY_CATEGORIES}
        searchPlaceholder="Search rooms"
        confirmLabel={(n) => `Add ${n} ${n === 1 ? "room" : "rooms"}`}
        onConfirm={(ids) => addRoomsFromLibrary(roomPicker.floorId, ids)}
      />

      <LibraryPicker
        open={taskPicker.open}
        onOpenChange={(open) => setTaskPicker((prev) => ({ ...prev, open }))}
        title="Add tasks from library"
        description="Selected tasks are copied into this room. Later library changes won't affect them."
        items={taskPickerItems}
        categories={TASK_LIBRARY_CATEGORIES}
        searchPlaceholder="Search tasks"
        confirmLabel={(n) => `Add ${n} ${n === 1 ? "task" : "tasks"}`}
        onConfirm={(ids) => addTasksFromLibrary(taskPicker.floorId, taskPicker.roomId, ids)}
      />

      <AlertDialog open={leaveConfirm} onOpenChange={setLeaveConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes to this protocol. If you leave now, they will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setLeaveConfirm(false);
                leaveEditor();
              }}
            >
              Discard & leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
