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
import { PAYROLL_EXPORT_TARGET_LABELS } from "@/types";
import type { PayrollExportProfile, PayrollExportTargetKey } from "@/types";

interface PayrollExportProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pass a profile to edit; omit to create a new one. */
  profile?: PayrollExportProfile | null;
  /** The company the profile belongs to. */
  companyId: string;
  /** Targets the company is entitled to use (drives the create picker). */
  availableTargets: PayrollExportTargetKey[];
}

/**
 * Create/edit a single payroll export profile. On create, the target is chosen
 * from the company's enabled targets; on edit, the target is fixed (changing the
 * destination is intentionally a new profile, keeping run history coherent).
 */
export function PayrollExportProfileDialog({
  open,
  onOpenChange,
  profile,
  companyId,
  availableTargets,
}: PayrollExportProfileDialogProps) {
  const {
    createPayrollExportProfile,
    updatePayrollExportProfile,
    setPayrollExportProfileActive,
  } = useApp();
  const { toast } = useToast();
  const isEdit = Boolean(profile);

  const [name, setName] = useState<string>("");
  const [target, setTarget] = useState<PayrollExportTargetKey | "">("");
  const [active, setActive] = useState<boolean>(true);

  useEffect(() => {
    if (!open) return;
    setName(profile?.name ?? "");
    setTarget(profile?.target ?? availableTargets[0] ?? "");
    setActive(profile?.active ?? true);
  }, [open, profile, availableTargets]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    if (profile) {
      const result = updatePayrollExportProfile(profile.id, { name: name.trim() });
      if (!result.ok) {
        toast({ title: "Couldn't save", description: result.error, variant: "destructive" });
        return;
      }
      if (active !== profile.active) {
        const toggled = setPayrollExportProfileActive(profile.id, active);
        if (!toggled.ok) {
          toast({
            title: "Couldn't update status",
            description: toggled.error,
            variant: "destructive",
          });
          return;
        }
      }
      toast({ title: "Profile updated", description: `${name.trim()} saved.` });
      onOpenChange(false);
      return;
    }

    if (!target) {
      toast({ title: "Pick an export type", variant: "destructive" });
      return;
    }
    const result = createPayrollExportProfile({
      companyId,
      name: name.trim(),
      target,
      active,
    });
    if (!result.ok) {
      toast({ title: "Couldn't create", description: result.error, variant: "destructive" });
      return;
    }
    toast({ title: "Profile created", description: `${name.trim()} added.` });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit export profile" : "New export profile"}</DialogTitle>
          <DialogDescription>
            A company-specific payroll export setup. Credentials are never stored here — only
            non-secret configuration.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="pep-name">Name</Label>
            <Input
              id="pep-name"
              placeholder="e.g. Monthly payroll CSV"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label>Export type</Label>
            {isEdit ? (
              <Input value={PAYROLL_EXPORT_TARGET_LABELS[profile!.target]} disabled />
            ) : (
              <Select value={target} onValueChange={(v) => setTarget(v as PayrollExportTargetKey)}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose an enabled export type" />
                </SelectTrigger>
                <SelectContent>
                  {availableTargets.map((t) => (
                    <SelectItem key={t} value={t}>
                      {PAYROLL_EXPORT_TARGET_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {!isEdit && availableTargets.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No export types are enabled for your company yet.
              </p>
            ) : null}
          </div>

          <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
            <div>
              <p className="text-sm font-medium">Active</p>
              <p className="text-xs text-muted-foreground">
                Only active profiles can be used to run exports.
              </p>
            </div>
            <Switch checked={active} onCheckedChange={setActive} />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!isEdit && availableTargets.length === 0}>
              {isEdit ? "Save changes" : "Create profile"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
