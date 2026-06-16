import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Clock, Plus, Wand2 } from "lucide-react";

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
import { useServiceCatalogMutations } from "@/hooks/use-service-catalog-mutations";
import {
  SERVICE_BASIS_TYPES,
  SERVICE_BILLING_TYPES,
  SERVICE_DEDUCTION_TYPES,
  SERVICE_TYPES,
} from "@/types";
import type {
  Service,
  ServiceBasisType,
  ServiceBillingType,
  ServiceCategory,
  ServiceDeductionType,
  TimeCode,
} from "@/types";
import { sortTimeCodes } from "@/lib/timeCodeResolver";
import {
  generateArticleNumber,
  validateManualArticleNumber,
  type ArticleNumberSeriesScope,
} from "@/lib/data/supabaseArticleNumberSeriesRepository";

interface ServiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pass a service to edit; omit to create a new one. */
  service?: Service | null;
  categories: ServiceCategory[];
  /** Preselected category when creating from within a category section. */
  defaultCategoryId?: string | null;
}

const NO_CATEGORY = "__none__";
const NO_TIMECODE = "__none__";
const NO_TYPE = "__none__";

/** Label for a time code, e.g. "10 — Worked Time". */
function timeCodeLabel(code: TimeCode): string {
  return `${code.code} — ${code.name}`;
}

