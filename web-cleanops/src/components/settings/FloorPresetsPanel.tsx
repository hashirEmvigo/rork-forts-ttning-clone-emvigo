import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  Info,
  Layers3,
  Pencil,
  Plus,
} from "lucide-react";

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
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { FloorPresetDialog } from "@/components/settings/FloorPresetDialog";
import { useToast } from "@/hooks/use-toast";
import {
  archiveFloorPreset,
  createFloorPreset,
  getAllFloorPresets,
  reorderFloorPresets,
  unarchiveFloorPreset,
  updateFloorPreset,
} from "@/lib/floorPresetStore";
import type { FloorPreset } from "@/types";

interface FloorPresetsPanelProps {
  /** Company whose floor presets are managed. */
  companyId: string;
  /** When false the list is read-only (no add/edit/archive/reorder). */
  canManage: boolean;
}

const DUPLICATE_MESSAGE = "A floor preset with this name already exists.";

/**
 * Management UI for a company's Checklist Manager floor presets. Floor presets
 * are the reusable floor/location levels offered when building protocols.
 *
 * The {@link floorPresetStore} is a non-reactive localStorage abstraction, so
 * this panel holds the company's presets in local state and re-reads after each
 * mutation. Archiving is a soft-delete; reordering applies to active presets
 * only via simple move up/down (no drag-and-drop dependency introduced here).
 */
export function FloorPresetsPanel({ companyId, canManage }: FloorPresetsPanelProps) {
  const { toast } = useToast();
  const [presets, setPresets] = useState<FloorPreset[]>([]);
  const [showArchived, setShowArchived] = useState<boolean>(false);
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const [editing, setEditing] = useState<FloorPreset | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<FloorPreset | null>(null);

  const reload = useCallback(() => {
    setPresets(getAllFloorPresets(companyId));
  }, [companyId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const active = useMemo(() => presets.filter((p) => !p.isArchived), [presets]);
  const archived = useMemo(() => presets.filter((p) => p.isArchived), [presets]);

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (preset: FloorPreset) => {
    setEditing(preset);
    setDialogOpen(true);
  };

  const handleSubmit = (input: { name: string; description?: string }): string | null => {
    const result = editing
      ? updateFloorPreset(companyId, editing.id, input)
      : createFloorPreset(companyId, input);
    if (!result) return DUPLICATE_MESSAGE;
    reload();
    toast({ title: editing ? "Floor preset updated" : "Floor preset added" });
    return null;
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= active.length) return;
    const next = [...active];
    [next[index], next[target]] = [next[target], next[index]];
    reorderFloorPresets(
      companyId,
      next.map((p) => p.id),
    );
    reload();
  };

  const confirmArchive = () => {
    if (!archiveTarget) return;
    archiveFloorPreset(companyId, archiveTarget.id);
    reload();
    toast({ title: "Floor preset archived" });
    setArchiveTarget(null);
  };

  const restore = (preset: FloorPreset) => {
    unarchiveFloorPreset(companyId, preset.id);
    reload();
    toast({ title: "Floor preset restored" });
  };

  return (
    <div className="space-y-5">
      {/* Active presets */}
      <div className="rounded-xl border border-border bg-background p-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Layers3 className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">Active floor presets</h3>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Reusable floor levels offered when building checklist protocols. Order
                  here is the order people see when picking floors.
                </p>
              </div>
              {canManage ? (
                <Button className="shrink-0 gap-1.5" onClick={openCreate}>
                  <Plus className="h-4 w-4" /> Add preset
                </Button>
              ) : null}
            </div>

            {active.length === 0 ? (
              <div className="mt-4 rounded-lg border border-dashed border-border bg-muted/40 px-4 py-8 text-center">
                <p className="text-sm font-medium">No active floor presets</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {canManage
                    ? "Add a preset to get started, or restore an archived one below."
                    : "No floor presets have been configured yet."}
                </p>
              </div>
            ) : (
              <ul className="mt-4 space-y-2">
                {active.map((preset, index) => (
                  <li
                    key={preset.id}
                    className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2"
                  >
                    <span className="flex h-7 min-w-[1.75rem] items-center justify-center rounded-full bg-primary/10 px-2 text-xs font-semibold tabular-nums text-primary">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{preset.name}</p>
                      {preset.description ? (
                        <p className="truncate text-xs text-muted-foreground">
                          {preset.description}
                        </p>
                      ) : null}
                    </div>
                    {canManage ? (
                      <div className="ml-auto flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          disabled={index === 0}
                          onClick={() => move(index, -1)}
                          aria-label={`Move ${preset.name} up`}
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          disabled={index === active.length - 1}
                          onClick={() => move(index, 1)}
                          aria-label={`Move ${preset.name} down`}
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => openEdit(preset)}
                          aria-label={`Edit ${preset.name}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => setArchiveTarget(preset)}
                          aria-label={`Archive ${preset.name}`}
                        >
                          <Archive className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Archived presets */}
      <div className="rounded-xl border border-border bg-muted/40 p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Switch
              id="floor-show-archived"
              checked={showArchived}
              onCheckedChange={setShowArchived}
            />
            <Label htmlFor="floor-show-archived" className="text-sm font-medium">
              Show archived presets
            </Label>
          </div>
          {archived.length > 0 ? (
            <span className="text-xs text-muted-foreground tabular-nums">
              {archived.length} archived
            </span>
          ) : null}
        </div>

        {showArchived ? (
          archived.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">No archived floor presets.</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {archived.map((preset) => (
                <li
                  key={preset.id}
                  className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-muted-foreground">
                      {preset.name}
                    </p>
                    {preset.description ? (
                      <p className="truncate text-xs text-muted-foreground">
                        {preset.description}
                      </p>
                    ) : null}
                  </div>
                  {canManage ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto gap-1.5"
                      onClick={() => restore(preset)}
                    >
                      <ArchiveRestore className="h-4 w-4" /> Restore
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>

      <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Floor presets are saved for your company. Archiving keeps a preset out of new
          protocols while preserving it for historical references — it is never deleted.
        </p>
      </div>

      <FloorPresetDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        preset={editing}
        onSubmit={handleSubmit}
      />

      <AlertDialog
        open={Boolean(archiveTarget)}
        onOpenChange={(open) => {
          if (!open) setArchiveTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive floor preset?</AlertDialogTitle>
            <AlertDialogDescription>
              “{archiveTarget?.name}” will be hidden from active lists but kept for
              historical references. You can restore it at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmArchive}>Archive</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
