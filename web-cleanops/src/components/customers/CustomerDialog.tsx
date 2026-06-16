import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, Eye, KeyRound, Rocket } from "lucide-react";

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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/hooks/use-toast";
import { useCustomerMutations } from "@/hooks/use-customer-mutations";
import { activeAreas, resolveAreaWriteFields } from "@/lib/area";
import { activePostalCities, resolvePostalCityArea } from "@/lib/postalCity";
import { cn } from "@/lib/utils";
import {
  CUSTOMER_TYPE_DESCRIPTIONS,
  CUSTOMER_TYPE_LABELS,
  CUSTOMER_TYPES,
  dayAcceptableWindow,
  dayOptimalWindow,
} from "@/types";
import type { Customer, CustomerType } from "@/types";

/** Select sentinel for "no area assigned" (Radix Select disallows empty values). */
const AREA_NONE = "__none__";
/** Select sentinel for "no postal city assigned". */
const POSTAL_CITY_NONE = "__none__";

/**
 * How a newly-created customer should be handed back to the host page.
 * - "only": quick entry, no onboarding follow-up.
 * - "onboarding": the host should lock the customer as active and expand the
 *   customer workspace so the admin can keep filling in details.
 */
export type CustomerCreateMode = "only" | "onboarding";

interface CustomerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  customer?: Customer | null;
  /** Fired after a NEW customer is created, with the chosen follow-up mode. */
  onCustomerCreated?: (customerId: string, mode: CustomerCreateMode) => void;
}

/** Identifiers for the single-expand collapsible boxes in this dialog. */
type BoxId = "info" | "cleaning" | "keys" | "location" | "onboarding";

/**
 * A collapsible box. Only one box is expanded at a time (single-expand), driven
 * by the parent's `openBox` state. Clicking a collapsed box's header expands it
 * and collapses whichever box was previously open.
 */
function CollapsibleBox({
  id,
  title,
  summary,
  isOpen,
  onToggle,
  children,
}: {
  id: BoxId;
  title: string;
  summary?: string;
  isOpen: boolean;
  onToggle: (id: BoxId) => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border transition-colors",
        isOpen && "border-primary/40 bg-muted/20",
      )}
    >
      <button
        type="button"
        onClick={() => onToggle(id)}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-foreground">{title}</span>
          {summary ? (
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">{summary}</span>
          ) : null}
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
            isOpen && "rotate-180",
          )}
        />
      </button>
      {isOpen ? <div className="border-t border-border px-4 py-4">{children}</div> : null}
    </div>
  );
}

