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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

interface ItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Pass an item to edit; omit to create a new one. Only title/description/
   * required are read, so this is reused by both template and customer-protocol
   * item editors.
   */
  item?: { title: string; description?: string; required: boolean } | null;
  /**
   * Persists the item. Returns an error message on failure so the dialog can
   * surface it inline and stay open, or null on success.
   */
  onSubmit: (input: {
    title: string;
    description?: string;
    required: boolean;
  }) => string | null;
}

/** Create/edit a checklist item (title, optional description, required flag). */
export function ItemDialog({ open, onOpenChange, item, onSubmit }: ItemDialogProps) {
  const isEdit = Boolean(item);
  const [title, setTitle] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [required, setRequired] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(item?.title ?? "");
    setDescription(item?.description ?? "");
    setRequired(item?.required ?? false);
    setError(null);
  }, [open, item]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setError("Title is required.");
      return;
    }
    const failure = onSubmit({
      title: trimmed,
      description: description.trim() || undefined,
      required,
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
          <DialogTitle>{isEdit ? "Edit item" : "New item"}</DialogTitle>
          <DialogDescription>
            A single task within a section, e.g. “Clean sink”.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="item-title">Title</Label>
            <Input
              id="item-title"
              placeholder="e.g. Clean sink"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (error) setError(null);
              }}
              autoFocus
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="item-desc">Description</Label>
            <Textarea
              id="item-desc"
              placeholder="Optional — add guidance for this item…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2.5">
            <div className="min-w-0">
              <Label htmlFor="item-required" className="text-sm font-medium">
                Required
              </Label>
              <p className="text-xs text-muted-foreground">
                Mark this item as required rather than optional.
              </p>
            </div>
            <Switch
              id="item-required"
              checked={required}
              onCheckedChange={setRequired}
            />
          </div>
          {error ? (
            <p className="text-sm font-medium text-destructive">{error}</p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">{isEdit ? "Save changes" : "Create item"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
