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

interface TaskExclusionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Name of the task being excluded. */
  taskName: string;
  reason: string;
  onSave: (reason: string) => void;
}

/**
 * Captures an optional reason when a protocol task is marked Excluded, so
 * employees understand it was intentionally left out — not forgotten.
 */
export function TaskExclusionDialog({
  open,
  onOpenChange,
  taskName,
  reason,
  onSave,
}: TaskExclusionDialogProps) {
  const [value, setValue] = useState<string>("");

  useEffect(() => {
    if (open) setValue(reason);
  }, [open, reason]);

  const handleSave = () => {
    onSave(value);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Exclusion reason</DialogTitle>
          <DialogDescription>{taskName}</DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5 py-2">
          <Label htmlFor="exclusion-reason">Reason (optional)</Label>
          <Textarea
            id="exclusion-reason"
            placeholder="e.g. Customer has chosen not to include this service."
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={3}
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            Shown alongside the task so employees know it was intentionally excluded.
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave}>
            Save reason
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
