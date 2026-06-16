import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { TASK_LIBRARY_CATEGORIES, type LibraryTask, type TaskLibraryCategory } from "@/types";

export interface LibraryTaskFormValues {
  name: string;
  description?: string;
  defaultAutoEnabled: boolean;
  category: TaskLibraryCategory;
}

interface LibraryTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pass a task to edit; omit to create a new one. */
  task?: LibraryTask | null;
  scopeLabel: string;
  /** Returns an error message to display, or null/undefined on success. */
  onSubmit: (values: LibraryTaskFormValues) => string | null | undefined;
}

/** Create or edit a reusable Cleaning Task Library item. */
export function LibraryTaskDialog({
  open,
  onOpenChange,
  task,
  scopeLabel,
  onSubmit,
}: LibraryTaskDialogProps) {
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [autoEnabled, setAutoEnabled] = useState<boolean>(true);
  const [category, setCategory] = useState<TaskLibraryCategory>("surface_cleaning");
  const [error, setError] = useState<string>("");
  const isEdit = Boolean(task);

  useEffect(() => {
    if (open) {
      setName(task?.name ?? "");
      setDescription(task?.description ?? "");
      setAutoEnabled(task?.defaultAutoEnabled ?? true);
      setCategory(task?.category ?? "surface_cleaning");
      setError("");
    }
  }, [open, task]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Task name is required.");
      return;
    }
    const result = onSubmit({
      name: name.trim(),
      description: description.trim() || undefined,
      defaultAutoEnabled: autoEnabled,
      category,
    });
    if (result) {
      setError(result);
      return;
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit task" : "New task"}</DialogTitle>
            <DialogDescription>{scopeLabel}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="lib-task-name">Task name</Label>
              <Input
                id="lib-task-name"
                placeholder="e.g. Wet mop floor"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="lib-task-desc">Description</Label>
              <Textarea
                id="lib-task-desc"
                placeholder="Optional details or instructions"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select
                value={category}
                onValueChange={(v) => setCategory(v as TaskLibraryCategory)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TASK_LIBRARY_CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3">
              <div>
                <p className="text-sm font-medium">Default auto enabled</p>
                <p className="text-xs text-muted-foreground">
                  Pre-checked when added to a template.
                </p>
              </div>
              <Switch
                checked={autoEnabled}
                onCheckedChange={setAutoEnabled}
                aria-label="Toggle default auto enabled"
              />
            </div>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">{isEdit ? "Save task" : "Add task"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
