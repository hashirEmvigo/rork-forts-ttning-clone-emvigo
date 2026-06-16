import { useMemo, useState } from "react";
import { Building, Check, ChevronDown, Power, RotateCcw, Pencil, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/hooks/use-toast";
import { AutoAreaToggle } from "@/components/settings/AutoAreaToggle";

interface PostalCitiesPanelProps {
  companyId: string;
  /** Hide the section heading + description (when wrapped in a collapsible). */
  hideHeading?: boolean;
  /** Hide the automation toggle (rendered elsewhere, e.g. grouped controls). */
  hideAutomationToggle?: boolean;
  /** Nest inactive postal cities inside a collapsed subsection. */
  nestInactive?: boolean;
}

/**
 * Settings → Customer / Employee Assignment → Postal Cities.
 *
 * Company Admins manage postal cities and map each to an Area. Active areas
 * only are selectable. Inactive postal cities stay visible here (for restore /
 * edit) but are hidden from customer dropdowns. Also exposes the company-level
 * "Automatically assign Area from Postal City" toggle.
 */
export function PostalCitiesPanel({
  companyId,
  hideHeading = false,
  hideAutomationToggle = false,
  nestInactive = false,
}: PostalCitiesPanelProps) {
  const {
    areas,
    postalCities,
    createPostalCity,
    updatePostalCity,
    archivePostalCity,
    restorePostalCity,
  } = useApp();
  const { toast } = useToast();

  const activeAreas = useMemo(
    () =>
      areas
        .filter((a) => a.companyId === companyId && a.isActive)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [areas, companyId],
  );

  const areaName = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of areas) map.set(a.id, a.name);
    return map;
  }, [areas]);

  const companyCities = useMemo(
    () =>
      postalCities
        .filter((c) => c.companyId === companyId)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [postalCities, companyId],
  );
  const activeCities = companyCities.filter((c) => c.isActive);
  const inactiveCities = companyCities.filter((c) => !c.isActive);

  const [newName, setNewName] = useState<string>("");
  const [newAreaId, setNewAreaId] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState<string>("");
  const [editAreaId, setEditAreaId] = useState<string>("");

  const handleCreate = () => {
    if (!newName.trim()) {
      toast({ title: "Enter a postal city name", variant: "destructive" });
      return;
    }
    if (!newAreaId) {
      toast({ title: "Select an area", variant: "destructive" });
      return;
    }
    const res = createPostalCity({ companyId, name: newName, areaId: newAreaId });
    if (!res.ok) {
      toast({ title: "Couldn't create postal city", description: res.error, variant: "destructive" });
      return;
    }
    setNewName("");
    setNewAreaId("");
    toast({ title: "Postal city created" });
  };

  const startEdit = (id: string, name: string, areaId: string) => {
    setEditingId(id);
    setEditName(name);
    setEditAreaId(areaId);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName("");
    setEditAreaId("");
  };

  const saveEdit = (id: string) => {
    const res = updatePostalCity(id, { name: editName, areaId: editAreaId });
    if (!res.ok) {
      toast({ title: "Couldn't save postal city", description: res.error, variant: "destructive" });
      return;
    }
    cancelEdit();
    toast({ title: "Postal city updated" });
  };

  const inactiveList = (
    <ul className="space-y-2">
      {inactiveCities.map((city) => (
        <li
          key={city.id}
          className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-border bg-muted/20 px-4 py-3"
        >
          <div className="min-w-0">
            <p className="truncate font-medium text-muted-foreground">{city.name}</p>
            <p className="truncate text-sm text-muted-foreground/70">
              {areaName.get(city.areaId) ?? "Area unavailable"}
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              restorePostalCity(city.id);
              toast({ title: "Postal city reactivated" });
            }}
          >
            <RotateCcw className="h-4 w-4" /> Reactivate
          </Button>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="space-y-8">
      <section>
        {hideHeading ? null : (
          <>
            <div className="mb-1 flex items-center gap-2">
              <Building className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">Postal Cities</h3>
            </div>
            <p className="mb-4 text-sm text-muted-foreground">
              Map postal cities (e.g. Mölndal, Partille) to Areas. When a customer
              selects a postal city, its Area can be suggested or assigned
              automatically.
            </p>
          </>
        )}

        {activeAreas.length === 0 ? (
          <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            Create at least one Area above before adding postal cities.
          </p>
        ) : (
          <>
            {/* Create */}
            <div className="mb-5 flex flex-col gap-2 rounded-xl border border-border bg-muted/30 p-3 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="pcity-name">New postal city</Label>
                <Input
                  id="pcity-name"
                  placeholder="e.g. Mölndal"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreate();
                  }}
                />
              </div>
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="pcity-area">Area</Label>
                <Select value={newAreaId} onValueChange={setNewAreaId}>
                  <SelectTrigger id="pcity-area">
                    <SelectValue placeholder="Select an area" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeAreas.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleCreate}>
                <Plus className="h-4 w-4" /> Add
              </Button>
            </div>

            {/* Active postal cities */}
            {activeCities.length === 0 ? (
              <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
                No active postal cities yet. Create your first above.
              </p>
            ) : (
              <ul className="space-y-2">
                {activeCities.map((city) => (
                  <li
                    key={city.id}
                    className="rounded-xl border border-border bg-card px-4 py-3"
                  >
                    {editingId === city.id ? (
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="sm:max-w-[200px]"
                          placeholder="Postal city name"
                        />
                        <Select value={editAreaId} onValueChange={setEditAreaId}>
                          <SelectTrigger className="flex-1">
                            <SelectValue placeholder="Select an area" />
                          </SelectTrigger>
                          <SelectContent>
                            {activeAreas.map((a) => (
                              <SelectItem key={a.id} value={a.id}>
                                {a.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <div className="flex items-center gap-1.5">
                          <Button size="sm" onClick={() => saveEdit(city.id)}>
                            <Check className="h-4 w-4" /> Save
                          </Button>
                          <Button size="sm" variant="ghost" onClick={cancelEdit}>
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">{city.name}</p>
                          <p className="truncate text-sm text-muted-foreground">
                            {areaName.get(city.areaId) ?? "Area unavailable"}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => startEdit(city.id, city.name, city.areaId)}
                          >
                            <Pencil className="h-4 w-4" /> Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive focus:text-destructive"
                            onClick={() => {
                              archivePostalCity(city.id);
                              toast({ title: "Postal city deactivated" });
                            }}
                          >
                            <Power className="h-4 w-4" /> Deactivate
                          </Button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {/* Inactive postal cities */}
            {inactiveCities.length > 0 ? (
              nestInactive ? (
                <Collapsible className="mt-6">
                  <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2 text-left">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Inactive postal cities ({inactiveCities.length})
                    </span>
                    <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-2">{inactiveList}</CollapsibleContent>
                </Collapsible>
              ) : (
                <div className="mt-6">
                  <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Inactive
                  </h4>
                  {inactiveList}
                </div>
              )
            ) : null}
          </>
        )}
      </section>

      {/* Automatic Area assignment */}
      {hideAutomationToggle ? null : (
        <section>
          <AutoAreaToggle />
        </section>
      )}
    </div>
  );
}
