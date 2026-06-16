import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import type { CleaningTask } from "@/types";

export interface TaskFormValues {
  name: string;
  description?: string;
  autoEnabled: boolean;
}

interface TaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pass a task to edit; omit to create a new one. */
  task?: CleaningTask | null;
  /** Returns an error message to display, or null/undefined on success. */
  onSubmit: (values: TaskFormValues) => string | null | undefined;
}

/** Create or edit a cleaning task: name, description and auto-enabled state. */
export function TaskDialog({ open, onOpenChange, task, onSubmit }: TaskDialogProps) {
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [autoEnabled, setAutoEnabled] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const isEdit = Boolean(task);

  useEffect(() => {
    if (open) {
      setName(task?.name ?? "");
      setDescription(task?.description ?? "");
      setAutoEnabled(task?.autoEnabled ?? true);
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
      autoEnabled,
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
            <DialogDescription>
              A cleaning task carried out within this room.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="task-name">Task name</Label>
              <Input
                id="task-name"
                placeholder="e.g. Wipe and disinfect surfaces"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="task-desc">Description</Label>
              <Textarea
                id="task-desc"
                placeholder="Optional details or instructions"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>

            <div className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3">
              <div>
                <p className="text-sm font-medium">Auto enabled</p>
                <p className="text-xs text-muted-foreground">
                  Pre-checked when the checklist is used.
                </p>
              </div>
              <Switch
                checked={autoEnabled}
                onCheckedChange={setAutoEnabled}
                aria-label="Toggle auto enabled"
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
