import { useCallback, useMemo, useState } from "react";
import { Check, Clock, Info, Layers, Plus, Receipt, Save, Sparkles, Star } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { LockedChip, Pill } from "@/components/calculator/configBadges";
import { PlanPriceFields, PlanRutFields } from "@/components/calculator/planPriceFields";
import {
  genericServicePlanInfo,
  planEditorLane,
} from "@/components/calculator/cleaningPlansPresentation";
import { serviceStatusBadges } from "@/components/calculator/serviceListPresentation";
import { formatMinutesWithHours } from "@/lib/calculator/timeUnits";
import {
  validateGenericPlan,
  type GenericPlanDraft,
} from "@/lib/calculator/v2/genericPricingContract";
import type { GenericPricingModel } from "@/lib/calculator/v2/pricingModel";
import {
  validateNewPlan,
  type CalculatorServiceConfig,
  type CleaningPlanConfig,
  type NewPlanDraft,
  type NewPlanInput,
  type PlanPatch,
  type PlanPricingModelValue,
  type ServicePatch,
  type SetDefaultPlanInput,
} from "@/lib/calculator/calculatorConfigAdmin";

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong. No change was saved.";
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Parses a free-text numeric input into the value the GPM-4a contract expects:
 * an empty/whitespace field becomes `undefined` (so `validateGenericPlan` treats a
 * required field as missing and skips an absent optional one), while any other
 * string is coerced with {@link Number} — non-numeric text becomes `NaN`, which the
 * contract's finiteness checks reject.
 */
function parseOptionalNumber(raw: string): number | undefined {
  return raw.trim() === "" ? undefined : Number(raw);
}

function formatMoney(value: number, currency: string): string {
  return `${roundMoney(value).toLocaleString("sv-SE", { maximumFractionDigits: 2 })} ${currency}`;
}

/** Office Start adjustment is entered in MINUTES but stored in hours. */
function hoursToMinutes(hours: number): number {
  return Math.round(hours * 60);
}

function taxPreview(hourlyRate: number, vatRate: number, rutActive: boolean, rutPercent: number) {
  const priceExclVat = roundMoney(hourlyRate);
  const vatAmount = roundMoney(priceExclVat * (vatRate / 100));
  const priceInclVat = roundMoney(priceExclVat + vatAmount);
  const rutDeduction = rutActive ? roundMoney(priceInclVat * (rutPercent / 100)) : 0;
  const priceAfterRut = roundMoney(Math.max(0, priceInclVat - rutDeduction));
  return { priceExclVat, vatAmount, priceInclVat, rutDeduction, priceAfterRut };
}

function serviceTitle(serviceKey: string): string {
  if (serviceKey === "home_cleaning") return "Plan — Home Cleaning";
  if (serviceKey === "office_cleaning") return "Plan — Office Cleaning";
  return `Plan — ${serviceKey.replace(/_/g, " ")}`;
}

/** Office pilot (Slice 12L): one simple model — per-plan hourly price + a fixed total time adjustment per visit. */
const OFFICE_PLAN_PRICING_MODEL: PlanPricingModelValue = "hourly_rate_plus_time_adjustment";

/** Plan models that share ONE base hourly rate across plans (rate is not per-plan). */
function usesSharedBaseRate(model: PlanPricingModelValue): boolean {
  return model === "price_adjustment_per_plan" || model === "time_adjustment_per_visit";
}

