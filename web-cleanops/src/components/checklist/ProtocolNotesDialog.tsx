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

interface ProtocolNotesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Name of the node being annotated, e.g. "Reception". */
  entityLabel: string;
  /** The level being edited, e.g. "Room". */
  levelLabel: string;
  notes: string;
  onSave: (notes: string) => void;
}

/** Edits a customer-specific note on a protocol node (protocol/floor/room/task). */
export function ProtocolNotesDialog({
  open,
  onOpenChange,
  entityLabel,
  levelLabel,
  notes,
  onSave,
}: ProtocolNotesDialogProps) {
  const [value, setValue] = useState<string>("");

  useEffect(() => {
    if (open) setValue(notes);
  }, [open, notes]);

  const handleSave = () => {
    onSave(value);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Customer note</DialogTitle>
          <DialogDescription>
            {levelLabel}: {entityLabel}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5 py-2">
          <Label htmlFor="protocol-note">Note</Label>
          <Textarea
            id="protocol-note"
            placeholder="e.g. Use blue microfiber cloth"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={4}
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            Customer-specific notes stay on this protocol and never change the template.
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave}>
            Save note
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
