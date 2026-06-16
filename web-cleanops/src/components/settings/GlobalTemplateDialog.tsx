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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TEMPLATE_AUDIENCE_LABELS, type TemplateAudience } from "@/types";

export interface GlobalTemplateDialogSubmit {
  name: string;
  description?: string;
  audience?: TemplateAudience;
}

interface GlobalTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pass a template to edit; omit to create a new one. */
  template?: {
    name: string;
    description?: string;
    audience?: TemplateAudience;
  } | null;
  /**
   * Persists the global template metadata. Returns an error message on failure
   * (e.g. a duplicate name) so the dialog can surface it inline and stay open,
   * or null on success.
   */
  onSubmit: (input: GlobalTemplateDialogSubmit) => string | null;
}

/**
 * Create/edit global template metadata (name + description). Unlike company
 * templates, the system-owned global library has no company-scoped category or
 * floor-preset vocabulary to bind to, so binding selection is intentionally
 * omitted here — sections and items are managed in the global builder.
 */
export function GlobalTemplateDialog({
  open,
  onOpenChange,
  template,
  onSubmit,
}: GlobalTemplateDialogProps) {
  const isEdit = Boolean(template);
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [audience, setAudience] = useState<TemplateAudience | "">("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(template?.name ?? "");
    setDescription(template?.description ?? "");
    setAudience(template?.audience ?? "");
    setError(null);
  }, [open, template]);

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
      audience: audience || undefined,
    });
    if (failure) {
      setError(failure);
      return;
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit global template" : "New global template"}
          </DialogTitle>
          <DialogDescription>
            System-owned, best-practice templates companies start from. Edits
            only affect future copies.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="global-template-name">Name</Label>
            <Input
              id="global-template-name"
              placeholder="e.g. Office Cleaning"
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
            <Label htmlFor="global-template-desc">Description</Label>
            <Textarea
              id="global-template-desc"
              placeholder="Optional — summarize what this template covers…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="global-template-audience">Audience</Label>
            <Select
              value={audience === "" ? "none" : audience}
              onValueChange={(v) =>
                setAudience(v === "none" ? "" : (v as TemplateAudience))
              }
            >
              <SelectTrigger id="global-template-audience">
                <SelectValue placeholder="Not set" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not set</SelectItem>
                {(
                  Object.keys(TEMPLATE_AUDIENCE_LABELS) as TemplateAudience[]
                ).map((value) => (
                  <SelectItem key={value} value={value}>
                    {TEMPLATE_AUDIENCE_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Helps companies find the right starting template.
            </p>
          </div>

          {error ? (
            <p className="text-sm font-medium text-destructive">{error}</p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">
              {isEdit ? "Save changes" : "Create template"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
