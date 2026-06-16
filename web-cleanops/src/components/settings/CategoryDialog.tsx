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
import type { ChecklistCategory } from "@/types";

interface CategoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pass a category to edit; omit to create a new one. */
  category?: ChecklistCategory | null;
  /** Singular noun for this category type, e.g. "room category". */
  typeLabel: string;
  /**
   * Persists the category. Returns an error message on failure (e.g. a duplicate
   * name) so the dialog can surface it inline and stay open, or null on success.
   */
  onSubmit: (input: { name: string; description?: string }) => string | null;
}

/** Create/edit a single checklist category (name + optional description only). */
export function CategoryDialog({
  open,
  onOpenChange,
  category,
  typeLabel,
  onSubmit,
}: CategoryDialogProps) {
  const isEdit = Boolean(category);
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(category?.name ?? "");
    setDescription(category?.description ?? "");
    setError(null);
  }, [open, category]);

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
          <DialogTitle>
            {isEdit ? `Edit ${typeLabel}` : `New ${typeLabel}`}
          </DialogTitle>
          <DialogDescription>
            Categories help group and filter items across the checklist manager.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="category-name">Name</Label>
            <Input
              id="category-name"
              placeholder="e.g. Bathroom"
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
            <Label htmlFor="category-desc">Description</Label>
            <Textarea
              id="category-desc"
              placeholder="Optional — clarify what this category covers…"
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
            <Button type="submit">{isEdit ? "Save changes" : "Create category"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