/** Create or edit an external customer profile and its connected portal logins. */
export function CustomerDialog({
  open,
  onOpenChange,
  companyId,
  customer,
  onCustomerCreated,
}: CustomerDialogProps) {
  const {
    employees,
    areas,
    postalCities,
    autoAreaFromPostalCityEnabled,
    startViewAsCustomer,
    hasPermission,
  } = useApp();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState<string>("");
  const [orgNumber, setOrgNumber] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [phone, setPhone] = useState<string>("");
  const [customerType, setCustomerType] = useState<CustomerType | "">("");
  const [areaId, setAreaId] = useState<string>("");
  const [postalCityId, setPostalCityId] = useState<string>("");
  const [ownerId, setOwnerId] = useState<string>("");
  const [userIds, setUserIds] = useState<string[]>([]);
  // Create-only: start the guided onboarding right after creation. Pre-selected
  // because starting onboarding is the recommended workflow for new customers.
  const [startOnboarding, setStartOnboarding] = useState<boolean>(true);
  const [openBox, setOpenBox] = useState<BoxId>("info");
  const [error, setError] = useState<string>("");
  const isEdit = Boolean(customer);
  const customerMutations = useCustomerMutations({
    companyId,
    canCreateCustomers: hasPermission("customers.create"),
    canEditCustomers: hasPermission("customers.edit"),
  });

  // Active areas for this company only — no free text.
  const companyAreas = useMemo(
    () => activeAreas(areas).filter((a) => a.companyId === companyId),
    [areas, companyId],
  );
  // Active postal cities for this company only.
  const companyPostalCities = useMemo(
    () => activePostalCities(postalCities).filter((c) => c.companyId === companyId),
    [postalCities, companyId],
  );
  // Active employees in this company are the assignable customer owners — same
  // source/filtering as the Customer Page inline edit mode.
  const companyEmployees = useMemo(
    () => employees.filter((e) => e.companyId === companyId && e.status === "active"),
    [employees, companyId],
  );
  const selectedPostalCity = companyPostalCities.find((c) => c.id === postalCityId);
  const suggestedArea = resolvePostalCityArea(selectedPostalCity, areas);

  useEffect(() => {
    if (open) {
      setName(customer?.name ?? "");
      setOrgNumber(customer?.orgNumber ?? "");
      setEmail(customer?.email ?? "");
      setPhone(customer?.phone ?? "");
      setCustomerType(customer?.customerType ?? "");
      setAreaId(customer?.areaId ?? "");
      setPostalCityId(customer?.postalCityId ?? "");
      setOwnerId(customer?.ownerId ?? "");
      setUserIds(customer?.userIds ?? []);
      setStartOnboarding(true);
      setError("");
      setOpenBox("info");
    }
  }, [open, customer]);

  /** Single-expand toggle: open the clicked box, or keep it open if already open. */
  const toggleBox = (id: BoxId) => setOpenBox((prev) => (prev === id ? prev : id));

  /**
   * When the postal city changes, auto-set the Area only if automatic
   * assignment is enabled AND the city maps to a valid active area. Otherwise
   * the connected area is only suggested (rendered below). Never silently
   * clears an existing area when the city is cleared or has no valid area.
   */
  const handlePostalCityChange = (value: string) => {
    const id = value === POSTAL_CITY_NONE ? "" : value;
    setPostalCityId(id);
    if (!id) return;
    const city = companyPostalCities.find((c) => c.id === id);
    const area = resolvePostalCityArea(city, areas);
    if (autoAreaFromPostalCityEnabled && area) {
      setAreaId(area.id);
    }
  };

  const handleViewAs = () => {
    if (!customer) return;
    const res = startViewAsCustomer(customer.id);
    if (!res.ok) {
      setError(res.error ?? "Unable to view as this customer.");
      return;
    }
    onOpenChange(false);
    navigate("/", { replace: true });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!name.trim() || !email.trim()) {
      setError("Customer name and email are required.");
      setOpenBox("info");
      return;
    }
    if (!customerType) {
      setError("Customer type is required.");
      setOpenBox("info");
      return;
    }

    const areaFields = resolveAreaWriteFields(areaId, companyAreas);
    try {
      const saved = customer
        ? await customerMutations.updateCustomer({
            customerId: customer.id,
            companyId: customer.companyId,
            patch: {
              name: name.trim(),
              orgNumber: orgNumber.trim() || undefined,
              email: email.trim(),
              phone: phone.trim() || undefined,
              customerType,
              areaId: areaFields.areaId,
              area: areaFields.area,
              postalCityId: postalCityId || undefined,
              ownerId: ownerId || undefined,
            },
          })
        : await customerMutations.createCustomer({
            name: name.trim(),
            orgNumber: orgNumber.trim() || undefined,
            email: email.trim(),
            phone: phone.trim() || undefined,
            customerType,
            areaId: areaFields.areaId,
            area: areaFields.area,
            postalCityId: postalCityId || undefined,
            ownerId: ownerId || undefined,
            startOnboarding,
          });

      toast({
        title: isEdit ? "Customer updated" : startOnboarding ? "Onboarding started" : "Customer added",
        description: isEdit
          ? `${name.trim()} has been saved.`
          : startOnboarding
            ? `${name.trim()} was created and onboarding has started.`
            : `${name.trim()} has been added.`,
      });
      onOpenChange(false);
      if (!isEdit) {
        onCustomerCreated?.(saved.id, startOnboarding ? "onboarding" : "only");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save customer.");
    }
  };

  // ── Collapsed summaries ───────────────────────────────────────────────────
  const infoSummary =
    [name.trim(), email.trim()].filter(Boolean).join(" · ") ||
    "Name, organization number and contact details";

  const cleaningSummary = useMemo(() => {
    const prefs = customer?.schedulingPreferences;
    const firstPreferred = prefs?.preferredDays?.[0];
    if (!firstPreferred) return "Set during onboarding";
    const optimal = dayOptimalWindow(firstPreferred);
    const acceptable = dayAcceptableWindow(firstPreferred);
    const parts: string[] = [];
    if (optimal.start && optimal.end) parts.push(`Preferred: ${optimal.start}–${optimal.end}`);
    if (acceptable.start && acceptable.end)
      parts.push(`Acceptable: ${acceptable.start}–${acceptable.end}`);
    return parts.length > 0 ? parts.join(" · ") : "Set during onboarding";
  }, [customer?.schedulingPreferences]);

  const locationSummary = useMemo(() => {
    const areaName = companyAreas.find((a) => a.id === areaId)?.name;
    const ownerName = companyEmployees.find((e) => e.id === ownerId)?.name;
    const parts: string[] = [];
    if (areaName) parts.push(areaName);
    if (ownerName) parts.push(`Owner: ${ownerName}`);
    if (userIds.length > 0)
      parts.push(`${userIds.length} login${userIds.length === 1 ? "" : "s"}`);
    return parts.length > 0 ? parts.join(" · ") : "Area, owner and logins not set";
  }, [companyAreas, areaId, companyEmployees, ownerId, userIds]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit customer" : "Add customer"}</DialogTitle>
            <DialogDescription>
              External customer profile. Customer login linking is handled separately.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2.5 py-5">
            {/* Box 1 — Customer information */}
            <CollapsibleBox
              id="info"
              title="Customer information"
              summary={infoSummary}
              isOpen={openBox === "info"}
              onToggle={toggleBox}
            >
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="cust-name">Customer name</Label>
                    <Input
                      id="cust-name"
                      placeholder="e.g. Bergen Office Park"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      autoFocus
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cust-org">Organization number</Label>
                    <Input
                      id="cust-org"
                      placeholder="e.g. 556677-8899"
                      value={orgNumber}
                      onChange={(e) => setOrgNumber(e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="cust-email">Primary email</Label>
                    <Input
                      id="cust-email"
                      type="email"
                      placeholder="contact@customer.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cust-phone">Phone</Label>
                    <Input
                      id="cust-phone"
                      type="tel"
                      placeholder="e.g. +46 70 123 45 67"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="cust-type">
                    Customer type <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={customerType === "" ? undefined : customerType}
                    onValueChange={(v) => setCustomerType(v as CustomerType)}
                  >
                    <SelectTrigger id="cust-type">
                      <SelectValue placeholder="Select a customer type" />
                    </SelectTrigger>
                    <SelectContent>
                      {CUSTOMER_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {CUSTOMER_TYPE_LABELS[type]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {customerType ? (
                    <p className="text-xs text-muted-foreground">
                      {CUSTOMER_TYPE_DESCRIPTIONS[customerType]}
                    </p>
                  ) : null}
                </div>
              </div>
            </CollapsibleBox>

            {/* Box 2 — Cleaning days & time */}
            <CollapsibleBox
              id="cleaning"
              title="Cleaning days & time"
              summary={cleaningSummary}
              isOpen={openBox === "cleaning"}
              onToggle={toggleBox}
            >
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Cleaning days with acceptable and preferred time windows are configured in
                  the <span className="font-medium text-foreground">Cleaning Days &amp; Time</span>{" "}
                  step of onboarding (and any time later from the Customer card).
                </p>
                {customer?.schedulingPreferences?.preferredDays?.length ? (
                  <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                    Current: {cleaningSummary}
                  </p>
                ) : (
                  <p className="rounded-lg border border-dashed border-border bg-background px-3 py-2 text-xs text-muted-foreground">
                    No cleaning windows configured yet. Start onboarding to set acceptable
                    and preferred days/times.
                  </p>
                )}
              </div>
            </CollapsibleBox>

            {/* Box 3 — Keys & alarm (placeholder) */}
            <CollapsibleBox
              id="keys"
              title="Keys & alarm"
              summary="Not configured"
              isOpen={openBox === "keys"}
              onToggle={toggleBox}
            >
              <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-background px-4 py-8 text-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                  <KeyRound className="h-5 w-5" />
                </div>
                <p className="text-sm font-medium text-foreground">Keys & alarm</p>
                <p className="max-w-sm text-xs text-muted-foreground">
                  Keys, alarm codes, access instructions and entry procedures will live here.
                </p>
                <span className="mt-1 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                  Coming soon
                </span>
              </div>
            </CollapsibleBox>

            {/* Box 4 — Location & ownership */}
            <CollapsibleBox
              id="location"
              title="Location & ownership"
              summary={locationSummary}
              isOpen={openBox === "location"}
              onToggle={toggleBox}
            >
              <div className="space-y-4">
                {companyPostalCities.length > 0 ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="cust-postal-city">Postal city</Label>
                    <Select
                      value={postalCityId === "" ? POSTAL_CITY_NONE : postalCityId}
                      onValueChange={handlePostalCityChange}
                    >
                      <SelectTrigger id="cust-postal-city">
                        <SelectValue placeholder="Not assigned" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={POSTAL_CITY_NONE}>Not assigned</SelectItem>
                        {companyPostalCities.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {selectedPostalCity && !suggestedArea ? (
                      <p className="text-xs text-warning">
                        This postal city has no active Area — set the Area manually.
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <div className="space-y-1.5">
                  <Label htmlFor="cust-area">Area</Label>
                  <Select
                    value={areaId === "" ? AREA_NONE : areaId}
                    onValueChange={(v) => setAreaId(v === AREA_NONE ? "" : v)}
                  >
                    <SelectTrigger id="cust-area">
                      <SelectValue placeholder="Not assigned" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={AREA_NONE}>Not assigned</SelectItem>
                      {companyAreas.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {companyAreas.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No areas yet — manage them in Settings.
                    </p>
                  ) : suggestedArea && autoAreaFromPostalCityEnabled && areaId === suggestedArea.id ? (
                    <p className="text-xs text-muted-foreground">
                      Area set automatically from Postal City.
                    </p>
                  ) : suggestedArea && areaId !== suggestedArea.id ? (
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      Suggested Area: <span className="font-medium">{suggestedArea.name}</span>
                      <button
                        type="button"
                        className="font-medium text-primary hover:underline"
                        onClick={() => setAreaId(suggestedArea.id)}
                      >
                        Use
                      </button>
                    </p>
                  ) : null}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="cust-owner">Customer owner</Label>
                  <Select
                    value={ownerId === "" ? AREA_NONE : ownerId}
                    onValueChange={(v) => setOwnerId(v === AREA_NONE ? "" : v)}
                  >
                    <SelectTrigger id="cust-owner">
                      <SelectValue placeholder="Not assigned" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={AREA_NONE}>Not assigned</SelectItem>
                      {companyEmployees.map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {companyEmployees.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No active employees yet.</p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label>Connected logins</Label>
                  <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                    Customer login linking is managed separately and is not changed by this save.
                    {userIds.length > 0 ? ` Existing linked logins: ${userIds.length}.` : ""}
                  </p>
                </div>
              </div>
            </CollapsibleBox>

            {/* Box 5 — Onboarding action (create only) */}
            {!isEdit ? (
              <CollapsibleBox
                id="onboarding"
                title="Onboarding"
                summary={startOnboarding ? "Start onboarding process" : "Add customer only"}
                isOpen={openBox === "onboarding"}
                onToggle={toggleBox}
              >
                <div className="space-y-3">
                  <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
                    <Checkbox
                      checked={startOnboarding}
                      onCheckedChange={(v) => setStartOnboarding(v === true)}
                      className="mt-0.5"
                    />
                    <span className="space-y-0.5">
                      <span className="block text-sm font-medium text-foreground">
                        Start onboarding process{" "}
                        <span className="text-xs font-normal text-muted-foreground">(Recommended)</span>
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        Creates the customer and opens the guided onboarding workspace so you can
                        complete cleaning days, notes, documents and keys. You can return to it any
                        time from the Customer card.
                      </span>
                    </span>
                  </label>
                  {!startOnboarding ? (
                    <p className="rounded-lg border border-dashed border-border bg-background px-3 py-2 text-xs text-muted-foreground">
                      The customer will be added without starting onboarding. You can start it
                      later from the customer list or card.
                    </p>
                  ) : null}
                </div>
              </CollapsibleBox>
            ) : null}

            {error ? (
              <p
                role="alert"
                className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
              >
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter className="sm:justify-between">
            {isEdit ? (
              <Button type="button" variant="outline" onClick={handleViewAs}>
                <Eye className="h-4 w-4" /> View as customer
              </Button>
            ) : (
              <span className="hidden sm:block" />
            )}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={customerMutations.isPending}
              >
                Cancel
              </Button>
              {isEdit ? (
                <Button type="submit" disabled={customerMutations.isPending}>
                  {customerMutations.isPending ? "Saving..." : "Save changes"}
                </Button>
              ) : (
                <Button type="submit" disabled={customerMutations.isPending}>
                  {customerMutations.isPending ? (
                    "Saving..."
                  ) : startOnboarding ? (
                    <>
                      <Rocket className="h-4 w-4" /> Create &amp; start onboarding
                    </>
                  ) : (
                    "Add customer"
                  )}
                </Button>
              )}
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
