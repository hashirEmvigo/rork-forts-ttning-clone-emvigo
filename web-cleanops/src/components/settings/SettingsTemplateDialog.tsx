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
import { SettingsDataEditor } from "@/components/settings/SettingsDataEditor";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/hooks/use-toast";
import { emptySettingsData } from "@/types";
import type { SettingsData, SettingsTemplate } from "@/types";

interface SettingsTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pass a template to edit; omit to create a new one. */
  template?: SettingsTemplate | null;
}

const NO_PACKAGE = "__none__";

export function SettingsTemplateDialog({ open, onOpenChange, template }: SettingsTemplateDialogProps) {
  const { createSettingsTemplate, updateSettingsTemplate, getSelectableServicePackages } = useApp();
  const { toast } = useToast();
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [packageId, setPackageId] = useState<string>(NO_PACKAGE);
  const [data, setData] = useState<SettingsData>(() => emptySettingsData());
  const isEdit = Boolean(template);
  const packages = getSelectableServicePackages();

  useEffect(() => {
    if (open) {
      setName(template?.name ?? "");
      setDescription(template?.description ?? "");
      setPackageId(template?.recommendedServicePackageId ?? NO_PACKAGE);
      setData(template ? structuredClone(template.data) : emptySettingsData());
    }
  }, [open, template]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const recommendedServicePackageId = packageId === NO_PACKAGE ? null : packageId;
    const result = template
      ? updateSettingsTemplate(template.id, {
          name: name.trim(),
          description,
          data,
          recommendedServicePackageId,
        })
      : createSettingsTemplate({
          name: name.trim(),
          description,
          data,
          recommendedServicePackageId,
        });
    if (!result.ok) {
      toast({ title: "Couldn't save", description: result.error, variant: "destructive" });
      return;
    }
    toast({
      title: isEdit ? "Template updated" : "Template created",
      description: `${name.trim()} has been saved.`,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit settings template" : "New settings template"}</DialogTitle>
          <DialogDescription>
            Define default settings companies can copy into their workspace at setup.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto py-2 pr-1">
            <div className="space-y-1.5">
              <Label htmlFor="tpl-name">Template name</Label>
              <Input
                id="tpl-name"
                placeholder="e.g. Sweden"
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
                placeholder="What this template is for…"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Recommended service package</Label>
              <Select value={packageId} onValueChange={setPackageId}>
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PACKAGE}>None</SelectItem>
                  {packages.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Services are managed in Settings → Services. A company can copy this
                package into its catalog when starting from the template.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Default values</Label>
              <SettingsDataEditor data={data} onChange={setData} />
            </div>
          </div>

          <DialogFooter className="mt-4 border-t border-border pt-4">
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
