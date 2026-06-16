import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Building,
  Check,
  ChevronDown,
  ClipboardCheck,
  Gauge,
  MapPin,
  Pencil,
  Plus,
  Power,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Wand2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/hooks/use-toast";
import type { AreaActivationPrecheck } from "@/lib/areaScopeActivation";
import {
  buildAreaReadinessSummary,
  getApplicableAreaSuggestions,
} from "@/lib/areaReadiness";
import { PostalCitiesPanel } from "@/components/settings/PostalCitiesPanel";
import { AutoAreaToggle } from "@/components/settings/AutoAreaToggle";

interface CustomerAssignmentPanelProps {
  companyId: string;
  /**
   * Called after a review/cleanup link navigates away. Used when the panel is
   * hosted in a dialog (e.g. the Customer page Area setup shortcut) so the
   * dialog can close itself when the admin jumps to a filtered customer list.
   */
  onAfterNavigate?: () => void;
  /**
   * Compact "setup assistant" layout for the Customer page dialog: readiness
   * stays visible, feature toggles are grouped together, and the Areas /
   * Postal Cities sections collapse by default with inactive records nested.
   * Defaults to the full Settings layout.
   */
  compact?: boolean;
}

/**
 * Settings → Customer / Employee Assignment.
 *
 * First section: Areas. Company Admins manage the structured operational areas
 * (Gothenburg, Stockholm, …) that customers can be assigned to. Areas are a
 * foundation for future assignment rules, scheduling and reporting — this panel
 * only handles area CRUD (create, rename/describe, deactivate, reactivate).
 * Automatic employee-assignment rules and Customer Owner are intentionally not
 * built here yet.
 */
