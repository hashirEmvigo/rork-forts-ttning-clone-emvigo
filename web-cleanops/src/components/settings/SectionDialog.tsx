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

interface SectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Pass a section to edit; omit to create a new one. Only the title is read,
   * so this is reused by both template and customer-protocol section editors.
   */
  section?: { title: string } | null;
  /**
   * Persists the section title. Returns an error message on failure so the
   * dialog can surface it inline and stay open, or null on success.
   */
  onSubmit: (input: { title: string }) => string | null;
}

/** Create/edit a checklist section (title only). */
export function SectionDialog({
  open,
  onOpenChange,
  section,
  onSubmit,
}: SectionDialogProps) {
  const isEdit = Boolean(section);
  const [title, setTitle] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(section?.title ?? "");
    setError(null);
  }, [open, section]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setError("Title is required.");
      return;
    }
    const failure = onSubmit({ title: trimmed });
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
          <DialogTitle>{isEdit ? "Edit section" : "New section"}</DialogTitle>
          <DialogDescription>
            Sections group checklist items inside a template, e.g. Kitchen or Bathroom.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="section-title">Title</Label>
            <Input
              id="section-title"
              placeholder="e.g. Kitchen"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (error) setError(null);
              }}
              autoFocus
              required
            />
          </div>
          {error ? (
            <p className="text-sm font-medium text-destructive">{error}</p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">{isEdit ? "Save changes" : "Create section"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
