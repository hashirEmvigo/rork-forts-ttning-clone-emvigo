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
import type { FloorPreset } from "@/types";

interface FloorPresetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pass a preset to edit; omit to create a new one. */
  preset?: FloorPreset | null;
  /**
   * Persists the preset. Returns an error message on failure (e.g. a duplicate
   * name) so the dialog can surface it inline and stay open, or null on success.
   */
  onSubmit: (input: { name: string; description?: string }) => string | null;
}

/** Create/edit a single floor preset (name + optional description only). */
export function FloorPresetDialog({
  open,
  onOpenChange,
  preset,
  onSubmit,
}: FloorPresetDialogProps) {
  const isEdit = Boolean(preset);
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(preset?.name ?? "");
    setDescription(preset?.description ?? "");
    setError(null);
  }, [open, preset]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required.");
      return;
    }
    const failure = onSubmit({
      name: trimmed,
      description: description.trim() || undefined,
    });
    if (failure) {
      setError(failure);
      return;
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit floor preset" : "New floor preset"}</DialogTitle>
          <DialogDescription>
            Reusable floor levels offered when building checklist protocols.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="floor-name">Name</Label>
            <Input
              id="floor-name"
              placeholder="e.g. Ground floor"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              autoFocus
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="floor-desc">Description</Label>
            <Textarea
              id="floor-desc"
              placeholder="Optional — clarify what this level covers…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
          {error ? (
            <p className="text-sm font-medium text-destructive">{error}</p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">{isEdit ? "Save changes" : "Create preset"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
