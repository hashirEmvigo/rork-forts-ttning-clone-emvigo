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
import { Switch } from "@/components/ui/switch";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/hooks/use-toast";
import type { ChecklistTemplate } from "@/types";

interface TemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Owning company for new templates; null for a global Super Admin template. */
  companyId: string | null;
  /** Pass a template to edit; omit to create a new one. */
  template?: ChecklistTemplate | null;
  /** Show the "available to companies" control (Super Admin / global templates). */
  showAvailability?: boolean;
}

/** Create or edit a checklist template's name, description and settings. */
export function TemplateDialog({
  open,
  onOpenChange,
  companyId,
  template,
  showAvailability = false,
}: TemplateDialogProps) {
  const { createTemplate, updateTemplate } = useApp();
  const { toast } = useToast();
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [active, setActive] = useState<boolean>(true);
  const [available, setAvailable] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const isEdit = Boolean(template);

  useEffect(() => {
    if (open) {
      setName(template?.name ?? "");
      setDescription(template?.description ?? "");
      setActive(template ? template.status === "active" : true);
      setAvailable(template?.availableToCompanies ?? false);
      setError("");
    }
  }, [open, template]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!name.trim()) {
      setError("Template name is required.");
      return;
    }

    if (template) {
      const result = updateTemplate(template.id, {
        name: name.trim(),
        description: description.trim() || undefined,
        status: active ? "active" : "inactive",
        ...(showAvailability ? { availableToCompanies: available } : {}),
      });
      if (!result.ok) {
        setError(result.error ?? "Unable to save template.");
        return;
      }
    } else {
      const result = createTemplate({
        companyId,
        name: name.trim(),
        description: description.trim() || undefined,
      });
      if (!result.ok) {
        setError(result.error ?? "Unable to create template.");
        return;
      }
    }

    toast({
      title: isEdit ? "Template updated" : "Template created",
      description: `${name.trim()} has been saved.`,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader className="border-b border-border px-6 py-5">
            <DialogTitle>{isEdit ? "Edit template" : "New template"}</DialogTitle>
            <DialogDescription>
              {companyId === null
                ? "A global template you can make available to companies."
                : "A template owned by your company."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 px-6 py-5">
            <div className="space-y-1.5">
              <Label htmlFor="tpl-name">Template name</Label>
              <Input
                id="tpl-name"
                placeholder="e.g. Standard Office Cleaning"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tpl-desc">Description</Label>
              <Textarea
                id="tpl-desc"
                placeholder="What is this checklist used for?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>

            <div className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3">
              <div>
                <p className="text-sm font-medium">Active</p>
                <p className="text-xs text-muted-foreground">
                  Inactive templates stay editable but aren't offered for use.
                </p>
              </div>
              <Switch checked={active} onCheckedChange={setActive} aria-label="Toggle active" />
            </div>

            {showAvailability ? (
              <div className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3">
                <div>
                  <p className="text-sm font-medium">Available to companies</p>
                  <p className="text-xs text-muted-foreground">
                    Let companies adopt this template for their own use.
                  </p>
                </div>
                <Switch
                  checked={available}
                  onCheckedChange={setAvailable}
                  aria-label="Toggle availability"
                />
              </div>
            ) : null}

            {error ? (
              <p className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter className="border-t border-border px-6 py-4">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">{isEdit ? "Save changes" : "Create template"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
