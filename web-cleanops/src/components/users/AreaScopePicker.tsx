import { useMemo } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import type { Area, AreaScopeMode } from "@/types";

interface AreaScopePickerProps {
  /** Company whose areas can be granted. */
  companyId: string;
  /** All areas across companies; filtered to the company here. */
  areas: Area[];
  /** Current access mode: every area, or an explicit selection. */
  mode: AreaScopeMode;
  /** Currently selected area ids (only meaningful when mode is "selected"). */
  areaIds: string[];
  onModeChange: (mode: AreaScopeMode) => void;
  onAreaIdsChange: (areaIds: string[]) => void;
}

/**
 * Shared Area Scoped Access picker. Extracted from UserDialog so the User edit
 * surface and the Employee Area Access dialog render and behave identically.
 *
 * Shows active company areas plus any inactive area already assigned (so an
 * existing assignment stays visible and can be removed, but new inactive areas
 * can't be added). Access always belongs to the login's `User.areaScope`.
 */
export function AreaScopePicker({
  companyId,
  areas,
  mode,
  areaIds,
  onModeChange,
  onAreaIdsChange,
}: AreaScopePickerProps) {
  const selectableAreas = useMemo(() => {
    const active = areas.filter((a) => a.companyId === companyId && a.isActive);
    const assignedInactive = areas.filter(
      (a) =>
        a.companyId === companyId &&
        !a.isActive &&
        mode === "selected" &&
        areaIds.includes(a.id),
    );
    return [...active, ...assignedInactive].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [areas, companyId, mode, areaIds]);

  const toggle = (id: string) => {
    onAreaIdsChange(
      areaIds.includes(id) ? areaIds.filter((x) => x !== id) : [...areaIds, id],
    );
  };

  return (
    <div className="space-y-2.5 rounded-lg border border-border p-3.5">
      <div>
        <p className="text-sm font-medium">Area access</p>
        <p className="text-xs text-muted-foreground">
          Limit which operational areas this user can access. Enforced once Area
          Scoped Access is enabled for your company.
        </p>
      </div>
      <Select value={mode} onValueChange={(v) => onModeChange(v as AreaScopeMode)}>
        <SelectTrigger aria-label="Area access mode">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All areas</SelectItem>
          <SelectItem value="selected">Selected areas</SelectItem>
        </SelectContent>
      </Select>

      {mode === "selected" ? (
        selectableAreas.length === 0 ? (
          <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            No active areas yet. Create areas under Settings → Customer / Employee
            Assignment first.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {selectableAreas.map((area) => (
              <label
                key={area.id}
                className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-border px-3 py-2 text-sm"
              >
                <Checkbox
                  checked={areaIds.includes(area.id)}
                  onCheckedChange={() => toggle(area.id)}
                />
                <span>
                  {area.name}
                  {!area.isActive ? (
                    <span className="ml-1 text-xs text-muted-foreground">
                      (inactive)
                    </span>
                  ) : null}
                </span>
              </label>
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}
