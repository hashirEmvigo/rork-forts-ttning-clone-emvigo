import type { ReactNode } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/**
 * GPM-UX-ADMIN-3/4 — the compact, model-aware plan pricing row: `[Price] [VAT]
 * [Total]`. Presentation only: it renders the existing plan price + VAT values and
 * a derived (incl. VAT) total. It never changes a save path or any pricing math.
 *
 * GPM-UX-ADMIN-4 polish: every field is now the same h-10 bordered box with its
 * unit attached on the right, and each label is a block `<Label>` on top — so the
 * three cells line up exactly and Total no longer floats above Price/VAT.
 *
 * The price label + unit adapt to the plan's pricing model so an sqm_fixed plan
 * never shows the hourly "SEK/h" unit:
 *   • hourly  → "Hour price"  · {currency}/h
 *   • sqm     → "Price per m²" · {currency}/m²
 *   • neutral → "Price"        · {currency}   (reserved/future models)
 */
export type PlanPriceKind = "hourly" | "sqm" | "neutral";

/** The adaptive price-field label + unit for a pricing kind. */
export function planPriceFieldMeta(kind: PlanPriceKind, currency: string): { label: string; unit: string } {
  switch (kind) {
    case "hourly":
      return { label: "Hour price", unit: `${currency}/h` };
    case "sqm":
      return { label: "Price per m²", unit: `${currency}/m²` };
    default:
      return { label: "Price", unit: currency };
  }
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatNumber(value: number): string {
  return Number.isFinite(value)
    ? roundMoney(value).toLocaleString("sv-SE", { maximumFractionDigits: 2 })
    : "—";
}

/**
 * A uniform h-10 control shell with the field unit attached on the right, so an
 * editable input, a read-only value and the derived total all share one height +
 * baseline. The `focus-within` ring mirrors the input's own focus state.
 */
function FieldShell({
  suffix,
  readOnly,
  children,
}: {
  suffix: string;
  readOnly?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex h-10 items-center rounded-md border border-input pl-3 ring-offset-background",
        readOnly ? "bg-muted/40" : "bg-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
      )}
    >
      {children}
      <span className="whitespace-nowrap px-3 text-[11px] text-muted-foreground">{suffix}</span>
    </div>
  );
}

/** A borderless number input that fills the {@link FieldShell} (the shell owns the border + ring). */
function BareNumberInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Input
      id={id}
      type="number"
      inputMode="decimal"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
    />
  );
}

export function PlanPriceFields({
  kind,
  priceId,
  priceValue,
  onPriceChange,
  vatId,
  vatValue,
  onVatChange,
  currency,
  className,
}: {
  kind: PlanPriceKind;
  priceId: string;
  priceValue: string;
  onPriceChange: (value: string) => void;
  vatId: string;
  vatValue: string;
  /** When omitted the VAT field is read-only (derived from the plan, never re-saved). */
  onVatChange?: (value: string) => void;
  currency: string;
  className?: string;
}) {
  const meta = planPriceFieldMeta(kind, currency);
  const price = Number(priceValue);
  const vat = Number(vatValue);
  const total = Number.isFinite(price) && Number.isFinite(vat) ? price * (1 + vat / 100) : NaN;

  return (
    <div className={cn("grid grid-cols-1 gap-3 sm:grid-cols-3", className)}>
      <div className="space-y-1.5">
        <Label htmlFor={priceId} className="block">
          {meta.label}
        </Label>
        <FieldShell suffix={meta.unit}>
          <BareNumberInput id={priceId} value={priceValue} onChange={onPriceChange} />
        </FieldShell>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={vatId} className="block">
          VAT
        </Label>
        {onVatChange ? (
          <FieldShell suffix="%">
            <BareNumberInput id={vatId} value={vatValue} onChange={onVatChange} />
          </FieldShell>
        ) : (
          <div
            id={vatId}
            className="flex h-10 items-center justify-between gap-1.5 rounded-md border border-input bg-muted/40 px-3 text-sm"
          >
            <span className="tabular-nums text-muted-foreground">{formatNumber(vat)}</span>
            <span className="text-[11px] text-muted-foreground">%</span>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <Label className="block">Total</Label>
        <div className="flex h-10 items-center justify-between gap-1.5 rounded-md border border-input bg-muted/40 px-3 text-sm">
          <span className="font-semibold tabular-nums">{formatNumber(total)}</span>
          <span className="whitespace-nowrap text-[11px] text-muted-foreground">{meta.unit}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * GPM-UX-ADMIN-4 — the symmetric plan-level RUT / deduction row: `[RUT] [RUT
 * percent %] [Show]`. All three controls are equal-height h-10 boxes under block
 * labels, and the percent `%` is attached inside the same input box so the row
 * reads as one balanced group. Presentation only — it owns no RUT math and never
 * touches a save path; the parent keeps the state and persists it unchanged.
 */
export function PlanRutFields({
  idPrefix,
  rutEnabled,
  onRutEnabledChange,
  rutPercent,
  onRutPercentChange,
  showRutBreakdown,
  onShowRutBreakdownChange,
  className,
}: {
  idPrefix: string;
  rutEnabled: boolean;
  onRutEnabledChange: (next: boolean) => void;
  rutPercent: string;
  onRutPercentChange: (value: string) => void;
  showRutBreakdown: boolean;
  onShowRutBreakdownChange: (next: boolean) => void;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-1 gap-3 sm:grid-cols-3", className)}>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-rut-active`} className="block">
          RUT
        </Label>
        <div className="flex h-10 items-center justify-between rounded-md border border-input bg-background px-3">
          <span className="text-xs text-muted-foreground">{rutEnabled ? "On" : "Off"}</span>
          <Switch id={`${idPrefix}-rut-active`} checked={rutEnabled} onCheckedChange={onRutEnabledChange} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-rut-percent`} className="block">
          RUT percent
        </Label>
        <FieldShell suffix="%">
          <BareNumberInput id={`${idPrefix}-rut-percent`} value={rutPercent} onChange={onRutPercentChange} />
        </FieldShell>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-show-rut`} className="block">
          Show
        </Label>
        <div className="flex h-10 items-center justify-between rounded-md border border-input bg-background px-3">
          <span className="text-xs text-muted-foreground">{showRutBreakdown && rutEnabled ? "On" : "Off"}</span>
          <Switch
            id={`${idPrefix}-show-rut`}
            checked={showRutBreakdown && rutEnabled}
            disabled={!rutEnabled}
            onCheckedChange={onShowRutBreakdownChange}
          />
        </div>
      </div>

      {!rutEnabled ? <p className="text-[11px] text-amber-600 sm:col-span-3">RUT is not active.</p> : null}
    </div>
  );
}
