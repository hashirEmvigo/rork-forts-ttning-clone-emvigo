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
import { useApp } from "@/context/AppContext";
import { useToast } from "@/hooks/use-toast";
import type { Company } from "@/types";

interface CompanyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pass a company to edit; omit to create a new one. */
  company?: Company | null;
}

export function CompanyDialog({ open, onOpenChange, company }: CompanyDialogProps) {
  const { createCompany, updateCompany } = useApp();
  const { toast } = useToast();
  const [name, setName] = useState<string>("");
  const [active, setActive] = useState<boolean>(true);
  const isEdit = Boolean(company);

  useEffect(() => {
    if (open) {
      setName(company?.name ?? "");
      setActive(company ? company.status === "active" : true);
    }
  }, [open, company]);

  const [saving, setSaving] = useState<boolean>(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || saving) return;
    const status = active ? "active" : "inactive";
    setSaving(true);
    try {
      if (company) {
        const result = await updateCompany(company.id, { name: name.trim(), status });
        if (result.ok === false) {
          toast({ title: "Could not save company", description: result.error, variant: "destructive" });
          return;
        }
        toast({ title: "Company updated", description: `${name.trim()} has been saved.` });
      } else {
        const result = await createCompany(name.trim(), status);
        if (result.ok === false) {
          toast({ title: "Could not create company", description: result.error, variant: "destructive" });
          return;
        }
        toast({ title: "Company created", description: `${name.trim()} is now on the platform.` });
      }
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit company" : "New company"}</DialogTitle>
            <DialogDescription>
              {isEdit
                ? "Update the company details and status."
                : "Add a new company to the platform. They'll get their own workspace."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-5">
            <div className="space-y-1.5">
              <Label htmlFor="company-name">Company name</Label>
              <Input
                id="company-name"
                placeholder="e.g. Nordlys Cleaning AS"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                required
              />
            </div>

            {company ? (
              <div className="space-y-1.5">
                <Label>Company ID</Label>
                <p className="rounded-lg border border-border bg-muted px-3 py-2 font-mono text-sm text-muted-foreground">
                  {company.id}
                </p>
              </div>
            ) : null}

            <div className="flex items-center justify-between rounded-lg border border-border p-3.5">
              <div>
                <p className="text-sm font-medium">Active</p>
                <p className="text-xs text-muted-foreground">
                  Inactive companies can't be accessed by their users.
                </p>
              </div>
              <Switch checked={active} onCheckedChange={setActive} />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : isEdit ? "Save changes" : "Create company"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
