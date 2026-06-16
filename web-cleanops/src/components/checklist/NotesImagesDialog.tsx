import { useEffect, useState } from "react";
import { ImagePlus, Link2, Trash2 } from "lucide-react";

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
import { useToast } from "@/hooks/use-toast";
import { makeId } from "@/lib/store";
import { MediaImage } from "@/components/media/MediaImage";
import { MediaUploader } from "@/components/media/MediaUploader";
import type { ChecklistImage } from "@/types";

interface NotesImagesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Name of the entity being edited, e.g. "Reception" or "Ground Floor". */
  entityLabel: string;
  /** What kind of node: shown in the dialog title. */
  levelLabel: string;
  notes: string;
  images: ChecklistImage[];
  /** Persist the edited notes and images. */
  onSave: (notes: string, images: ChecklistImage[]) => void;
}

/** Edits notes and reference images attached to a checklist template node. */
export function NotesImagesDialog({
  open,
  onOpenChange,
  entityLabel,
  levelLabel,
  notes,
  images,
  onSave,
}: NotesImagesDialogProps) {
  const { toast } = useToast();
  const [draftNotes, setDraftNotes] = useState<string>("");
  const [draftImages, setDraftImages] = useState<ChecklistImage[]>([]);
  const [url, setUrl] = useState<string>("");

  useEffect(() => {
    if (open) {
      setDraftNotes(notes);
      setDraftImages(images);
      setUrl("");
    }
  }, [open, notes, images]);

  const addUrl = () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setDraftImages((prev) => [...prev, { id: makeId("img"), url: trimmed }]);
    setUrl("");
  };

  const removeImage = (id: string) =>
    setDraftImages((prev) => prev.filter((img) => img.id !== id));

  const setCaption = (id: string, caption: string) =>
    setDraftImages((prev) =>
      prev.map((img) => (img.id === id ? { ...img, caption: caption || undefined } : img)),
    );

  const handleSave = () => {
    onSave(draftNotes, draftImages);
    toast({ title: "Saved", description: `Notes & images updated for ${entityLabel}.` });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="border-b border-border px-6 py-5">
          <DialogTitle>Notes & images</DialogTitle>
          <DialogDescription>
            {levelLabel}: {entityLabel}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-5 overflow-y-auto px-6 py-5">
          <div className="space-y-1.5">
            <Label htmlFor="ni-notes">Notes</Label>
            <Textarea
              id="ni-notes"
              placeholder="Training, instructions or quality guidance…"
              value={draftNotes}
              onChange={(e) => setDraftNotes(e.target.value)}
              rows={4}
            />
          </div>

          <div className="space-y-2.5">
            <Label>Images</Label>

            {draftImages.length > 0 ? (
              <ul className="space-y-2">
                {draftImages.map((img) => (
                  <li
                    key={img.id}
                    className="flex items-center gap-3 rounded-xl border border-border bg-card p-2"
                  >
                    {img.microThumbnailUrl && img.hoverThumbnailUrl && img.previewImageUrl ? (
                      <MediaImage
                        source={{
                          microThumbnailUrl: img.microThumbnailUrl,
                          hoverThumbnailUrl: img.hoverThumbnailUrl,
                          previewImageUrl: img.previewImageUrl,
                          caption: img.caption,
                        }}
                        size="thumb"
                      />
                    ) : (
                      <span className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-muted">
                        {/* eslint-disable-next-line jsx-a11y/img-redundant-alt */}
                        <img
                          src={img.url}
                          alt={img.caption ?? "Reference image"}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      </span>
                    )}
                    <Input
                      value={img.caption ?? ""}
                      onChange={(e) => setCaption(img.id, e.target.value)}
                      placeholder="Caption (optional)"
                      className="h-9"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => removeImage(img.id)}
                      aria-label="Remove image"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 px-4 py-6 text-center">
                <ImagePlus className="h-5 w-5 text-muted-foreground" />
                <p className="mt-2 text-xs text-muted-foreground">No images yet.</p>
              </div>
            )}

            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addUrl();
                    }
                  }}
                  placeholder="Paste image URL"
                  className="h-9 pl-9"
                />
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addUrl} disabled={!url.trim()}>
                Add
              </Button>
              <MediaUploader
                onProcessed={(processed) =>
                  setDraftImages((prev) => [
                    ...prev,
                    {
                      id: makeId("img"),
                      url: processed.preview.url,
                      microThumbnailUrl: processed.micro.url,
                      hoverThumbnailUrl: processed.hover.url,
                      previewImageUrl: processed.preview.url,
                    },
                  ])
                }
              />
            </div>
          </div>
        </div>

        <DialogFooter className="border-t border-border px-6 py-4">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
