import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleCheck,
  CircleDashed,
  FileText,
  ImageIcon,
  Layers,
  ListChecks,
  Lock,
  MoreHorizontal,
  Pencil,
  Plus,
  SquareStack,
} from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { AccessDenied } from "@/components/AccessDenied";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TemplateDialog } from "@/components/checklist/TemplateDialog";
import { NameDialog } from "@/components/checklist/NameDialog";
import { TaskDialog, type TaskFormValues } from "@/components/checklist/TaskDialog";
import { NotesImagesDialog } from "@/components/checklist/NotesImagesDialog";
import { LibraryPicker, type LibraryPickerItem } from "@/components/checklist/LibraryPicker";
import { useApp, type ChecklistTarget } from "@/context/AppContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  ROOM_LIBRARY_CATEGORIES,
  ROOM_LIBRARY_CATEGORY_LABELS,
  TASK_LIBRARY_CATEGORIES,
  TASK_LIBRARY_CATEGORY_LABELS,
} from "@/types";
import type { ChecklistFloor, ChecklistImage, ChecklistRoom, CleaningTask } from "@/types";
import { Library } from "lucide-react";

/** Returns ids reordered after moving the item at index by delta (-1 up / +1 down). */
function moveOrder(ids: string[], index: number, delta: number): string[] {
  const next = [...ids];
  const target = index + delta;
  if (target < 0 || target >= next.length) return ids;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Whether a node carries any notes or images. */
function hasExtras(node: { notes?: string; images?: ChecklistImage[] }): boolean {
  return Boolean(node.notes?.trim()) || (node.images?.length ?? 0) > 0;
}

interface NotesState {
  target: ChecklistTarget;
  label: string;
  levelLabel: string;
  notes: string;
  images: ChecklistImage[];
}

/** Small inline indicator showing attached notes / images. */
function ExtrasBadge({ node }: { node: { notes?: string; images?: ChecklistImage[] } }) {
  if (!hasExtras(node)) return null;
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      {node.notes?.trim() ? <FileText className="h-3.5 w-3.5" /> : null}
      {(node.images?.length ?? 0) > 0 ? (
        <span className="inline-flex items-center gap-0.5">
          <ImageIcon className="h-3.5 w-3.5" />
          {node.images?.length}
        </span>
      ) : null}
    </span>
  );
}

