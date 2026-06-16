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
import { AreaScopePicker } from "@/components/users/AreaScopePicker";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/hooks/use-toast";
import { normalizeAreaScope } from "@/lib/areaScope";
import type { AreaScope, AreaScopeMode, Employee, User } from "@/types";

interface EmployeeAreaAccessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The employee whose area access is being managed. */
  employee: Employee | null;
  /** The employee's linked login — area access belongs to {@link User.areaScope}. */
  login: User | null;
}

/**
 * Focused dialog for managing an employee's Area Scoped Access. Area access is
 * a login concern, so this edits the linked {@link User.areaScope} via the
 * existing `updateUser` write path — no new write path and no schema change.
 * Reuses {@link AreaScopePicker} so the picker matches the User edit surface.
 *
 * An employee with no linked login can't have area access (access lives on the
 * User); callers must create a login first and only then open this dialog.
 */
export function EmployeeAreaAccessDialog({
  open,
  onOpenChange,
  employee,
  login,
}: EmployeeAreaAccessDialogProps) {
  const { areas, updateUser } = useApp();
  const { toast } = useToast();
  const [mode, setMode] = useState<AreaScopeMode>("all");
  const [areaIds, setAreaIds] = useState<string[]>([]);
  const [error, setError] = useState<string>("");
  const [saving, setSaving] = useState<boolean>(false);

  useEffect(() => {
    if (open) {
      const scope = normalizeAreaScope(login?.areaScope);
      setMode(scope.mode);
      setAreaIds(scope.areaIds);
      setError("");
      setSaving(false);
    }
  }, [open, login]);

  if (!employee || !login) return null;

  const handleSave = () => {
    setError("");
    if (mode === "selected" && areaIds.length === 0) {
      setError("Select at least one area, or choose “All areas”.");
      return;
    }
    const areaScope: AreaScope =
      mode === "selected"
        ? { mode: "selected", areaIds }
        : { mode: "all", areaIds: [] };

    setSaving(true);
    const result = updateUser(login.id, { areaScope });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Unable to update area access.");
      return;
    }
    toast({
      title: "Area access updated",
      description: `${employee.name}'s area access has been saved.`,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Area access — {employee.name}</DialogTitle>
          <DialogDescription>
            Choose which operational areas this employee's login can access.
            Enforced once Area Scoped Access is enabled for your company.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <AreaScopePicker
            companyId={login.companyId ?? employee.companyId}
            areas={areas}
            mode={mode}
            areaIds={areaIds}
            onModeChange={setMode}
            onAreaIdsChange={setAreaIds}
          />

          {error ? (
            <p className="whitespace-pre-line rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
