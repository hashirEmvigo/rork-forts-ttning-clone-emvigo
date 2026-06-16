import { useMemo, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  CircleCheck,
  CircleDashed,
  DoorOpen,
  Globe,
  Layers3,
  ListChecks,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  SprayCan,
} from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { AccessDenied } from "@/components/AccessDenied";
import { ChecklistTabs } from "@/components/checklist/ChecklistTabs";
import {
  LibraryRoomDialog,
  type LibraryRoomFormValues,
} from "@/components/checklist/LibraryRoomDialog";
import {
  LibraryTaskDialog,
  type LibraryTaskFormValues,
} from "@/components/checklist/LibraryTaskDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PageMenuTiles, type PageMenuTileItem } from "@/components/navigation/PageMenuTiles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  ROOM_LIBRARY_CATEGORIES,
  ROOM_LIBRARY_CATEGORY_LABELS,
  TASK_LIBRARY_CATEGORIES,
  TASK_LIBRARY_CATEGORY_LABELS,
  type LibraryRoom,
  type LibraryTask,
} from "@/types";

/** A clickable category filter chip. */
function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-muted-foreground hover:bg-muted",
      )}
    >
      {label}
    </button>
  );
}

interface LibraryCardProps {
  title: string;
  description?: string;
  categoryLabel: string;
  isGlobal: boolean;
  archived: boolean;
  editable: boolean;
  meta?: React.ReactNode;
  icon: React.ReactNode;
  onEdit?: () => void;
  onToggleArchive?: () => void;
}

function LibraryCard({
  title,
  description,
  categoryLabel,
  isGlobal,
  archived,
  editable,
  meta,
  icon,
  onEdit,
  onToggleArchive,
}: LibraryCardProps) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-2xl border border-border bg-card p-4",
        archived && "opacity-60",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            {icon}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{title}</p>
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
              {categoryLabel}
            </p>
          </div>
        </div>
        {editable ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onEdit ? (
                <DropdownMenuItem onClick={onEdit}>
                  <Pencil className="h-4 w-4" /> Edit
                </DropdownMenuItem>
              ) : null}
              {onToggleArchive ? (
                <DropdownMenuItem
                  onClick={onToggleArchive}
                  className={archived ? "" : "text-destructive focus:text-destructive"}
                >
                  {archived ? (
                    <>
                      <ArchiveRestore className="h-4 w-4" /> Restore
                    </>
                  ) : (
                    <>
                      <Archive className="h-4 w-4" /> Archive
                    </>
                  )}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {description ? (
        <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{description}</p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
            isGlobal
              ? "border-primary/20 bg-primary/5 text-primary"
              : "border-border bg-secondary text-secondary-foreground",
          )}
        >
          {isGlobal ? <Globe className="h-3 w-3" /> : null}
          {isGlobal ? "Global" : "Company"}
        </span>
        {archived ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            <Archive className="h-3 w-3" /> Archived
          </span>
        ) : null}
        {meta}
      </div>
    </div>
  );
}

function EmptyState({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="col-span-full flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card px-6 py-14 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        {icon}
      </div>
      <p className="mt-4 text-sm font-medium text-muted-foreground">{label}</p>
    </div>
  );
}

/**
 * Page-level section menu (Slice 11E) — shared icon-above-label tile standard.
 * Long names shortened ("Room Library" → "Rooms", "Cleaning Task Library" →
 * "Tasks"); tab values/content unchanged.
 */
const LIBRARY_TAB_ITEMS: PageMenuTileItem[] = [
  { value: "rooms", label: "Rooms", icon: DoorOpen },
  { value: "tasks", label: "Tasks", icon: SprayCan },
];