export default function TemplateEditor() {
  const { templateId = "" } = useParams<{ templateId: string }>();
  const navigate = useNavigate();
  const {
    currentUser,
    hasPermission,
    canAccessModule,
    checklistTemplates,
    getVisibleTemplates,
    canEditTemplate,
    addFloor,
    updateFloor,
    setFloorArchived,
    reorderFloors,
    addRoom,
    updateRoom,
    setRoomArchived,
    reorderRooms,
    addTask,
    updateTask,
    setTaskArchived,
    reorderTasks,
    setChecklistNotesImages,
    getVisibleLibraryRooms,
    getVisibleLibraryTasks,
    addRoomsFromLibrary,
    addTasksFromLibrary,
  } = useApp();
  const { toast } = useToast();

  const [openFloors, setOpenFloors] = useState<Record<string, boolean>>({});
  const [showArchived, setShowArchived] = useState<boolean>(false);
  const [detailsOpen, setDetailsOpen] = useState<boolean>(false);
  const [floorDialog, setFloorDialog] = useState<{ open: boolean; floor: ChecklistFloor | null }>(
    { open: false, floor: null },
  );
  const [roomDialog, setRoomDialog] = useState<{
    open: boolean;
    floorId: string;
    room: ChecklistRoom | null;
  }>({ open: false, floorId: "", room: null });
  const [taskDialog, setTaskDialog] = useState<{
    open: boolean;
    floorId: string;
    roomId: string;
    task: CleaningTask | null;
  }>({ open: false, floorId: "", roomId: "", task: null });
  const [notesState, setNotesState] = useState<NotesState | null>(null);
  const [roomPicker, setRoomPicker] = useState<{ open: boolean; floorId: string }>({
    open: false,
    floorId: "",
  });
  const [taskPicker, setTaskPicker] = useState<{
    open: boolean;
    floorId: string;
    roomId: string;
  }>({ open: false, floorId: "", roomId: "" });

  const template = useMemo(
    () => checklistTemplates.find((t) => t.id === templateId) ?? null,
    [checklistTemplates, templateId],
  );

  const visibleIds = useMemo(
    () => new Set((currentUser ? getVisibleTemplates(currentUser) : []).map((t) => t.id)),
    [currentUser, getVisibleTemplates],
  );

  // Access control beyond the UI.
  if (!currentUser || !hasPermission("checklist_templates.view")) return <AccessDenied />;
  if (currentUser.role !== "super_admin" && !canAccessModule(currentUser, "checklist-manager")) {
    return <AccessDenied />;
  }
  if (!template || !visibleIds.has(template.id)) return <AccessDenied />;

  const readOnly = !canEditTemplate(currentUser, template);
  const isGlobal = template.companyId === null;

  // Active library items the admin can copy into this template (independent copies).
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

  const handleAddRoomsFromLibrary = (ids: string[]) => {
    const result = addRoomsFromLibrary(template.id, roomPicker.floorId, ids);
    if (!result.ok) {
      toast({
        title: "Couldn't add rooms",
        description: result.error ?? "Please try again.",
        variant: "destructive",
      });
      return;
    }
    toast({
      title: "Rooms added",
      description: `${ids.length} ${ids.length === 1 ? "room" : "rooms"} copied from the library.`,
    });
  };

  const handleAddTasksFromLibrary = (ids: string[]) => {
    const result = addTasksFromLibrary(template.id, taskPicker.floorId, taskPicker.roomId, ids);
    if (!result.ok) {
      toast({
        title: "Couldn't add tasks",
        description: result.error ?? "Please try again.",
        variant: "destructive",
      });
      return;
    }
    toast({
      title: "Tasks added",
      description: `${ids.length} ${ids.length === 1 ? "task" : "tasks"} copied from the library.`,
    });
  };

  const sortedFloors = [...template.floors].sort((a, b) => a.sortOrder - b.sortOrder);
  const floorIds = sortedFloors.map((f) => f.id);
  const visibleFloors = sortedFloors.filter((f) => showArchived || !f.archived);
  const archivedFloorCount = sortedFloors.filter((f) => f.archived).length;

  const isOpen = (floorId: string): boolean => openFloors[floorId] ?? true;
  const toggleFloor = (floorId: string) =>
    setOpenFloors((prev) => ({ ...prev, [floorId]: !isOpen(floorId) }));

  const openNotes = (state: NotesState) => setNotesState(state);

  const totals = sortedFloors.reduce(
    (acc, f) => {
      if (f.archived) return acc;
      f.rooms.forEach((r) => {
        if (r.archived) return;
        acc.rooms += 1;
        acc.tasks += r.tasks.filter((k) => !k.archived).length;
      });
      return acc;
    },
    { rooms: 0, tasks: 0 },
  );
  const activeFloorCount = sortedFloors.filter((f) => !f.archived).length;

  return (
    <DashboardLayout>
      <button
        onClick={() => navigate("/modules/checklist-manager")}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to templates
      </button>

      <PageHeader
        title={template.name}
        description={template.description}
        action={
          !readOnly ? (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() =>
                  openNotes({
                    target: { level: "template", templateId: template.id },
                    label: template.name,
                    levelLabel: "Template",
                    notes: template.notes ?? "",
                    images: template.images ?? [],
                  })
                }
              >
                <FileText className="h-4 w-4" /> Notes & images
              </Button>
              <Button variant="outline" onClick={() => setDetailsOpen(true)}>
                <Pencil className="h-4 w-4" /> Edit details
              </Button>
            </div>
          ) : undefined
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <StatusBadge status={template.status} />
        <span className="rounded-full border border-border bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">
          {isGlobal ? "Global template" : "Company template"}
        </span>
        {hasExtras(template) ? <ExtrasBadge node={template} /> : null}
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Layers className="h-3.5 w-3.5" /> {activeFloorCount} floors
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <SquareStack className="h-3.5 w-3.5" /> {totals.rooms} rooms
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <ListChecks className="h-3.5 w-3.5" /> {totals.tasks} tasks
        </span>
        {archivedFloorCount > 0 || showArchived ? (
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

      {readOnly ? (
        <div className="mb-6 flex items-center gap-2.5 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          <Lock className="h-4 w-4 shrink-0" />
          This is a read-only view. {isGlobal ? "Global templates are managed by the platform admin." : ""}
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
                ? "This template has no structure."
                : archivedFloorCount > 0
                  ? "All floors are archived. Enable “Show archived” to restore them."
                  : "Add a floor to start building this template."}
            </p>
          </div>
        ) : (
          sortedFloors.map((floor, floorIdx) => {
            if (!showArchived && floor.archived) return null;
            const sortedRooms = [...floor.rooms].sort((a, b) => a.sortOrder - b.sortOrder);
            const roomIds = sortedRooms.map((r) => r.id);
            const open = isOpen(floor.id);
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
                        <ExtrasBadge node={floor} />
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {floor.rooms.length} {floor.rooms.length === 1 ? "room" : "rooms"}
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
                            onClick={() => reorderFloors(template.id, moveOrder(floorIds, floorIdx, -1))}
                            aria-label="Move floor up"
                          >
                            <ChevronUp className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            disabled={floorIdx === floorIds.length - 1}
                            onClick={() => reorderFloors(template.id, moveOrder(floorIds, floorIdx, 1))}
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
                              openNotes({
                                target: { level: "floor", templateId: template.id, floorId: floor.id },
                                label: floor.name,
                                levelLabel: "Floor",
                                notes: floor.notes ?? "",
                                images: floor.images ?? [],
                              })
                            }
                          >
                            <FileText className="h-4 w-4" /> Notes & images
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              setRoomDialog({ open: true, floorId: floor.id, room: null })
                            }
                          >
                            <Plus className="h-4 w-4" /> Add custom room
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setRoomPicker({ open: true, floorId: floor.id })}
                          >
                            <Library className="h-4 w-4" /> Add from library
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => setFloorArchived(template.id, floor.id, !floor.archived)}
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
                        No rooms on this floor yet.
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
                              room.archived && "opacity-60",
                            )}
                          >
                            {/* Room header */}
                            <div className="flex items-center gap-2 px-3 py-2.5">
                              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
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
                                  <ExtrasBadge node={room} />
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {room.tasks.length} {room.tasks.length === 1 ? "task" : "tasks"}
                                </p>
                              </div>
                              {!readOnly ? (
                                <div className="flex items-center gap-0.5">
                                  {!room.archived ? (
                                    <>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7"
                                        disabled={roomIdx === 0}
                                        onClick={() =>
                                          reorderRooms(template.id, floor.id, moveOrder(roomIds, roomIdx, -1))
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
                                          reorderRooms(template.id, floor.id, moveOrder(roomIds, roomIdx, 1))
                                        }
                                        aria-label="Move room down"
                                      >
                                        <ChevronDown className="h-3.5 w-3.5" />
                                      </Button>
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
                                          openNotes({
                                            target: {
                                              level: "room",
                                              templateId: template.id,
                                              floorId: floor.id,
                                              roomId: room.id,
                                            },
                                            label: room.name,
                                            levelLabel: "Room",
                                            notes: room.notes ?? "",
                                            images: room.images ?? [],
                                          })
                                        }
                                      >
                                        <FileText className="h-4 w-4" /> Notes & images
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
                                        <Library className="h-4 w-4" /> Add from library
                                      </DropdownMenuItem>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem
                                        onClick={() =>
                                          setRoomArchived(template.id, floor.id, room.id, !room.archived)
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
                              ) : null}
                            </div>

                            {/* Tasks */}
                            {sortedTasks.filter((k) => showArchived || !k.archived).length > 0 ? (
                              <ul className="border-t border-border">
                                {sortedTasks.map((task, taskIdx) => {
                                  if (!showArchived && task.archived) return null;
                                  return (
                                    <li
                                      key={task.id}
                                      className={cn(
                                        "flex items-start gap-2.5 border-b border-border px-3 py-2.5 last:border-b-0",
                                        task.archived && "opacity-60",
                                      )}
                                    >
                                      <span
                                        className={cn(
                                          "mt-0.5 shrink-0",
                                          task.autoEnabled ? "text-success" : "text-muted-foreground/50",
                                        )}
                                        title={task.autoEnabled ? "Auto enabled" : "Off by default"}
                                      >
                                        {task.autoEnabled ? (
                                          <CircleCheck className="h-4 w-4" />
                                        ) : (
                                          <CircleDashed className="h-4 w-4" />
                                        )}
                                      </span>
                                      <div className="min-w-0 flex-1">
                                        <p className="flex items-center gap-2 text-sm">
                                          {task.name}
                                          {task.archived ? (
                                            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                              Archived
                                            </span>
                                          ) : null}
                                          <ExtrasBadge node={task} />
                                        </p>
                                        {task.description ? (
                                          <p className="mt-0.5 text-xs text-muted-foreground">
                                            {task.description}
                                          </p>
                                        ) : null}
                                      </div>
                                      {!readOnly ? (
                                        <div className="flex items-center gap-0.5">
                                          {!task.archived ? (
                                            <>
                                              <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7"
                                                disabled={taskIdx === 0}
                                                onClick={() =>
                                                  reorderTasks(
                                                    template.id,
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
                                                    template.id,
                                                    floor.id,
                                                    room.id,
                                                    moveOrder(taskIds, taskIdx, 1),
                                                  )
                                                }
                                                aria-label="Move task down"
                                              >
                                                <ChevronDown className="h-3.5 w-3.5" />
                                              </Button>
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
                                                  openNotes({
                                                    target: {
                                                      level: "task",
                                                      templateId: template.id,
                                                      floorId: floor.id,
                                                      roomId: room.id,
                                                      taskId: task.id,
                                                    },
                                                    label: task.name,
                                                    levelLabel: "Task",
                                                    notes: task.notes ?? "",
                                                    images: task.images ?? [],
                                                  })
                                                }
                                              >
                                                <FileText className="h-4 w-4" /> Notes & images
                                              </DropdownMenuItem>
                                              <DropdownMenuSeparator />
                                              <DropdownMenuItem
                                                onClick={() =>
                                                  setTaskArchived(
                                                    template.id,
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
                                                    <ArchiveRestore className="h-4 w-4" /> Restore task
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
                                No tasks yet.
                              </p>
                            )}

                            {!readOnly && !room.archived ? (
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

      {/* Dialogs */}
      <TemplateDialog
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        companyId={template.companyId}
        template={template}
        showAvailability={isGlobal}
      />

      <NameDialog
        open={floorDialog.open}
        onOpenChange={(open) => setFloorDialog((prev) => ({ ...prev, open }))}
        title={floorDialog.floor ? "Rename floor" : "Add floor"}
        label="Floor name"
        placeholder="e.g. Ground Floor"
        initialValue={floorDialog.floor?.name ?? ""}
        submitLabel={floorDialog.floor ? "Save" : "Add floor"}
        onSubmit={(value) => {
          const result = floorDialog.floor
            ? updateFloor(template.id, floorDialog.floor.id, value)
            : addFloor(template.id, value);
          return result.ok ? null : result.error;
        }}
      />

      <NameDialog
        open={roomDialog.open}
        onOpenChange={(open) => setRoomDialog((prev) => ({ ...prev, open }))}
        title={roomDialog.room ? "Rename room" : "Add room"}
        label="Room name"
        placeholder="e.g. Reception"
        initialValue={roomDialog.room?.name ?? ""}
        submitLabel={roomDialog.room ? "Save" : "Add room"}
        onSubmit={(value) => {
          const result = roomDialog.room
            ? updateRoom(template.id, roomDialog.floorId, roomDialog.room.id, value)
            : addRoom(template.id, roomDialog.floorId, value);
          return result.ok ? null : result.error;
        }}
      />

      <TaskDialog
        open={taskDialog.open}
        onOpenChange={(open) => setTaskDialog((prev) => ({ ...prev, open }))}
        task={taskDialog.task}
        onSubmit={(values: TaskFormValues) => {
          const result = taskDialog.task
            ? updateTask(template.id, taskDialog.floorId, taskDialog.roomId, taskDialog.task.id, values)
            : addTask(template.id, taskDialog.floorId, taskDialog.roomId, values);
          return result.ok ? null : result.error;
        }}
      />

      <NotesImagesDialog
        open={Boolean(notesState)}
        onOpenChange={(open) => !open && setNotesState(null)}
        entityLabel={notesState?.label ?? ""}
        levelLabel={notesState?.levelLabel ?? ""}
        notes={notesState?.notes ?? ""}
        images={notesState?.images ?? []}
        onSave={(notes, images) => {
          if (notesState) setChecklistNotesImages(notesState.target, notes, images);
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
        onConfirm={handleAddRoomsFromLibrary}
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
        onConfirm={handleAddTasksFromLibrary}
      />
    </DashboardLayout>
  );
}
