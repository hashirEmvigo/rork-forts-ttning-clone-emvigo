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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/hooks/use-toast";
import { TIME_CODE_TYPES } from "@/types";
import type { TimeCode, TimeCodeType } from "@/types";

interface TimeCodeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pass a time code to edit; omit to create a new one. */
  timeCode?: TimeCode | null;
}

/** Create/edit a single master time code. */
export function TimeCodeDialog({ open, onOpenChange, timeCode }: TimeCodeDialogProps) {
  const { createTimeCode, updateTimeCode, setTimeCodeActive } = useApp();
  const { toast } = useToast();
  const isEdit = Boolean(timeCode);

  const [code, setCode] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [type, setType] = useState<TimeCodeType>("attendance");
  const [description, setDescription] = useState<string>("");
  const [active, setActive] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);

  useEffect(() => {
    if (!open) return;
    setCode(timeCode?.code ?? "");
    setName(timeCode?.name ?? "");
    setType(timeCode?.type ?? "attendance");
    setDescription(timeCode?.description ?? "");
    setActive(timeCode?.active ?? true);
  }, [open, timeCode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || !name.trim() || saving) return;

    setSaving(true);
    try {
      if (timeCode) {
        // Authoritative path: persist to Supabase BEFORE closing the dialog. The
        // directory refetches on success so the UI reflects the true stored row.
        const result = await updateTimeCode(timeCode.id, {
          code: code.trim(),
          name: name.trim(),
          type,
          description: description.trim() || undefined,
        });
        if (!result.ok) {
          toast({ title: "Couldn't save", description: result.error, variant: "destructive" });
          return;
        }
        // Active state is managed separately so it can be audited as activate/deactivate.
        if (active !== timeCode.active) {
          const toggled = await setTimeCodeActive(timeCode.id, active);
          if (!toggled.ok) {
            toast({ title: "Couldn't update status", description: toggled.error, variant: "destructive" });
            return;
          }
        }
        toast({ title: "Time code updated", description: `${code.trim()} — ${name.trim()} saved.` });
        onOpenChange(false);
        return;
      }

      const result = await createTimeCode({
        code: code.trim(),
        name: name.trim(),
        type,
        description: description.trim() || undefined,
        active,
      });
      if (!result.ok) {
        toast({ title: "Couldn't create", description: result.error, variant: "destructive" });
        return;
      }
      toast({ title: "Time code created", description: `${code.trim()} — ${name.trim()} added.` });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit time code" : "New time code"}</DialogTitle>
          <DialogDescription>
            Payroll-foundation master data used across salary basis, attendance and
            absence reporting.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
            <div className="space-y-1.5">
              <Label htmlFor="tc-code">Code</Label>
              <Input
                id="tc-code"
                placeholder="e.g. 10"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoFocus
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tc-name">Name</Label>
              <Input
                id="tc-name"
                placeholder="e.g. Worked Time"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as TimeCodeType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIME_CODE_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tc-desc">Description</Label>
            <Textarea
              id="tc-desc"
              placeholder="What this time code represents…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
            <div>
              <p className="text-sm font-medium">Active</p>
              <p className="text-xs text-muted-foreground">
                Inactive codes stay for history but can't be assigned to services.
              </p>
            </div>
            <Switch checked={active} onCheckedChange={setActive} />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : isEdit ? "Save changes" : "Create time code"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