export default function ChecklistLibraries() {
  const {
    currentUser,
    hasPermission,
    canAccessModule,
    getVisibleLibraryRooms,
    getVisibleLibraryTasks,
    canEditLibraryRoom,
    canEditLibraryTask,
    createLibraryRoom,
    updateLibraryRoom,
    setLibraryRoomArchived,
    createLibraryTask,
    updateLibraryTask,
    setLibraryTaskArchived,
  } = useApp();
  const { toast } = useToast();

  const [roomQuery, setRoomQuery] = useState<string>("");
  const [roomCategory, setRoomCategory] = useState<string>("all");
  const [taskQuery, setTaskQuery] = useState<string>("");
  const [taskCategory, setTaskCategory] = useState<string>("all");
  const [showArchived, setShowArchived] = useState<boolean>(false);
  const [roomDialog, setRoomDialog] = useState<{ open: boolean; room: LibraryRoom | null }>({
    open: false,
    room: null,
  });
  const [taskDialog, setTaskDialog] = useState<{ open: boolean; task: LibraryTask | null }>({
    open: false,
    task: null,
  });

  const isSuperAdmin = currentUser?.role === "super_admin";

  const rooms = useMemo(
    () => (currentUser ? getVisibleLibraryRooms(currentUser) : []),
    [currentUser, getVisibleLibraryRooms],
  );
  const tasks = useMemo(
    () => (currentUser ? getVisibleLibraryTasks(currentUser) : []),
    [currentUser, getVisibleLibraryTasks],
  );

  // Access control beyond the UI.
  if (!currentUser || !hasPermission("checklist_templates.view")) return <AccessDenied />;
  if (!isSuperAdmin && !canAccessModule(currentUser, "checklist-manager")) {
    return <AccessDenied />;
  }

  const scopeLabel = isSuperAdmin
    ? "A global item available to companies."
    : "An item owned by your company.";

  const filteredRooms = rooms.filter((r) => {
    if (!showArchived && r.status === "archived") return false;
    if (roomCategory !== "all" && r.category !== roomCategory) return false;
    if (roomQuery.trim() && !r.name.toLowerCase().includes(roomQuery.trim().toLowerCase()))
      return false;
    return true;
  });
  const filteredTasks = tasks.filter((t) => {
    if (!showArchived && t.status === "archived") return false;
    if (taskCategory !== "all" && t.category !== taskCategory) return false;
    if (taskQuery.trim() && !t.name.toLowerCase().includes(taskQuery.trim().toLowerCase()))
      return false;
    return true;
  });

  const submitRoom = (values: LibraryRoomFormValues): string | null => {
    const result = roomDialog.room
      ? updateLibraryRoom(roomDialog.room.id, values)
      : createLibraryRoom(values);
    if (!result.ok) return result.error ?? "Unable to save room.";
    toast({
      title: roomDialog.room ? "Room updated" : "Room added",
      description: `${values.name} has been saved to the room library.`,
    });
    return null;
  };

  const submitTask = (values: LibraryTaskFormValues): string | null => {
    const result = taskDialog.task
      ? updateLibraryTask(taskDialog.task.id, values)
      : createLibraryTask(values);
    if (!result.ok) return result.error ?? "Unable to save task.";
    toast({
      title: taskDialog.task ? "Task updated" : "Task added",
      description: `${values.name} has been saved to the task library.`,
    });
    return null;
  };

  const toggleRoomArchive = (room: LibraryRoom) => {
    const archived = room.status !== "archived";
    const result = setLibraryRoomArchived(room.id, archived);
    if (result.ok) {
      toast({
        title: archived ? "Room archived" : "Room restored",
        description: `${room.name} has been ${archived ? "archived" : "restored"}.`,
      });
    }
  };

  const toggleTaskArchive = (task: LibraryTask) => {
    const archived = task.status !== "archived";
    const result = setLibraryTaskArchived(task.id, archived);
    if (result.ok) {
      toast({
        title: archived ? "Task archived" : "Task restored",
        description: `${task.name} has been ${archived ? "archived" : "restored"}.`,
      });
    }
  };

  return (
    <DashboardLayout wide>
      <ChecklistTabs />
      <PageHeader
        title="Checklist Libraries"
        description={
          isSuperAdmin
            ? "Manage reusable global rooms and cleaning tasks available to companies."
            : "Build reusable rooms and cleaning tasks to speed up template creation."
        }
        action={
          <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            Show archived
            <Switch
              checked={showArchived}
              onCheckedChange={setShowArchived}
              aria-label="Show archived items"
            />
          </label>
        }
      />

      <Tabs defaultValue="rooms" className="w-full">
        <PageMenuTiles items={LIBRARY_TAB_ITEMS} ariaLabel="Library sections" testId="library-menu-tiles" />

        {/* Room Library */}
        <TabsContent value="rooms" className="mt-5 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search rooms"
                value={roomQuery}
                onChange={(e) => setRoomQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button onClick={() => setRoomDialog({ open: true, room: null })}>
              <Plus className="h-4 w-4" /> New room
            </Button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <CategoryChip
              label="All"
              active={roomCategory === "all"}
              onClick={() => setRoomCategory("all")}
            />
            {ROOM_LIBRARY_CATEGORIES.map((c) => (
              <CategoryChip
                key={c.value}
                label={c.label}
                active={roomCategory === c.value}
                onClick={() => setRoomCategory(c.value)}
              />
            ))}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filteredRooms.length === 0 ? (
              <EmptyState icon={<DoorOpen className="h-6 w-6" />} label="No rooms found." />
            ) : (
              filteredRooms.map((room) => (
                <LibraryCard
                  key={room.id}
                  title={room.name}
                  description={room.description}
                  categoryLabel={ROOM_LIBRARY_CATEGORY_LABELS[room.category]}
                  isGlobal={room.companyId === null}
                  archived={room.status === "archived"}
                  editable={canEditLibraryRoom(currentUser, room)}
                  icon={<DoorOpen className="h-4 w-4" />}
                  meta={
                    room.suggestedFloorType ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                        <Layers3 className="h-3 w-3" /> {room.suggestedFloorType}
                      </span>
                    ) : null
                  }
                  onEdit={() => setRoomDialog({ open: true, room })}
                  onToggleArchive={() => toggleRoomArchive(room)}
                />
              ))
            )}
          </div>
        </TabsContent>

        {/* Cleaning Task Library */}
        <TabsContent value="tasks" className="mt-5 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search tasks"
                value={taskQuery}
                onChange={(e) => setTaskQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button onClick={() => setTaskDialog({ open: true, task: null })}>
              <Plus className="h-4 w-4" /> New task
            </Button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <CategoryChip
              label="All"
              active={taskCategory === "all"}
              onClick={() => setTaskCategory("all")}
            />
            {TASK_LIBRARY_CATEGORIES.map((c) => (
              <CategoryChip
                key={c.value}
                label={c.label}
                active={taskCategory === c.value}
                onClick={() => setTaskCategory(c.value)}
              />
            ))}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filteredTasks.length === 0 ? (
              <EmptyState icon={<ListChecks className="h-6 w-6" />} label="No tasks found." />
            ) : (
              filteredTasks.map((task) => (
                <LibraryCard
                  key={task.id}
                  title={task.name}
                  description={task.description}
                  categoryLabel={TASK_LIBRARY_CATEGORY_LABELS[task.category]}
                  isGlobal={task.companyId === null}
                  archived={task.status === "archived"}
                  editable={canEditLibraryTask(currentUser, task)}
                  icon={<SprayCan className="h-4 w-4" />}
                  meta={
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                        task.defaultAutoEnabled
                          ? "border-success/20 bg-success/10 text-success"
                          : "border-border bg-muted text-muted-foreground",
                      )}
                    >
                      {task.defaultAutoEnabled ? (
                        <CircleCheck className="h-3 w-3" />
                      ) : (
                        <CircleDashed className="h-3 w-3" />
                      )}
                      Auto {task.defaultAutoEnabled ? "on" : "off"}
                    </span>
                  }
                  onEdit={() => setTaskDialog({ open: true, task })}
                  onToggleArchive={() => toggleTaskArchive(task)}
                />
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>

      <LibraryRoomDialog
        open={roomDialog.open}
        onOpenChange={(open) => setRoomDialog((prev) => ({ ...prev, open }))}
        room={roomDialog.room}
        scopeLabel={scopeLabel}
        onSubmit={submitRoom}
      />
      <LibraryTaskDialog
        open={taskDialog.open}
        onOpenChange={(open) => setTaskDialog((prev) => ({ ...prev, open }))}
        task={taskDialog.task}
        scopeLabel={scopeLabel}
        onSubmit={submitTask}
      />
    </DashboardLayout>
  );
}
