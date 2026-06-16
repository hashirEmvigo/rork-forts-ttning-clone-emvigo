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
import { ROOM_LIBRARY_CATEGORIES, type LibraryRoom, type RoomLibraryCategory } from "@/types";

export interface LibraryRoomFormValues {
  name: string;
  description?: string;
  suggestedFloorType?: string;
  category: RoomLibraryCategory;
}

interface LibraryRoomDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pass a room to edit; omit to create a new one. */
  room?: LibraryRoom | null;
  scopeLabel: string;
  /** Returns an error message to display, or null/undefined on success. */
  onSubmit: (values: LibraryRoomFormValues) => string | null | undefined;
}

/** Create or edit a reusable Room Library item. */
export function LibraryRoomDialog({
  open,
  onOpenChange,
  room,
  scopeLabel,
  onSubmit,
}: LibraryRoomDialogProps) {
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [floorType, setFloorType] = useState<string>("");
  const [category, setCategory] = useState<RoomLibraryCategory>("office");
  const [error, setError] = useState<string>("");
  const isEdit = Boolean(room);

  useEffect(() => {
    if (open) {
      setName(room?.name ?? "");
      setDescription(room?.description ?? "");
      setFloorType(room?.suggestedFloorType ?? "");
      setCategory(room?.category ?? "office");
      setError("");
    }
  }, [open, room]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Room name is required.");
      return;
    }
    const result = onSubmit({
      name: name.trim(),
      description: description.trim() || undefined,
      suggestedFloorType: floorType.trim() || undefined,
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
            <DialogTitle>{isEdit ? "Edit room" : "New room"}</DialogTitle>
            <DialogDescription>{scopeLabel}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="lib-room-name">Room name</Label>
              <Input
                id="lib-room-name"
                placeholder="e.g. Conference Room"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="lib-room-desc">Description</Label>
              <Textarea
                id="lib-room-desc"
                placeholder="Optional details about this room type"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select
                  value={category}
                  onValueChange={(v) => setCategory(v as RoomLibraryCategory)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROOM_LIBRARY_CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lib-room-floor">Suggested floor</Label>
                <Input
                  id="lib-room-floor"
                  placeholder="Optional"
                  value={floorType}
                  onChange={(e) => setFloorType(e.target.value)}
                />
              </div>
            </div>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">{isEdit ? "Save room" : "Add room"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