function ServicePlanControls({
  service,
  plans,
  onSaveService,
}: {
  service: CalculatorServiceConfig;
  plans: CleaningPlanConfig[];
  onSaveService: (legacyId: string, patch: ServicePatch) => Promise<void>;
}) {
  const isOffice = service.serviceKey === "office_cleaning";
  const [plansEnabled, setPlansEnabled] = useState<boolean>(service.plansEnabled);
  const [planPricingModel, setPlanPricingModel] = useState<PlanPricingModelValue>(service.planPricingModel);
  const [defaultPlanKey, setDefaultPlanKey] = useState<string>(service.defaultPlanKey ?? plans.find((p) => p.isDefault)?.planKey ?? "");
  const [baseHourlyRateExclVat, setBaseHourlyRateExclVat] = useState<string>(String(service.baseHourlyRateExclVat ?? ""));
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Office pilot (Slice 12L): no visible plan-model choice. Each plan just has its
  // own hourly price + a fixed time adjustment per visit, so the effective model
  // is always per-plan rate + time adjustment.
  const effectivePlanPricingModel: PlanPricingModelValue = isOffice ? OFFICE_PLAN_PRICING_MODEL : planPricingModel;
  // For office each plan carries its own hourly price, so the service-level rate is
  // only a fallback. Home keeps the shared-base behaviour for its adjustment models.
  const showBaseRate = isOffice || usesSharedBaseRate(planPricingModel);

  const save = useCallback(async () => {
    setError(null);
    const baseRate = baseHourlyRateExclVat.trim() === "" ? null : Number(baseHourlyRateExclVat);
    if (baseRate !== null && (!Number.isFinite(baseRate) || baseRate < 0)) {
      setError("Base hourly price must be zero or greater.");
      return;
    }
    setSaving(true);
    try {
      await onSaveService(service.legacyId, {
        plansEnabled,
        planPricingModel: effectivePlanPricingModel,
        defaultPlanKey: defaultPlanKey || null,
        baseHourlyRateExclVat: baseRate,
        defaultVatRatePercent: service.defaultVatRatePercent || 25,
      });
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }, [baseHourlyRateExclVat, defaultPlanKey, effectivePlanPricingModel, onSaveService, plansEnabled, service]);

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1fr_1fr_auto] lg:items-end">
        <div className="flex items-center justify-between rounded-xl border border-border bg-muted/30 px-3 py-2.5">
          <div>
            <p className="text-sm font-medium">Activate plans</p>
            <p className="text-xs text-muted-foreground">Controls whether this service requires/selects plans.</p>
          </div>
          <Switch checked={plansEnabled} onCheckedChange={setPlansEnabled} aria-label={`${service.displayName} activate plans`} />
        </div>

        {!isOffice ? (
          <div className="space-y-1.5">
            <Label htmlFor={`${service.serviceKey}-plan-model`}>Plan model</Label>
            <select
              id={`${service.serviceKey}-plan-model`}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={planPricingModel}
              onChange={(e) => setPlanPricingModel(e.target.value as PlanPricingModelValue)}
            >
              <option value="hourly_rate_by_plan">Different hourly rate per plan</option>
              <option value="price_adjustment_per_plan">Price surcharge/discount per plan</option>
              <option value="time_adjustment_per_visit">Same hourly rate, time adjustment per plan</option>
            </select>
          </div>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor={`${service.serviceKey}-default-plan`}>Recommended/default plan</Label>
          <select
            id={`${service.serviceKey}-default-plan`}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={defaultPlanKey}
            onChange={(e) => setDefaultPlanKey(e.target.value)}
          >
            <option value="">No default</option>
            {plans.map((plan) => (
              <option key={plan.legacyId} value={plan.planKey}>
                {plan.name}
              </option>
            ))}
          </select>
        </div>

        {showBaseRate ? (
          <div className="space-y-1.5">
            <Label htmlFor={`${service.serviceKey}-base-rate`}>
              {isOffice ? "Fallback hourly price excl. VAT" : "Base hourly price excl. VAT"}
            </Label>
            <Input
              id={`${service.serviceKey}-base-rate`}
              type="number"
              inputMode="decimal"
              value={baseHourlyRateExclVat}
              onChange={(e) => setBaseHourlyRateExclVat(e.target.value)}
            />
            {isOffice ? (
              <p className="text-[11px] text-muted-foreground">Used only if a plan has no hourly price of its own.</p>
            ) : null}
          </div>
        ) : null}

        <Button type="button" onClick={save} disabled={saving} className="lg:col-start-4">
          <Save className="h-4 w-4" /> Save
        </Button>
      </div>
      {error ? <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
    </div>
  );
}

function PlanCard({
  plan,
  currency,
  isHome,
  isOffice,
  onSavePlan,
  onSetDefault,
  lastActiveGuard = false,
}: {
  plan: CleaningPlanConfig;
  currency: string;
  isHome: boolean;
  isOffice: boolean;
  onSavePlan: (legacyId: string, patch: PlanPatch) => Promise<void>;
  /** Slice V2-D — Home only: promote this plan to default (pre-bound by the parent). */
  onSetDefault?: () => Promise<void>;
  /** Slice V2-D — true when this is the last active plan of an enabled service (block deactivation). */
  lastActiveGuard?: boolean;
}) {
  const [name, setName] = useState<string>(plan.name);
  const [description, setDescription] = useState<string>(plan.description ?? "");
  const [hourlyRate, setHourlyRate] = useState<string>(String(plan.hourlyRate));
  const [vatRatePercent, setVatRatePercent] = useState<string>(String(plan.vatRatePercent));
  // Office pilot (Slice 12L/12M): a fixed TOTAL time adjustment per visit. The
  // admin enters MINUTES; the value is stored in hours in the plan's
  // price_adjustment_value field (reused as hours; no schema change).
  const [timeAdjustMinutes, setTimeAdjustMinutes] = useState<string>(
    String(hoursToMinutes(plan.priceAdjustmentValue ?? 0)),
  );
  // Slice V2-D (Home): a price-only start adjustment. Entered in MINUTES, shown
  // with an hours preview, persisted as HOURS to cleaning_plans.start_adjustment_hours
  // (never the overloaded legacy price_adjustment_value).
  const [homeStartAdjustMinutes, setHomeStartAdjustMinutes] = useState<string>(
    String(hoursToMinutes(plan.startAdjustmentHours ?? 0)),
  );
  const [rutEnabled, setRutEnabled] = useState<boolean>(plan.rutEnabled);
  const [rutPercent, setRutPercent] = useState<string>(String(plan.rutPercent));
  const [showRutBreakdown, setShowRutBreakdown] = useState<boolean>(plan.showRutBreakdown);
  const [active, setActive] = useState<boolean>(plan.active);
  const [saving, setSaving] = useState<boolean>(false);
  const [savedAt, setSavedAt] = useState<number>(0);
  const [settingDefault, setSettingDefault] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const preview = useMemo(() => {
    const rate = Number(hourlyRate);
    const vat = Number(vatRatePercent);
    const rut = Number(rutPercent);
    return taxPreview(
      Number.isFinite(rate) ? rate : 0,
      Number.isFinite(vat) ? vat : 25,
      isHome && rutEnabled,
      Number.isFinite(rut) ? rut : 50,
    );
  }, [hourlyRate, isHome, rutEnabled, rutPercent, vatRatePercent]);

  const save = useCallback(async () => {
    setError(null);
    setSavedAt(0);
    if (name.trim() === "") {
      setError("Plan name is required.");
      return;
    }
    const rate = Number(hourlyRate);
    const vat = Number(vatRatePercent);
    const rut = Number(rutPercent);
    if (!Number.isFinite(rate) || rate < 0) {
      setError("Hourly price excl. VAT must be zero or greater.");
      return;
    }
    if (!Number.isFinite(vat) || vat < 0) {
      setError("VAT rate must be zero or greater.");
      return;
    }
    if (!Number.isFinite(rut) || rut < 0 || rut > 100) {
      setError("RUT percent must be between 0 and 100.");
      return;
    }
    let timeAdjust = 0;
    if (isOffice) {
      const minutes = Number(timeAdjustMinutes);
      if (!Number.isFinite(minutes)) {
        setError("Fixed total time adjustment must be a number.");
        return;
      }
      timeAdjust = minutes / 60;
    }
    let homeStartAdjust = 0;
    if (isHome) {
      const minutes = Number(homeStartAdjustMinutes);
      if (!Number.isFinite(minutes)) {
        setError("Start adjustment must be a number.");
        return;
      }
      homeStartAdjust = minutes / 60;
    }
    setSaving(true);
    try {
      await onSavePlan(plan.legacyId, {
        name: name.trim(),
        description: description.trim() === "" ? null : description.trim(),
        hourlyRate: rate,
        vatRatePercent: vat,
        rutEligible: isHome,
        rutEnabled: isHome ? rutEnabled : false,
        rutPercent: rut,
        rutApplyTo: "total_customer_price",
        showRutBreakdown: isHome ? showRutBreakdown && rutEnabled : false,
        active,
        // Office plans carry their fixed per-visit time adjustment here (hours).
        ...(isOffice ? { priceAdjustmentType: "fixed_amount" as const, priceAdjustmentValue: timeAdjust } : {}),
        // Home plans carry the V2 price-only start adjustment in its own column (hours).
        ...(isHome ? { startAdjustmentHours: homeStartAdjust } : {}),
      });
      setSavedAt(Date.now());
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }, [active, description, homeStartAdjustMinutes, hourlyRate, isHome, isOffice, name, onSavePlan, plan.legacyId, rutEnabled, rutPercent, showRutBreakdown, timeAdjustMinutes, vatRatePercent]);

  // Slice V2-D — lightweight client-side guard: never let the admin deactivate
  // the last active plan while the service is enabled (the public calculator
  // needs at least one active plan to price).
  const handleActiveChange = useCallback(
    (next: boolean) => {
      if (!next && lastActiveGuard) {
        setError("At least one plan must stay active while this service is enabled.");
        return;
      }
      setError(null);
      setActive(next);
    },
    [lastActiveGuard],
  );

  const handleSetDefault = useCallback(async () => {
    if (!onSetDefault) return;
    setError(null);
    setSettingDefault(true);
    try {
      await onSetDefault();
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setSettingDefault(false);
    }
  }, [onSetDefault]);

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{name || plan.name}</h3>
            {plan.isDefault ? <Pill tone="blue">Default</Pill> : null}
            <Pill tone={active ? "green" : "muted"}>{active ? "Active" : "Inactive"}</Pill>
          </div>
          <div className="mt-2"><LockedChip>{plan.planKey}</LockedChip></div>
        </div>
        <Switch checked={active} onCheckedChange={handleActiveChange} aria-label={`${plan.name} active`} />
      </div>

      {/* Editable plan identity (name + description). plan_key stays permanent/locked. */}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${plan.legacyId}-name`} className="block">Plan name</Label>
          <Input id={`${plan.legacyId}-name`} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${plan.legacyId}-desc`} className="block">Description</Label>
          <Input
            id={`${plan.legacyId}-desc`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Shown to the customer (optional)"
          />
        </div>
      </div>

      {isOffice ? (
        <div className="mt-4 space-y-3">
          {/* Pricing — the selected plan's hourly price only. */}
          <div className="rounded-xl border border-border bg-muted/20 p-3">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" />
              <p className="text-sm font-semibold">Pricing</p>
            </div>
            <div className="mt-3 space-y-1.5">
              <Label htmlFor={`${plan.legacyId}-rate`}>Price per hour excl. VAT</Label>
              <Input id={`${plan.legacyId}-rate`} type="number" inputMode="decimal" value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)} />
            </div>
          </div>

          {/* Start adjustment — a fixed total time delta per visit, entered in minutes. */}
          <div className="rounded-xl border border-border bg-muted/20 p-3">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" />
              <p className="text-sm font-semibold">Start adjustment</p>
            </div>
            <div className="mt-3 space-y-1.5">
              <Label htmlFor={`${plan.legacyId}-time-adjust`}>Fixed total time adjustment per visit</Label>
              <div className="flex items-center gap-2">
                <Input id={`${plan.legacyId}-time-adjust`} type="number" inputMode="numeric" step="5" value={timeAdjustMinutes} onChange={(e) => setTimeAdjustMinutes(e.target.value)} />
                <span className="text-xs text-muted-foreground">min</span>
              </div>
              {Number.isFinite(Number(timeAdjustMinutes)) && timeAdjustMinutes.trim() !== "" ? (
                <p className="text-[11px] font-medium text-foreground/80">{formatMinutesWithHours(Number(timeAdjustMinutes))}</p>
              ) : null}
            </div>
            <p className="mt-2 flex items-start gap-2 text-[11px] text-muted-foreground">
              <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Fixed total time adjustment added once per cleaning visit. Example: 15 min means 15 extra minutes per visit, not 15 extra minutes per hour.
            </p>
          </div>

          {/* VAT — tax rate only. RUT stays hidden for Office Cleaning. */}
          <div className="rounded-xl border border-border bg-muted/20 p-3">
            <div className="flex items-center gap-2">
              <Receipt className="h-4 w-4 text-primary" />
              <p className="text-sm font-semibold">VAT</p>
            </div>
            <div className="mt-3 space-y-1.5">
              <Label htmlFor={`${plan.legacyId}-vat`}>VAT rate</Label>
              <Input id={`${plan.legacyId}-vat`} type="number" inputMode="decimal" value={vatRatePercent} onChange={(e) => setVatRatePercent(e.target.value)} />
            </div>
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              RUT is off by default for Office Cleaning and hidden from the standard flow.
            </div>
            <dl className="mt-4 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Price excl. VAT</dt><dd className="font-semibold">{formatMoney(preview.priceExclVat, currency)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">VAT amount</dt><dd className="font-semibold">{formatMoney(preview.vatAmount, currency)}</dd></div>
              <div className="flex justify-between gap-3 sm:col-span-2"><dt className="text-muted-foreground">Price incl. VAT</dt><dd className="font-semibold">{formatMoney(preview.priceInclVat, currency)}</dd></div>
            </dl>
          </div>
        </div>
      ) : (
        <>
        <div className="mt-4 rounded-xl border border-border bg-muted/20 p-3">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            <p className="text-sm font-semibold">Price and tax settings</p>
          </div>
          <PlanPriceFields
            kind="hourly"
            priceId={`${plan.legacyId}-rate`}
            priceValue={hourlyRate}
            onPriceChange={setHourlyRate}
            vatId={`${plan.legacyId}-vat`}
            vatValue={vatRatePercent}
            onVatChange={setVatRatePercent}
            currency={currency}
            className="mt-3"
          />

          {isHome ? (
            <PlanRutFields
              idPrefix={plan.legacyId}
              rutEnabled={rutEnabled}
              onRutEnabledChange={setRutEnabled}
              rutPercent={rutPercent}
              onRutPercentChange={setRutPercent}
              showRutBreakdown={showRutBreakdown}
              onShowRutBreakdownChange={setShowRutBreakdown}
              className="mt-3"
            />
          ) : null}

          <dl className="mt-4 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Price excl. VAT</dt><dd className="font-semibold">{formatMoney(preview.priceExclVat, currency)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">VAT amount</dt><dd className="font-semibold">{formatMoney(preview.vatAmount, currency)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Price incl. VAT</dt><dd className="font-semibold">{formatMoney(preview.priceInclVat, currency)}</dd></div>
            {isHome && rutEnabled ? <div className="flex justify-between gap-3"><dt className="text-muted-foreground">RUT deduction</dt><dd className="font-semibold">-{formatMoney(preview.rutDeduction, currency)}</dd></div> : null}
            <div className="flex justify-between gap-3 sm:col-span-2"><dt className="text-muted-foreground">Customer price after RUT</dt><dd className="font-semibold">{formatMoney(preview.priceAfterRut, currency)}</dd></div>
          </dl>
        </div>

        {/* Start adjustment — V2 PRICE-ONLY (Slice V2-D). Entered in minutes, stored
            as hours in cleaning_plans.start_adjustment_hours. Never described as
            changing the customer-facing estimated cleaning time. */}
        <div className="mt-3 rounded-xl border border-border bg-muted/20 p-3">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            <p className="text-sm font-semibold">Start adjustment</p>
          </div>
          <div className="mt-3 space-y-1.5">
            <Label htmlFor={`${plan.legacyId}-home-start-adjust`}>Adjustment per cleaning</Label>
            <div className="flex items-center gap-2">
              <Input
                id={`${plan.legacyId}-home-start-adjust`}
                type="number"
                inputMode="numeric"
                step="5"
                value={homeStartAdjustMinutes}
                onChange={(e) => setHomeStartAdjustMinutes(e.target.value)}
              />
              <span className="text-xs text-muted-foreground">min</span>
            </div>
            {Number.isFinite(Number(homeStartAdjustMinutes)) && homeStartAdjustMinutes.trim() !== "" ? (
              <p className="text-[11px] font-medium text-foreground/80">{formatMinutesWithHours(Number(homeStartAdjustMinutes))}</p>
            ) : null}
          </div>
          <p className="mt-2 flex items-start gap-2 text-[11px] text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Adjusts the price only. It does not change the customer&apos;s estimated cleaning time.
          </p>
        </div>
        </>
      )}

      {error ? <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      {isHome && onSetDefault ? (
        <div className="mt-4">
          {plan.isDefault ? (
            <p className="flex items-center gap-1.5 text-xs font-medium text-sky-600 dark:text-sky-400">
              <Star className="h-3.5 w-3.5 fill-current" /> Default plan for this service
            </p>
          ) : (
            <Button type="button" variant="outline" className="w-full" onClick={handleSetDefault} disabled={settingDefault}>
              <Star className="h-4 w-4" /> Set as default
            </Button>
          )}
        </div>
      ) : null}
      <Button type="button" className="mt-4 w-full" onClick={save} disabled={saving}>
        <Save className="h-4 w-4" /> Save plan
      </Button>
      {savedAt > 0 && !saving ? (
        <p
          className="mt-2 flex items-center justify-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400"
          data-testid={`plan-saved-${plan.legacyId}`}
        >
          <Check className="h-3.5 w-3.5" /> Plan saved
        </p>
      ) : null}
    </div>
  );
}

/**
 * The unchanged bespoke plan editor for the two pilot services (Home + Office).
 * Extracted verbatim from the previous inline map (Slice GPM-4b-1) so their
 * cards, controls and save behaviour stay byte-for-byte identical; the only
 * change is that the `key` now lives on the call site.
 */
function SupportedPlanServiceSection({
  service,
  plans,
  currency,
  onSaveService,
  onSavePlan,
  onSetDefault,
}: {
  service: CalculatorServiceConfig;
  plans: CleaningPlanConfig[];
  currency: string;
  onSaveService: (legacyId: string, patch: ServicePatch) => Promise<void>;
  onSavePlan: (legacyId: string, patch: PlanPatch) => Promise<void>;
  onSetDefault: (input: SetDefaultPlanInput) => Promise<void>;
}) {
  const servicePlans = plans.filter((plan) => plan.serviceKey === service.serviceKey).sort((a, b) => a.sortOrder - b.sortOrder);
  const isHomeService = service.serviceKey === "home_cleaning";
  const activePlanCount = servicePlans.filter((plan) => plan.active).length;
  return (
    <section className="space-y-4 rounded-3xl border border-border bg-muted/20 p-4">
      <div>
        <h2 className="text-base font-semibold">{serviceTitle(service.serviceKey)}</h2>
        {service.serviceKey === "office_cleaning" ? (
          <p className="mt-1 text-sm text-muted-foreground">
            Each plan sets its own hourly price and a fixed time adjustment per visit.
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            Plan cards are the source of truth: each sets its own hourly price, VAT/RUT and start adjustment. The default plan is used when the calculator shows a single price.
          </p>
        )}
      </div>
      {/* Slice V2-D: Home is fully plan-card-driven, so the legacy global plan
          controls (Activate plans / Plan model / Recommended default / Base
          hourly price) are removed. Office keeps its existing controls unchanged. */}
      {!isHomeService ? (
        <ServicePlanControls service={service} plans={servicePlans} onSaveService={onSaveService} />
      ) : null}
      {servicePlans.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          {servicePlans.map((plan) => (
            <PlanCard
              key={plan.legacyId}
              plan={plan}
              currency={currency}
              isHome={isHomeService}
              isOffice={service.serviceKey === "office_cleaning"}
              onSavePlan={onSavePlan}
              onSetDefault={
                isHomeService
                  ? () =>
                      onSetDefault({
                        planLegacyId: plan.legacyId,
                        planKey: plan.planKey,
                        serviceLegacyId: service.legacyId,
                        clearSiblingLegacyIds: servicePlans
                          .filter((sibling) => sibling.isDefault && sibling.legacyId !== plan.legacyId)
                          .map((sibling) => sibling.legacyId),
                      })
                  : undefined
              }
              lastActiveGuard={isHomeService && service.enabled && plan.active && activePlanCount === 1}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
          No plans configured for {service.displayName}.
        </div>
      )}
    </section>
  );
}

/**
 * Slice GPM-4b-2 — an EDITABLE plan card for an admin-created generic service on
 * an engine-supported model. It renders only the model-driven pricing fields the
 * GPM-4a contract declares writable, validates the draft with
 * {@link validateGenericPlan} before saving, and persists exactly those fields
 * (plus the active toggle) through the shared `onSavePlan` / `PlanPatch` path —
 * the same write path Home/Office use. `model` is always engine-supported here
 * (`hourly_by_area` or `sqm_fixed`); the parent never renders this card for a
 * reserved model, so no per-unit / package-base inputs exist.
 */
function GenericPlanCard({
  plan,
  model,
  currency,
  onSavePlan,
}: {
  plan: CleaningPlanConfig;
  model: GenericPricingModel;
  currency: string;
  onSavePlan: (legacyId: string, patch: PlanPatch) => Promise<void>;
}) {
  const isHourly = model === "hourly_by_area";
  const [name, setName] = useState<string>(plan.name);
  const [description, setDescription] = useState<string>(plan.description ?? "");
  // hourly_by_area fields
  const [hourlyRate, setHourlyRate] = useState<string>(String(plan.hourlyRate ?? ""));
  const [startAdjustmentHours, setStartAdjustmentHours] = useState<string>(String(plan.startAdjustmentHours ?? 0));
  // sqm_fixed fields
  const [pricePerSqm, setPricePerSqm] = useState<string>(plan.pricePerSqmExclVat != null ? String(plan.pricePerSqmExclVat) : "");
  const [fixedAdjustment, setFixedAdjustment] = useState<string>(String(plan.fixedAdjustmentExclVat ?? 0));
  const [minimumPrice, setMinimumPrice] = useState<string>(plan.minimumPriceExclVat != null ? String(plan.minimumPriceExclVat) : "");
  // Plan-level RUT / deduction (GPM-10-B) — a generic capability shared by every
  // engine-backed generic model, persisted through the same `rut_*` columns Home uses.
  const [rutEnabled, setRutEnabled] = useState<boolean>(plan.rutEnabled);
  const [rutPercent, setRutPercent] = useState<string>(String(plan.rutPercent));
  const [showRutBreakdown, setShowRutBreakdown] = useState<boolean>(plan.showRutBreakdown);
  const [active, setActive] = useState<boolean>(plan.active);
  const [saving, setSaving] = useState<boolean>(false);
  const [savedAt, setSavedAt] = useState<number>(0);
  const [errors, setErrors] = useState<string[]>([]);

  const save = useCallback(async () => {
    setErrors([]);
    setSavedAt(0);
    const trimmedName = name.trim();
    if (trimmedName === "") {
      setErrors(["Plan name is required."]);
      return;
    }
    const draft: GenericPlanDraft = isHourly
      ? {
          hourlyRate: parseOptionalNumber(hourlyRate),
          startAdjustmentHours: parseOptionalNumber(startAdjustmentHours),
        }
      : {
          pricePerSqmExclVat: parseOptionalNumber(pricePerSqm),
          fixedAdjustmentExclVat: parseOptionalNumber(fixedAdjustment),
          minimumPriceExclVat: parseOptionalNumber(minimumPrice),
        };
    const problems = validateGenericPlan(draft, model);
    // GPM-10-B — the RUT percent only has to be valid when the deduction is active.
    const rutPercentValue = Number(rutPercent);
    if (rutEnabled && (!Number.isFinite(rutPercentValue) || rutPercentValue < 0 || rutPercentValue > 100)) {
      problems.push("RUT percent must be between 0 and 100.");
    }
    if (problems.length > 0) {
      setErrors(problems);
      return;
    }
    // Plan-level RUT / deduction (GPM-10-B). One switch makes the plan RUT-eligible
    // AND on by default; the existing service-agnostic pipeline (resolveRut →
    // displayPricing) reads these columns to show price before/after RUT. `rutApplyTo`
    // is intentionally left untouched — the engine does not consume it yet.
    const rutPatch: Pick<PlanPatch, "rutEligible" | "rutEnabled" | "rutPercent" | "showRutBreakdown"> = {
      rutEligible: rutEnabled,
      rutEnabled,
      rutPercent: Number.isFinite(rutPercentValue) ? rutPercentValue : 50,
      showRutBreakdown: rutEnabled && showRutBreakdown,
    };
    // Editable plan identity (name + description). plan_key stays permanent/locked.
    const metaPatch: Pick<PlanPatch, "name" | "description"> = {
      name: trimmedName,
      description: description.trim() === "" ? null : description.trim(),
    };
    // Validation passed, so every required pricing field is a finite, valid number.
    const patch: PlanPatch = isHourly
      ? {
          ...metaPatch,
          hourlyRate: Number(hourlyRate),
          startAdjustmentHours: startAdjustmentHours.trim() === "" ? 0 : Number(startAdjustmentHours),
          active,
          ...rutPatch,
        }
      : {
          ...metaPatch,
          pricePerSqmExclVat: Number(pricePerSqm),
          fixedAdjustmentExclVat: fixedAdjustment.trim() === "" ? 0 : Number(fixedAdjustment),
          minimumPriceExclVat: minimumPrice.trim() === "" ? null : Number(minimumPrice),
          active,
          ...rutPatch,
        };
    setSaving(true);
    try {
      await onSavePlan(plan.legacyId, patch);
      setSavedAt(Date.now());
    } catch (err) {
      setErrors([toErrorMessage(err)]);
    } finally {
      setSaving(false);
    }
  }, [active, description, fixedAdjustment, hourlyRate, isHourly, minimumPrice, model, name, onSavePlan, plan.legacyId, pricePerSqm, rutEnabled, rutPercent, showRutBreakdown, startAdjustmentHours]);

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{name || plan.name}</h3>
            {plan.isDefault ? <Pill tone="blue">Default</Pill> : null}
            <Pill tone={active ? "green" : "muted"}>{active ? "Active" : "Inactive"}</Pill>
          </div>
          <div className="mt-2"><LockedChip>{plan.planKey}</LockedChip></div>
        </div>
        <Switch checked={active} onCheckedChange={setActive} aria-label={`${plan.name} active`} />
      </div>

      {/* Editable plan identity (name + description). plan_key stays permanent/locked. */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${plan.legacyId}-generic-name`} className="block">Plan name</Label>
          <Input id={`${plan.legacyId}-generic-name`} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${plan.legacyId}-generic-desc`} className="block">Description</Label>
          <Input
            id={`${plan.legacyId}-generic-desc`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Shown to the customer (optional)"
          />
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-border bg-muted/20 p-3">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold">Pricing</p>
        </div>
        {isHourly ? (
          <div className="mt-3 space-y-3">
            <PlanPriceFields
              kind="hourly"
              priceId={`${plan.legacyId}-generic-hourly`}
              priceValue={hourlyRate}
              onPriceChange={setHourlyRate}
              vatId={`${plan.legacyId}-generic-vat`}
              vatValue={String(plan.vatRatePercent)}
              currency={currency}
            />
            <div className="space-y-1.5">
              <Label htmlFor={`${plan.legacyId}-generic-start-adjust`}>Start adjustment (hours)</Label>
              <Input id={`${plan.legacyId}-generic-start-adjust`} type="number" inputMode="decimal" step="0.25" value={startAdjustmentHours} onChange={(e) => setStartAdjustmentHours(e.target.value)} />
              <p className="text-[11px] text-muted-foreground">Adjusts the price only. Optional — leave 0 for none.</p>
            </div>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            <PlanPriceFields
              kind="sqm"
              priceId={`${plan.legacyId}-generic-sqm`}
              priceValue={pricePerSqm}
              onPriceChange={setPricePerSqm}
              vatId={`${plan.legacyId}-generic-sqm-vat`}
              vatValue={String(plan.vatRatePercent)}
              currency={currency}
            />
            <div className="space-y-1.5">
              <Label htmlFor={`${plan.legacyId}-generic-fixed-adjust`}>Fixed adjustment excl. VAT</Label>
              <Input id={`${plan.legacyId}-generic-fixed-adjust`} type="number" inputMode="decimal" value={fixedAdjustment} onChange={(e) => setFixedAdjustment(e.target.value)} />
              <p className="text-[11px] text-muted-foreground">Optional flat addition or discount (may be negative).</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${plan.legacyId}-generic-min-price`}>Minimum price excl. VAT</Label>
              <Input id={`${plan.legacyId}-generic-min-price`} type="number" inputMode="decimal" value={minimumPrice} onChange={(e) => setMinimumPrice(e.target.value)} />
              <p className="text-[11px] text-muted-foreground">Optional price floor. Leave empty for none.</p>
            </div>
          </div>
        )}
      </div>

      {/* GPM-10-B — plan-level RUT / deduction. Customer-facing label stays "RUT";
          the saved columns feed the existing service-agnostic public pipeline. */}
      <div className="mt-3 rounded-xl border border-border bg-muted/20 p-3">
        <div className="flex items-center gap-2">
          <Receipt className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold">RUT / deduction</p>
        </div>
        <PlanRutFields
          idPrefix={`${plan.legacyId}-generic`}
          rutEnabled={rutEnabled}
          onRutEnabledChange={setRutEnabled}
          rutPercent={rutPercent}
          onRutPercentChange={setRutPercent}
          showRutBreakdown={showRutBreakdown}
          onShowRutBreakdownChange={setShowRutBreakdown}
          className="mt-3"
        />
        <p className="mt-2 flex items-start gap-2 text-[11px] text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Optional. When active, the public calculator shows the price before and after RUT. New plans start with RUT off.
        </p>
      </div>

      {errors.length > 0 ? (
        <ul className="mt-3 space-y-1">
          {errors.map((err) => (
            <li key={err} className="text-sm text-red-600 dark:text-red-400">{err}</li>
          ))}
        </ul>
      ) : null}

      <Button type="button" className="mt-4 w-full" onClick={save} disabled={saving}>
        <Save className="h-4 w-4" /> Save plan
      </Button>
      {savedAt > 0 && !saving ? (
        <p
          className="mt-2 flex items-center justify-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400"
          data-testid={`plan-saved-${plan.legacyId}`}
        >
          <Check className="h-3.5 w-3.5" /> Plan saved
        </p>
      ) : null}
    </div>
  );
}

/**
 * Slice GPM-4c-2 — the Add-plan form for an admin-created generic service on an
 * engine-supported model (`hourly_by_area` or `sqm_fixed`). It starts collapsed
 * behind an "Add plan" button; expanding reveals only the model-driven fields the
 * GPM-4a contract declares (hourly: rate + optional start adjustment; sqm_fixed:
 * price per m² + optional fixed adjustment / minimum price). The draft is checked
 * with the GPM-4c-1 {@link validateNewPlan} (model-aware: key/name/uniqueness +
 * pricing), then submitted through `onAddPlan` as a {@link NewPlanInput}. The
 * `hourly_rate = 0` sentinel for `sqm_fixed` is applied by the data-access layer
 * ({@link createCleaningPlan}), never duplicated here. The parent only renders
 * this for engine-supported models, so the non-hourly branch is always sqm_fixed.
 */
function AddGenericPlanForm({
  service,
  model,
  currency,
  existingPlanKeys,
  nextSortOrder,
  companyId,
  companyLegacyId,
  onAddPlan,
}: {
  service: CalculatorServiceConfig;
  model: GenericPricingModel;
  currency: string;
  existingPlanKeys: readonly string[];
  nextSortOrder: number;
  companyId: string;
  companyLegacyId: string;
  onAddPlan: (input: NewPlanInput) => Promise<void>;
}) {
  const isHourly = model === "hourly_by_area";
  const [open, setOpen] = useState<boolean>(false);
  const [planKey, setPlanKey] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [hourlyRate, setHourlyRate] = useState<string>("");
  const [startAdjustmentHours, setStartAdjustmentHours] = useState<string>("");
  const [pricePerSqm, setPricePerSqm] = useState<string>("");
  const [fixedAdjustment, setFixedAdjustment] = useState<string>("");
  const [minimumPrice, setMinimumPrice] = useState<string>("");
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState<boolean>(false);

  const close = useCallback(() => {
    setOpen(false);
    setPlanKey("");
    setName("");
    setHourlyRate("");
    setStartAdjustmentHours("");
    setPricePerSqm("");
    setFixedAdjustment("");
    setMinimumPrice("");
    setErrors([]);
  }, []);

  const submit = useCallback(async () => {
    setErrors([]);
    const draft: NewPlanDraft = {
      planKey: planKey.trim(),
      name: name.trim(),
      pricingModel: model,
      ...(isHourly
        ? {
            hourlyRate: parseOptionalNumber(hourlyRate),
            startAdjustmentHours: parseOptionalNumber(startAdjustmentHours),
          }
        : {
            pricePerSqmExclVat: parseOptionalNumber(pricePerSqm),
            fixedAdjustmentExclVat: parseOptionalNumber(fixedAdjustment),
            minimumPriceExclVat: parseOptionalNumber(minimumPrice),
          }),
    };
    const problems = validateNewPlan(draft, existingPlanKeys);
    if (problems.length > 0) {
      setErrors(problems);
      return;
    }
    // Validation passed → every required field is a finite, valid number. The
    // data-access layer forces `hourly_rate = 0` for sqm_fixed, so it is omitted here.
    const input: NewPlanInput = {
      companyId,
      companyLegacyId,
      serviceId: service.id,
      serviceLegacyId: service.legacyId,
      serviceKey: service.serviceKey,
      planKey: planKey.trim(),
      name: name.trim(),
      description: null,
      pricingModel: model,
      sortOrder: nextSortOrder,
      ...(isHourly
        ? {
            hourlyRate: Number(hourlyRate),
            ...(startAdjustmentHours.trim() === "" ? {} : { startAdjustmentHours: Number(startAdjustmentHours) }),
          }
        : {
            pricePerSqmExclVat: Number(pricePerSqm),
            ...(fixedAdjustment.trim() === "" ? {} : { fixedAdjustmentExclVat: Number(fixedAdjustment) }),
            ...(minimumPrice.trim() === "" ? {} : { minimumPriceExclVat: Number(minimumPrice) }),
          }),
    };
    setSaving(true);
    try {
      await onAddPlan(input);
      close();
    } catch (err) {
      setErrors([toErrorMessage(err)]);
    } finally {
      setSaving(false);
    }
  }, [
    close,
    companyId,
    companyLegacyId,
    existingPlanKeys,
    fixedAdjustment,
    hourlyRate,
    isHourly,
    minimumPrice,
    model,
    name,
    nextSortOrder,
    onAddPlan,
    planKey,
    pricePerSqm,
    service.id,
    service.legacyId,
    service.serviceKey,
    startAdjustmentHours,
  ]);

  if (!open) {
    return (
      <Button type="button" variant="outline" onClick={() => setOpen(true)} className="w-full sm:w-auto">
        <Plus className="h-4 w-4" /> Add plan
      </Button>
    );
  }

  return (
    <form
      aria-label={`Add a new plan for ${service.displayName}`}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="space-y-4 rounded-2xl border border-border bg-card p-4 shadow-sm"
    >
      <div className="flex items-center gap-2">
        <Plus className="h-4 w-4 text-primary" />
        <p className="text-sm font-semibold">Add a new plan</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${service.serviceKey}-new-plan-key`}>Plan key</Label>
          <Input
            id={`${service.serviceKey}-new-plan-key`}
            value={planKey}
            onChange={(e) => setPlanKey(e.target.value)}
            placeholder="e.g. standard"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${service.serviceKey}-new-plan-name`}>Plan name</Label>
          <Input
            id={`${service.serviceKey}-new-plan-name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Standard"
          />
        </div>
      </div>

      {isHourly ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`${service.serviceKey}-new-hourly`}>Hour price</Label>
            <div className="flex items-center gap-2">
              <Input
                id={`${service.serviceKey}-new-hourly`}
                type="number"
                inputMode="decimal"
                value={hourlyRate}
                onChange={(e) => setHourlyRate(e.target.value)}
              />
              <span className="text-xs text-muted-foreground">{currency}/h</span>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${service.serviceKey}-new-start-adjust`}>Start adjustment (hours)</Label>
            <Input
              id={`${service.serviceKey}-new-start-adjust`}
              type="number"
              inputMode="decimal"
              step="0.25"
              value={startAdjustmentHours}
              onChange={(e) => setStartAdjustmentHours(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">Optional — leave empty for none.</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${service.serviceKey}-new-sqm`}>Price per m²</Label>
            <div className="flex items-center gap-2">
              <Input
                id={`${service.serviceKey}-new-sqm`}
                type="number"
                inputMode="decimal"
                value={pricePerSqm}
                onChange={(e) => setPricePerSqm(e.target.value)}
              />
              <span className="text-xs text-muted-foreground">{currency}/m²</span>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${service.serviceKey}-new-fixed-adjust`}>Fixed adjustment excl. VAT</Label>
            <Input
              id={`${service.serviceKey}-new-fixed-adjust`}
              type="number"
              inputMode="decimal"
              value={fixedAdjustment}
              onChange={(e) => setFixedAdjustment(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">Optional (may be negative).</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${service.serviceKey}-new-min-price`}>Minimum price excl. VAT</Label>
            <Input
              id={`${service.serviceKey}-new-min-price`}
              type="number"
              inputMode="decimal"
              value={minimumPrice}
              onChange={(e) => setMinimumPrice(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">Optional price floor.</p>
          </div>
        </div>
      )}

      <p className="flex items-start gap-2 text-[11px] text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        New plans are created active but never as the default, and never change this service&apos;s public visibility.
      </p>

      {errors.length > 0 ? (
        <ul className="space-y-1">
          {errors.map((err) => (
            <li key={err} className="text-sm text-red-600 dark:text-red-400">
              {err}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={saving}>
          <Plus className="h-4 w-4" /> Create plan
        </Button>
        <Button type="button" variant="ghost" onClick={close} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * Slice GPM-4b-1/2 + GPM-4c-2 — the section for an admin-created GENERIC-model
 * service. Engine-supported models (`hourly_by_area`, `sqm_fixed`) render EDITABLE,
 * model-driven {@link GenericPlanCard}s (GPM-4b-2) plus an {@link AddGenericPlanForm}
 * (GPM-4c-2) — shown both for an empty service (alongside the empty state) and for a
 * service that already has plans. The Add-plan form only appears when a create
 * handler + company identifiers are wired; the GPM-4b-1 safe states are otherwise
 * preserved exactly: a reserved/unsupported model still shows the "configuration
 * pending" notice (no writable inputs, no Add-plan), and a supported model with no
 * wired create path still shows the original empty state.
 */
function GenericPlanServiceSection({
  service,
  plans,
  currency,
  onSavePlan,
  onAddPlan,
  companyId,
  companyLegacyId,
}: {
  service: CalculatorServiceConfig;
  plans: CleaningPlanConfig[];
  currency: string;
  onSavePlan: (legacyId: string, patch: PlanPatch) => Promise<void>;
  /**
   * Slice GPM-4c-1 — create-plan data path, wired but not yet surfaced. GPM-4c-2
   * will add the Add-plan form here; the company identifiers + the service's own
   * id/legacyId/serviceKey are everything a {@link NewPlanInput} needs.
   */
  onAddPlan?: (input: NewPlanInput) => Promise<void>;
  companyId?: string;
  companyLegacyId?: string;
}) {
  const info = genericServicePlanInfo(service);
  const servicePlans = plans
    .filter((plan) => plan.serviceKey === service.serviceKey)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const badges = serviceStatusBadges(service);

  // GPM-4c-2: an Add-plan form is offered only when the model is engine-supported
  // AND a create handler + company identifiers are wired (a NewPlanInput needs
  // them). Plan keys are unique per (company, service_key) — migration 0071 — so
  // duplicate detection scopes to THIS service's own plan keys, not the company's.
  const addPlanForm =
    info.engineSupported && onAddPlan && companyId && companyLegacyId ? (
      <AddGenericPlanForm
        service={service}
        model={info.model}
        currency={currency}
        existingPlanKeys={servicePlans.map((plan) => plan.planKey)}
        nextSortOrder={servicePlans.reduce((max, plan) => Math.max(max, plan.sortOrder), 0) + 1}
        companyId={companyId}
        companyLegacyId={companyLegacyId}
        onAddPlan={onAddPlan}
      />
    ) : null;

  return (
    <section className="space-y-3 rounded-3xl border border-border bg-muted/20 p-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold">Plan — {service.displayName}</h2>
          {badges.map((badge) => (
            <Pill key={badge.key} tone={badge.tone}>{badge.label}</Pill>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Pill tone="blue">{info.modelLabel}</Pill>
          <Pill tone="muted">Primary input: {info.primaryInputLabel}</Pill>
          <Pill tone={info.engineSupported ? "green" : "amber"}>
            {info.engineSupported ? "Engine ready" : "Engine support not active yet"}
          </Pill>
        </div>
      </div>

      {!info.engineSupported ? (
        <div className="rounded-2xl border border-dashed border-amber-500/40 bg-amber-500/5 p-6 text-center">
          <p className="text-sm font-medium text-amber-700 dark:text-amber-300">Pricing model configuration pending</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Engine support not active yet for &ldquo;{info.modelLabel}&rdquo;. Plan pricing fields will be added in a later slice.
          </p>
        </div>
      ) : servicePlans.length === 0 ? (
        <div className="space-y-3">
          <div className="rounded-2xl border border-dashed border-border bg-card p-6 text-center">
            <p className="text-sm font-medium">No plans configured yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {addPlanForm ? "Add the first plan to start pricing this service." : "Plan creation will be handled in a later slice."}
            </p>
          </div>
          {addPlanForm}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            {servicePlans.map((plan) => (
              <GenericPlanCard
                key={plan.legacyId}
                plan={plan}
                model={info.model}
                currency={currency}
                onSavePlan={onSavePlan}
              />
            ))}
          </div>
          {addPlanForm}
        </div>
      )}
    </section>
  );
}

/**
 * Slice GPM-4b-1 — seeded legacy/default services collapsed behind a toggle,
 * mirroring the GPM-2a Services-list grouping. Read-only: managing these still
 * happens on the Services tab. Rendered only when at least one such service
 * exists, so existing Home/Office-only views are unchanged.
 */
function LegacyPlanServicesSection({ services, plans }: { services: CalculatorServiceConfig[]; plans: CleaningPlanConfig[] }) {
  const [open, setOpen] = useState<boolean>(false);
  return (
    <section className="space-y-3 rounded-3xl border border-border bg-muted/10 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Legacy / default services</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Seeded services kept on their original pricing models. Shown read-only here — manage them from the Services tab.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
          {open ? "Hide legacy services" : `Show legacy services (${services.length})`}
        </Button>
      </div>
      {open ? (
        <div className="space-y-3">
          {services.map((service) => {
            const servicePlans = plans.filter((plan) => plan.serviceKey === service.serviceKey);
            const badges = serviceStatusBadges(service);
            return (
              <div key={service.serviceKey} className="rounded-2xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold">{service.displayName}</h3>
                  {badges.map((badge) => (
                    <Pill key={badge.key} tone={badge.tone}>{badge.label}</Pill>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {servicePlans.length > 0
                    ? `${servicePlans.length} plan${servicePlans.length === 1 ? "" : "s"} configured.`
                    : "No plans configured."}{" "}
                  Manage this legacy service from the Services tab.
                </p>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

export interface CleaningPlansEditorProps {
  services: CalculatorServiceConfig[];
  plans: CleaningPlanConfig[];
  currency: string;
  onSaveService: (legacyId: string, patch: ServicePatch) => Promise<void>;
  onSavePlan: (legacyId: string, patch: PlanPatch) => Promise<void>;
  /** Slice V2-D — Home: promote a plan to default (clears siblings + mirrors the legacy default key). */
  onSetDefault: (input: SetDefaultPlanInput) => Promise<void>;
  /**
   * Slice GPM-4c-1 — create a new plan for an admin-built generic service. Wired
   * through to the generic builder lane so GPM-4c-2 can surface an Add-plan form;
   * no create-plan UI is rendered yet. Optional so existing render sites stay valid.
   */
  onAddPlan?: (input: NewPlanInput) => Promise<void>;
  /** Owning company identifiers needed to build a {@link NewPlanInput} (GPM-4c-1 wiring). */
  companyId?: string;
  companyLegacyId?: string;
}

export function CleaningPlansEditor({
  services,
  plans,
  currency,
  onSaveService,
  onSavePlan,
  onSetDefault,
  onAddPlan,
  companyId,
  companyLegacyId,
}: CleaningPlansEditorProps) {
  // GPM-4b-1 — model-aware lanes. Home/Office keep their bespoke editors; admin-
  // built generic-model services join the builder lane with a safe read-only card;
  // seeded legacy-model services collapse behind a toggle (GPM-2a grouping concept).
  const supportedServices = useMemo(
    () => services.filter((service) => planEditorLane(service) === "supported_editor"),
    [services],
  );
  const genericServices = useMemo(
    () => services.filter((service) => planEditorLane(service) === "generic"),
    [services],
  );
  const legacyServices = useMemo(
    () => services.filter((service) => planEditorLane(service) === "legacy"),
    [services],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-2 rounded-xl border border-sky-500/30 bg-sky-500/5 p-3 text-xs text-sky-700 dark:text-sky-300">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <p>
          Configure price, VAT, RUT calculation and RUT display in the same plan card. Prices entered here are hourly prices excl. VAT.
        </p>
      </div>

      {supportedServices.map((service) => (
        <SupportedPlanServiceSection
          key={service.serviceKey}
          service={service}
          plans={plans}
          currency={currency}
          onSaveService={onSaveService}
          onSavePlan={onSavePlan}
          onSetDefault={onSetDefault}
        />
      ))}

      {genericServices.length > 0 ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5" /> Generic builder services
          </div>
          {genericServices.map((service) => (
            <GenericPlanServiceSection
              key={service.serviceKey}
              service={service}
              plans={plans}
              currency={currency}
              onSavePlan={onSavePlan}
              onAddPlan={onAddPlan}
              companyId={companyId}
              companyLegacyId={companyLegacyId}
            />
          ))}
        </div>
      ) : null}

      {legacyServices.length > 0 ? <LegacyPlanServicesSection services={legacyServices} plans={plans} /> : null}
    </div>
  );
}

export default CleaningPlansEditor;