export function CustomerAssignmentPanel({
  companyId,
  onAfterNavigate,
  compact = false,
}: CustomerAssignmentPanelProps) {
  const {
    areas,
    customers,
    postalCities,
    updateCustomer,
    createArea,
    updateArea,
    archiveArea,
    restoreArea,
    areaScopedAccessEnabled,
    getAreaActivationPrecheck,
    setAreaScopedAccessEnabled,
  } = useApp();
  const { toast } = useToast();
  const navigate = useNavigate();

  // Navigate to a filtered customer list, then let a host dialog close itself.
  const reviewCustomers = (filter: "missing" | "suggested" | "manual") => {
    navigate(`/customers?area=${filter}`);
    onAfterNavigate?.();
  };

  // Confirmation gate for the bulk "Apply all suggested Areas" action.
  const [bulkOpen, setBulkOpen] = useState<boolean>(false);

  // Holds the blocking pre-check after a failed activation so we can guide cleanup.
  const [blockedPrecheck, setBlockedPrecheck] = useState<AreaActivationPrecheck | null>(
    null,
  );

  const handleToggleAreaScopedAccess = () => {
    if (areaScopedAccessEnabled) {
      setAreaScopedAccessEnabled(false);
      setBlockedPrecheck(null);
      toast({ title: "Area Scoped Access disabled" });
      return;
    }
    const result = setAreaScopedAccessEnabled(true);
    if (result.ok) {
      setBlockedPrecheck(null);
      toast({ title: "Area Scoped Access enabled" });
      return;
    }
    setBlockedPrecheck(result.precheck ?? null);
    const count = result.precheck?.counts.blocking ?? 0;
    toast({
      title: "Activation blocked",
      description: `${count} active customer${count === 1 ? "" : "s"} still need an Area.`,
      variant: "destructive",
    });
  };

  const companyAreas = useMemo(
    () =>
      areas
        .filter((a) => a.companyId === companyId)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [areas, companyId],
  );
  const active = companyAreas.filter((a) => a.isActive);
  const inactive = companyAreas.filter((a) => !a.isActive);

  // ── Area Readiness overview ──
  const companyCustomers = useMemo(
    () => customers.filter((c) => c.companyId === companyId),
    [customers, companyId],
  );
  const companyPostalCities = useMemo(
    () => postalCities.filter((c) => c.companyId === companyId),
    [postalCities, companyId],
  );
  // The activation pre-check is the single source of truth for the "ready"
  // status so readiness numbers never disagree with the toggle.
  const precheck = getAreaActivationPrecheck();
  const readiness = useMemo(
    () =>
      buildAreaReadinessSummary({
        customers: companyCustomers,
        areas: companyAreas,
        postalCities: companyPostalCities,
        areaScopedAccessReady: precheck.canEnable,
      }),
    [companyCustomers, companyAreas, companyPostalCities, precheck.canEnable],
  );
  const applicableSuggestions = useMemo(
    () => getApplicableAreaSuggestions(companyCustomers, companyAreas, companyPostalCities),
    [companyCustomers, companyAreas, companyPostalCities],
  );

  const handleBulkApply = () => {
    const items = applicableSuggestions;
    for (const s of items) updateCustomer(s.customerId, { areaId: s.areaId });
    setBulkOpen(false);
    toast({
      title: `Applied ${items.length} suggested Area${items.length === 1 ? "" : "s"}`,
      description: "Customers were assigned the Area mapped to their Postal City.",
    });
  };

  const [newName, setNewName] = useState<string>("");
  const [newDescription, setNewDescription] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState<string>("");
  const [editDescription, setEditDescription] = useState<string>("");

  const handleCreate = () => {
    if (!newName.trim()) {
      toast({ title: "Enter an area name", variant: "destructive" });
      return;
    }
    const res = createArea({ companyId, name: newName, description: newDescription });
    if (!res.ok) {
      toast({ title: "Couldn't create area", description: res.error, variant: "destructive" });
      return;
    }
    setNewName("");
    setNewDescription("");
    toast({ title: "Area created" });
  };

  const startEdit = (id: string, name: string, description?: string) => {
    setEditingId(id);
    setEditName(name);
    setEditDescription(description ?? "");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName("");
    setEditDescription("");
  };

  const saveEdit = (id: string) => {
    const res = updateArea(id, { name: editName, description: editDescription });
    if (!res.ok) {
      toast({ title: "Couldn't save area", description: res.error, variant: "destructive" });
      return;
    }
    cancelEdit();
    toast({ title: "Area updated" });
  };

  const readinessStats: { label: string; value: number | string; tone?: "warn" | "ok" }[] = [
    { label: "Areas configured", value: readiness.areasConfigured },
    { label: "Postal Cities configured", value: readiness.postalCitiesConfigured },
    {
      label: "Customers without Area",
      value: readiness.customersWithoutArea,
      tone: readiness.customersWithoutArea > 0 ? "warn" : "ok",
    },
    { label: "Customers with suggested Area", value: readiness.customersWithSuggestedArea },
    {
      label: "Customers requiring manual review",
      value: readiness.customersRequiringManualReview,
      tone: readiness.customersRequiringManualReview > 0 ? "warn" : "ok",
    },
    {
      label: "Area Scoped Access",
      value: readiness.areaScopedAccessReady ? "Ready" : "Not ready",
      tone: readiness.areaScopedAccessReady ? "ok" : "warn",
    },
  ];

  const readinessSection = (
    <section>
        <div className="mb-1 flex items-center gap-2">
          <Gauge className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Area Readiness</h3>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          How close this company is to being Area-ready. Resolve customers without
          an Area before turning on Area Scoped Access.
        </p>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {readinessStats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl border border-border bg-card px-3 py-2.5"
            >
              <p
                className={`text-lg font-semibold ${
                  stat.tone === "warn"
                    ? "text-destructive"
                    : stat.tone === "ok"
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-foreground"
                }`}
              >
                {stat.value}
              </p>
              <p className="text-xs text-muted-foreground">{stat.label}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => reviewCustomers("missing")}
          >
            <ClipboardCheck className="h-4 w-4" /> Review without Area
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => reviewCustomers("suggested")}
          >
            Review suggested
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => reviewCustomers("manual")}
          >
            Review manual review
          </Button>
          <Button
            size="sm"
            disabled={applicableSuggestions.length === 0}
            onClick={() => setBulkOpen(true)}
          >
            <Wand2 className="h-4 w-4" /> Apply all suggested Areas
            {applicableSuggestions.length > 0 ? ` (${applicableSuggestions.length})` : ""}
          </Button>
        </div>
      </section>
  );

  const inactiveAreasList = (
    <ul className="space-y-2">
      {inactive.map((area) => (
        <li
          key={area.id}
          className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-border bg-muted/20 px-4 py-3"
        >
          <div className="min-w-0">
            <p className="truncate font-medium text-muted-foreground">{area.name}</p>
            {area.description ? (
              <p className="truncate text-sm text-muted-foreground/70">
                {area.description}
              </p>
            ) : null}
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              restoreArea(area.id);
              toast({ title: "Area reactivated" });
            }}
          >
            <RotateCcw className="h-4 w-4" /> Reactivate
          </Button>
        </li>
      ))}
    </ul>
  );

  const areasBody = (
    <>
        {/* Create */}
        <div className="mb-5 flex flex-col gap-2 rounded-xl border border-border bg-muted/30 p-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="area-name">New area</Label>
            <Input
              id="area-name"
              placeholder="e.g. Gothenburg"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
              }}
            />
          </div>
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="area-desc">Description (optional)</Label>
            <Input
              id="area-desc"
              placeholder="e.g. Greater Gothenburg region"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
              }}
            />
          </div>
          <Button onClick={handleCreate}>
            <Plus className="h-4 w-4" /> Add area
          </Button>
        </div>

        {/* Active areas */}
        {active.length === 0 ? (
          <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            No active areas yet. Create your first area above.
          </p>
        ) : (
          <ul className="space-y-2">
            {active.map((area) => (
              <li
                key={area.id}
                className="rounded-xl border border-border bg-card px-4 py-3"
              >
                {editingId === area.id ? (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="sm:max-w-[200px]"
                      placeholder="Area name"
                    />
                    <Input
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      className="flex-1"
                      placeholder="Description (optional)"
                    />
                    <div className="flex items-center gap-1.5">
                      <Button size="sm" onClick={() => saveEdit(area.id)}>
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
                      <p className="truncate font-medium text-foreground">{area.name}</p>
                      {area.description ? (
                        <p className="truncate text-sm text-muted-foreground">
                          {area.description}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => startEdit(area.id, area.name, area.description)}
                      >
                        <Pencil className="h-4 w-4" /> Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive focus:text-destructive"
                        onClick={() => {
                          archiveArea(area.id);
                          toast({ title: "Area deactivated" });
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

        {/* Inactive areas */}
        {inactive.length > 0 ? (
          compact ? (
            <Collapsible className="mt-6">
              <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2 text-left">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Inactive areas ({inactive.length})
                </span>
                <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2">{inactiveAreasList}</CollapsibleContent>
            </Collapsible>
          ) : (
            <div className="mt-6">
              <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Inactive
              </h4>
              {inactiveAreasList}
            </div>
          )
        ) : null}
    </>
  );

  const areaScopedAccessCard = (
    <>
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
          <div className="min-w-0">
            <p className="font-medium text-foreground">
              {areaScopedAccessEnabled ? "Active" : "Inactive"}
            </p>
            <p className="text-sm text-muted-foreground">
              {areaScopedAccessEnabled
                ? "Customer data is limited by Area."
                : "Customer data is visible to all admins."}
            </p>
          </div>
          <Button
            variant={areaScopedAccessEnabled ? "outline" : "default"}
            onClick={handleToggleAreaScopedAccess}
          >
            {areaScopedAccessEnabled ? "Disable" : "Enable"}
          </Button>
        </div>

        {blockedPrecheck && !blockedPrecheck.canEnable ? (
          <div className="mt-3 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div className="min-w-0 space-y-2">
                <p className="text-sm font-medium text-foreground">
                  Area Scoped Access cannot be activated yet.{" "}
                  {blockedPrecheck.counts.blocking} active customer
                  {blockedPrecheck.counts.blocking === 1 ? "" : "s"} need an Area first.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => reviewCustomers("missing")}
                >
                  Review customers without an Area
                </Button>
              </div>
            </div>
          </div>
        ) : null}
    </>
  );

  const bulkDialog = (
    <AlertDialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply all suggested Areas?</AlertDialogTitle>
            <AlertDialogDescription>
              {applicableSuggestions.length} customer
              {applicableSuggestions.length === 1 ? "" : "s"} without an Area will be
              assigned the Area mapped to their Postal City. Postal City stays
              unchanged and customers that already have an Area are never touched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkApply}>
              Apply {applicableSuggestions.length}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
  );

  // Compact "setup assistant" layout for the Customer page dialog: readiness on
  // top, all toggles grouped, Areas + Postal Cities collapsed by default.
  if (compact) {
    return (
      <div className="space-y-6">
        {readinessSection}

        <section>
          <div className="mb-1 flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Automation &amp; Access Controls</h3>
          </div>
          <p className="mb-4 text-sm text-muted-foreground">
            Turn area automation and access limits on or off.
          </p>
          <div className="space-y-3">
            <AutoAreaToggle showHeading={false} />
            <div className="space-y-3">
              <p className="text-sm font-medium text-foreground">
                Area Scoped Access: {areaScopedAccessEnabled ? "Active" : "Inactive"}
              </p>
              {areaScopedAccessCard}
            </div>
          </div>
        </section>

        <Collapsible className="rounded-xl border border-border">
          <CollapsibleTrigger className="group flex w-full items-center justify-between px-4 py-3 text-left">
            <span className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Areas</span>
              <span className="text-xs text-muted-foreground">({active.length} active)</span>
            </span>
            <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent className="border-t border-border px-4 py-4">
            {areasBody}
          </CollapsibleContent>
        </Collapsible>

        <Collapsible className="rounded-xl border border-border">
          <CollapsibleTrigger className="group flex w-full items-center justify-between px-4 py-3 text-left">
            <span className="flex items-center gap-2">
              <Building className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Postal Cities</span>
            </span>
            <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent className="border-t border-border px-4 py-4">
            <PostalCitiesPanel
              companyId={companyId}
              hideHeading
              hideAutomationToggle
              nestInactive
            />
          </CollapsibleContent>
        </Collapsible>

        {bulkDialog}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {readinessSection}

      <section>
        <div className="mb-1 flex items-center gap-2">
          <MapPin className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Areas</h3>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          Structured operational areas customers can be assigned to. They power
          filtering and reporting today and will drive automatic assignment rules
          later.
        </p>
        {areasBody}
      </section>

      <section>
        <div className="mb-1 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Area Scoped Access</h3>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          When enabled, admins and employees only see customers in the Areas they
          are assigned to. It can only be turned on once every operationally
          active customer has an Area, so no customer is accidentally hidden.
        </p>
        {areaScopedAccessCard}
      </section>

      <PostalCitiesPanel companyId={companyId} />

      {bulkDialog}
    </div>
  );
}
