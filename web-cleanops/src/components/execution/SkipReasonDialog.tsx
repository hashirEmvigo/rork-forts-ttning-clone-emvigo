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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface SkipReasonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Title of the item being skipped (shown for context). */
  itemTitle?: string;
  /** Confirms the skip with a non-empty reason. */
  onConfirm: (reason: string) => void;
}

/**
 * Captures the required reason when an employee marks a protocol run item as
 * skipped. The confirm action stays disabled until a reason is entered, enforcing
 * the "skip requires a reason" rule from the UI side (the store records it).
 */
export function SkipReasonDialog({
  open,
  onOpenChange,
  itemTitle,
  onConfirm,
}: SkipReasonDialogProps) {
  const [reason, setReason] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setReason("");
    setError(null);
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = reason.trim();
    if (!trimmed) {
      setError("A reason is required to skip this item.");
      return;
    }
    onConfirm(trimmed);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Skip item</DialogTitle>
          <DialogDescription>
            {itemTitle
              ? `Add a reason for skipping “${itemTitle}”.`
              : "Add a reason for skipping this item."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="skip-reason">Reason</Label>
            <Textarea
              id="skip-reason"
              placeholder="e.g. Area was inaccessible during the visit"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (error) setError(null);
              }}
              rows={3}
              autoFocus
            />
          </div>
          {error ? (
            <p className="text-sm font-medium text-destructive">{error}</p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Skip item</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