/** Create/edit a single universal service with its full master-data field set. */
export function ServiceDialog({
  open,
  onOpenChange,
  service,
  categories,
  defaultCategoryId,
}: ServiceDialogProps) {
  const { currentUser, getServiceScope, hasPermission, getAvailableTimeCodes, getTimeCodeById } = useApp();
  const { toast } = useToast();
  const navigate = useNavigate();
  const isEdit = Boolean(service);

  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>(NO_CATEGORY);
  const [articleNumber, setArticleNumber] = useState<string>("");
  const [serviceType, setServiceType] = useState<string>("");
  const [timeCodeId, setTimeCodeId] = useState<string>(NO_TIMECODE);
  const [unit, setUnit] = useState<string>("");
  const [billingType, setBillingType] = useState<ServiceBillingType>("fixed");
  const [serviceBasisType, setServiceBasisType] = useState<ServiceBasisType>("billable");
  const [deductionEligible, setDeductionEligible] = useState<boolean>(false);
  const [deductionType, setDeductionType] = useState<ServiceDeductionType>("none");
  const [price, setPrice] = useState<string>("");
  const [vat, setVat] = useState<string>("");
  const [minimumPrice, setMinimumPrice] = useState<string>("");
  const [salesAccount, setSalesAccount] = useState<string>("");
  const [smsEnabled, setSmsEnabled] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  // Article-number allocator state (ARTNUM-1). Validation/generation are
  // Supabase-authoritative; the DB unique guard is the hard backstop.
  const [articleNumberError, setArticleNumberError] = useState<string | null>(null);
  const [articleNumberHint, setArticleNumberHint] = useState<string | null>(null);
  const [isGeneratingArticle, setIsGeneratingArticle] = useState<boolean>(false);
  const mutations = useServiceCatalogMutations({
    companyId: currentUser ? getServiceScope() : undefined,
    isSuperAdmin: currentUser?.role === "super_admin",
    canManageServices:
      Boolean(currentUser) &&
      (currentUser?.role === "super_admin" || currentUser?.role === "company_admin") &&
      hasPermission("services.manage"),
    currentUserId: currentUser?.id ?? null,
  });

  /**
   * Active time codes assignable in this scope (Settings → Time Codes). The
   * service's currently-linked code is always included even if it has since
   * been deactivated, so editing never silently drops the assignment.
   */
  const timeCodes = useMemo<TimeCode[]>(() => {
    const available = getAvailableTimeCodes();
    const current = service?.timeCodeId ? getTimeCodeById(service.timeCodeId) : undefined;
    if (current && !available.some((t) => t.id === current.id)) {
      return [...available, current].sort(sortTimeCodes);
    }
    return available;
  }, [getAvailableTimeCodes, getTimeCodeById, service?.timeCodeId]);

  /** Service types: the standard set plus any custom value already on the service. */
  const serviceTypeOptions = useMemo<string[]>(() => {
    const set = [...SERVICE_TYPES];
    if (serviceType && !set.includes(serviceType)) set.unshift(serviceType);
    return set;
  }, [serviceType]);

  useEffect(() => {
    if (!open) return;
    setName(service?.name ?? "");
    setDescription(service?.description ?? "");
    setCategoryId(service?.categoryId ?? defaultCategoryId ?? NO_CATEGORY);
    setArticleNumber(service?.articleNumber ?? "");
    setServiceType(service?.serviceType ?? "");
    // Resolve the time-code reference: prefer the stored id, fall back to matching
    // the legacy denormalized code so existing services keep their selection.
    const resolvedId =
      service?.timeCodeId ??
      (service?.timeCode
        ? timeCodes.find((t) => t.code === service.timeCode || t.name === service.timeCode)?.id
        : undefined);
    setTimeCodeId(resolvedId ?? NO_TIMECODE);
    setUnit(service?.unit ?? "");
    setBillingType(service?.billingType ?? "fixed");
    setServiceBasisType(service?.serviceBasisType ?? "billable");
    setDeductionEligible(service?.deductionEligible ?? false);
    setDeductionType(service?.deductionType ?? "none");
    setPrice(service?.price?.toString() ?? "");
    setVat(service?.vat?.toString() ?? "");
    setMinimumPrice(service?.minimumPrice?.toString() ?? "");
    setSalesAccount(service?.salesAccount ?? "");
    setSmsEnabled(service?.smsEnabled ?? false);
    setError(null);
    setArticleNumberError(null);
    setArticleNumberHint(null);
  }, [open, service, defaultCategoryId, timeCodes]);

  const num = (v: string): number | undefined => {
    const n = Number(v);
    return v.trim() === "" || Number.isNaN(n) ? undefined : n;
  };

  // The service's catalog scope: global (Super Admin) vs the active company.
  const serviceScope = currentUser ? getServiceScope() : undefined;

  /** Builds the article-number series scope for a resolved category id. */
  const buildSeriesScope = useCallback(
    (resolvedCategoryId: string): ArticleNumberSeriesScope | null => {
      if (serviceScope === undefined) return null;
      return {
        scopeKind: serviceScope === null ? "global" : "company",
        companyLegacyId: serviceScope,
        categoryId: resolvedCategoryId,
      };
    },
    [serviceScope],
  );

  /** Validates the current manual article number against the series + scope. */
  const validateArticleNumber = async (): Promise<boolean> => {
    const value = articleNumber.trim();
    setArticleNumberHint(null);
    if (!value) {
      setArticleNumberError(null);
      return true;
    }
    const scope = buildSeriesScope(categoryId === NO_CATEGORY ? "" : categoryId);
    if (!scope) {
      setArticleNumberError(null);
      return true;
    }
    try {
      const result = await validateManualArticleNumber({
        scope,
        articleNumber: value,
        excludeServiceId: service?.id ?? null,
      });
      if (!result.ok) {
        setArticleNumberError(result.message);
        return false;
      }
      setArticleNumberError(null);
      if (result.code === "no_series") {
        setArticleNumberHint(
          "No article-number series is configured for this category, so generation is unavailable.",
        );
      }
      return true;
    } catch {
      // Non-blocking: a transport/availability error must not stop a save; the
      // database unique guard still enforces uniqueness authoritatively.
      setArticleNumberError(null);
      return true;
    }
  };

  /** Generates the next article number from the selected category's series. */
  const handleGenerateArticleNumber = async (): Promise<void> => {
    if (categoryId === NO_CATEGORY) {
      setArticleNumberError("Select a category with a configured series to generate a number.");
      return;
    }
    const scope = buildSeriesScope(categoryId);
    if (!scope) return;
    setIsGeneratingArticle(true);
    setArticleNumberError(null);
    setArticleNumberHint(null);
    try {
      const next = await generateArticleNumber(scope);
      setArticleNumber(next);
    } catch (err) {
      setArticleNumberError(
        err instanceof Error ? err.message : "Couldn't generate an article number.",
      );
    } finally {
      setIsGeneratingArticle(false);
    }
  };

  const goToTimeCodes = () => {
    onOpenChange(false);
    navigate("/settings?tab=time_codes");
  };

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!name.trim() || mutations.isPending) return;
    // Article number must be valid + non-conflicting before we save.
    const articleOk = await validateArticleNumber();
    if (!articleOk) return;
    const selectedTimeCode =
      timeCodeId === NO_TIMECODE ? undefined : timeCodes.find((t) => t.id === timeCodeId);
    const payload = {
      categoryId: categoryId === NO_CATEGORY ? null : categoryId,
      name: name.trim(),
      description: description.trim() || undefined,
      articleNumber: articleNumber.trim() || undefined,
      serviceType: serviceType === NO_TYPE ? undefined : serviceType.trim() || undefined,
      timeCodeId: selectedTimeCode ? selectedTimeCode.id : null,
      timeCode: selectedTimeCode ? selectedTimeCode.code : undefined,
      unit: unit.trim() || undefined,
      billingType,
      serviceBasisType,
      deductionEligible,
      deductionType,
      price: num(price),
      vat: num(vat),
      minimumPrice: num(minimumPrice),
      salesAccount: salesAccount.trim() || undefined,
      smsEnabled,
    };
    setError(null);
    try {
      if (service) {
        await mutations.updateService({ serviceId: service.id, patch: payload });
      } else {
        await mutations.createService(payload);
      }
      toast({
        title: isEdit ? "Service updated" : "Service created",
        description: `${name.trim()} has been saved.`,
      });
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save service.";
      setError(message);
      toast({ title: "Couldn't save", description: message, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!mutations.isPending) onOpenChange(next); }}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-0 sm:max-w-3xl lg:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit service" : "New service"}</DialogTitle>
          <DialogDescription>
            Universal service master data. Country settings connect later.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto py-4 pr-1">
            {/* Name */}
            <div className="space-y-1.5">
              <Label htmlFor="svc-name">Service name</Label>
              <Input
                id="svc-name"
                placeholder="e.g. Regular Cleaning"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                required
              />
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label htmlFor="svc-desc">Description</Label>
              <Textarea
                id="svc-desc"
                placeholder="What this service includes…"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>

            {/* Category | Article Number | Service Type */}
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select
                  value={categoryId}
                  onValueChange={(v) => {
                    setCategoryId(v);
                    setArticleNumberError(null);
                    setArticleNumberHint(null);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Uncategorised" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_CATEGORY}>Uncategorised</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="svc-article">Article number</Label>
                <div className="flex gap-2">
                  <Input
                    id="svc-article"
                    placeholder="e.g. 1001"
                    value={articleNumber}
                    onChange={(e) => {
                      setArticleNumber(e.target.value);
                      setArticleNumberError(null);
                      setArticleNumberHint(null);
                    }}
                    onBlur={() => void validateArticleNumber()}
                    aria-invalid={articleNumberError ? true : undefined}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="shrink-0"
                    title="Generate article number"
                    aria-label="Generate article number"
                    disabled={
                      categoryId === NO_CATEGORY || isGeneratingArticle || mutations.isPending
                    }
                    onClick={() => void handleGenerateArticleNumber()}
                  >
                    <Wand2 className="h-4 w-4" />
                  </Button>
                </div>
                {articleNumberError ? (
                  <p className="text-xs text-destructive" role="alert">
                    {articleNumberError}
                  </p>
                ) : articleNumberHint ? (
                  <p className="text-xs text-muted-foreground">{articleNumberHint}</p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label>Service type</Label>
                <Select
                  value={serviceType === "" ? NO_TYPE : serviceType}
                  onValueChange={(v) => setServiceType(v === NO_TYPE ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_TYPE}>None</SelectItem>
                    {serviceTypeOptions.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Time Code | Billing Type | Unit */}
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Time code</Label>
                {timeCodes.length === 0 ? (
                  <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border px-3 py-2.5">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="h-3.5 w-3.5 shrink-0" />
                      No time codes available.
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 self-start"
                      onClick={goToTimeCodes}
                    >
                      <Plus className="h-3.5 w-3.5" /> Create Time Code
                    </Button>
                  </div>
                ) : (
                  <Select value={timeCodeId} onValueChange={setTimeCodeId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select time code" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_TIMECODE}>None</SelectItem>
                      {timeCodes.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {timeCodeLabel(t)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Billing type</Label>
                <Select
                  value={billingType}
                  onValueChange={(v) => setBillingType(v as ServiceBillingType)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SERVICE_BILLING_TYPES.map((b) => (
                      <SelectItem key={b.value} value={b.value}>
                        {b.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="svc-unit">Unit</Label>
                <Input
                  id="svc-unit"
                  placeholder="e.g. hour, m², piece"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                />
              </div>
            </div>

            {/* Basis type (payroll/invoice contribution) */}
            <div className="space-y-1.5">
              <Label>Basis type</Label>
              <Select
                value={serviceBasisType}
                onValueChange={(v) => setServiceBasisType(v as ServiceBasisType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SERVICE_BASIS_TYPES.map((b) => (
                    <SelectItem key={b.value} value={b.value}>
                      {b.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {SERVICE_BASIS_TYPES.find((b) => b.value === serviceBasisType)?.description}{" "}
                Controls payroll/invoice contribution — separate from billing type and time code.
              </p>
            </div>

            {/* Price | VAT | Minimum Price */}
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="svc-price">Price</Label>
                <Input
                  id="svc-price"
                  type="number"
                  inputMode="decimal"
                  placeholder="0"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="svc-vat">VAT (%)</Label>
                <Input
                  id="svc-vat"
                  type="number"
                  inputMode="decimal"
                  placeholder="e.g. 25"
                  value={vat}
                  onChange={(e) => setVat(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="svc-minprice">Minimum price</Label>
                <Input
                  id="svc-minprice"
                  type="number"
                  inputMode="decimal"
                  placeholder="0"
                  value={minimumPrice}
                  onChange={(e) => setMinimumPrice(e.target.value)}
                />
              </div>
            </div>

            {/* Sales Account | Deduction Type */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="svc-sales">Sales account</Label>
                <Input
                  id="svc-sales"
                  placeholder="e.g. 3001"
                  value={salesAccount}
                  onChange={(e) => setSalesAccount(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Deduction type</Label>
                <Select
                  value={deductionType}
                  onValueChange={(v) => setDeductionType(v as ServiceDeductionType)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SERVICE_DEDUCTION_TYPES.map((d) => (
                      <SelectItem key={d.value} value={d.value}>
                        {d.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Toggles */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
                <div>
                  <p className="text-sm font-medium">Deduction eligible</p>
                  <p className="text-xs text-muted-foreground">
                    Qualifies for a tax deduction (e.g. RUT/ROT).
                  </p>
                </div>
                <Switch checked={deductionEligible} onCheckedChange={setDeductionEligible} />
              </div>
              <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
                <div>
                  <p className="text-sm font-medium">SMS enabled</p>
                  <p className="text-xs text-muted-foreground">
                    Allow SMS notifications for this service.
                  </p>
                </div>
                <Switch checked={smsEnabled} onCheckedChange={setSmsEnabled} />
              </div>
            </div>
          </div>

          {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
          <DialogFooter className="mt-4 border-t border-border pt-4">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={mutations.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutations.isPending}>
              {mutations.isPending ? "Saving…" : isEdit ? "Save changes" : "Create service"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
