import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  ChevronDown,
  Clock,
  History,
  Lock,
  Pencil,
  Percent,
  PlusCircle,
  Puzzle,
  Ruler,
  Trash2,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { LockedChip, Pill } from "@/components/calculator/configBadges";
import { CollapsibleServiceCard } from "@/components/calculator/ConfigCard";
import { InactiveItemsToggle, pricingSubsectionClass } from "@/components/calculator/serviceWorkbench";
import {
  validatePricingRuleValue,
  type CalculatorServiceConfig,
  type PricingRuleAuditEntry,
  type PricingRuleConfig,
  type CleaningPlanConfig,
  type SqmAdjustmentRangeConfig,
} from "@/lib/calculator/calculatorConfigAdmin";
import {
  formatHoursPerSqm,
  formatHoursWithMinutes,
  formatMinutesWithHours,
  formatPlainNumber,
  parseLooseNumber,
} from "@/lib/calculator/timeUnits";

function currencySuffix(currency: string): string {
  return currency === "SEK" ? "kr" : currency;
}

/** Human label from a snake_case rule key (e.g. `hours_per_sqm` → "Hours per sqm"). */
function humanizeKey(key: string): string {
  return key
    .split("_")
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/**
 * Business-friendly labels for rule keys that are otherwise too technical. The
 * underlying technical key is never changed and stays visible as a muted chip.
 */
const RULE_LABEL_OVERRIDES: Record<string, string> = {
  every_four_weeks_start_minutes: "Add-on for customers with cleaning every fourth week",
  under_minimum_visit_threshold_minutes: "Small-visit threshold",
  under_minimum_visit_start_minutes: "Small-visit added time",
  // Slice 12N — business-readable labels for the standardized time fields.
  minimum_hours: "Minimum visit time",
  minimum_hours_per_visit: "Minimum visit time",
  // Slice 12P — the single visible start-time setting (deduplicated). base_hours
  // (home) / base_visit_hours (office) are the real, actively-used base/start
  // time inputs; the legacy admin-only strict_setup_start_minutes is hidden.
  base_hours: "Start time for a mission",
  base_visit_hours: "Start time for a mission",
  hours_per_sqm: "Minutes per m²",
  // Slice 12P — clearer rounding label.
  rounding_increment: "Price rounding interval",
};

/** Helper copy shown under the primary label for a few standardized fields. */
const RULE_HELPER_TEXT: Record<string, string> = {
  minimum_hours: "The calculated visit time can never be lower than this value.",
  minimum_hours_per_visit: "The calculated visit time can never be lower than this value.",
  base_hours: "Adds a fixed amount of time once to the mission calculation. Set to 0 min if you do not want to use this.",
  base_visit_hours: "Adds a fixed amount of time once to the mission calculation. Set to 0 min if you do not want to use this.",
  hours_per_sqm: "Time added for each square meter. The stored value is hours per m², but the UI lets you edit it as minutes per m².",
  rounding_increment: "Rounds calculated prices to the selected interval, for example nearest 50 kr.",
};

function ruleLabel(key: string): string {
  return RULE_LABEL_OVERRIDES[key] ?? humanizeKey(key);
}

/**
 * Slice 12N — time-unit classification. Tells us how a stored value should be
 * displayed/edited. The STORED unit never changes; this only drives the adapter.
 * - "minutes": value is raw minutes (keys ending in `minutes`).
 * - "hours": value is hours (keys containing `hours` or add-on hour rules).
 * - "hoursPerSqm": value is hours per m² (e.g. `hours_per_sqm`).
 * - "none": not time-based (percent, currency) — never minute/hour formatted.
 */
export type RuleTimeUnit = "minutes" | "hours" | "hoursPerSqm" | "none";

export function ruleTimeUnitFromKeyType(key: string, ruleType: string): RuleTimeUnit {
  if (key.includes("per_sqm")) return key.includes("price") ? "none" : "hoursPerSqm";
  if (key.includes("minutes")) return "minutes";
  if (key.includes("hours") || ruleType === "addon_hours") return "hours";
  return "none";
}

function ruleTimeUnit(rule: PricingRuleConfig): RuleTimeUnit {
  return ruleTimeUnitFromKeyType(rule.ruleKey, rule.ruleType);
}

/** Format a stored value for a given time unit ("30 min (0.5 h)", etc.). */
function formatTimeUnitValue(value: number, unit: RuleTimeUnit): string {
  if (unit === "minutes") return formatMinutesWithHours(value);
  if (unit === "hours") return formatHoursWithMinutes(value);
  return formatHoursPerSqm(value);
}

/** Best-effort display unit, derived purely from rule_type + key (read-only). */
function ruleUnit(rule: PricingRuleConfig, currency: string): string {
  const cur = currencySuffix(currency);
  switch (rule.ruleType) {
    case "margin_percent":
      return "%";
    case "addon_hours":
      return "h";
    case "addon_price":
    case "rounding":
      return cur;
    case "numeric_factor":
      if (rule.ruleKey.includes("per_sqm")) return rule.ruleKey.includes("price") ? `${cur}/m²` : "h/m²";
      if (rule.ruleKey.includes("hours")) return "h";
      return "";
    case "threshold":
      if (rule.ruleKey.includes("hours")) return "h";
      if (rule.ruleKey.includes("price")) return cur;
      return "";
    default:
      return "";
  }
}

/**
 * Slice 12N — business-friendly sections shown as the primary Pricing tab UX.
 * Rules are routed to a section by `ruleSectionId` (key-aware, not purely by
 * type), so core formula inputs, extra-service add-ons and fixed time
 * adjustments each get their own block. The technical rule keys stay visible
 * inside each card as muted metadata.
 */
const RULE_SECTIONS: Array<{ id: string; label: string; Icon: LucideIcon }> = [
  { id: "base", label: "Base calculation", Icon: SlidersHorizontal },
  { id: "time_adjustments", label: "Time adjustment rules", Icon: Clock },
  { id: "margins", label: "Price-range margins", Icon: Percent },
  // GPM-UX-ADMIN-7 — "Extra service time rules" is renamed "Add-ons" and moved
  // last. It now hosts the unified Add-ons concept: the customer-facing add-ons
  // editor (injected via `addonsSlot`) plus any legacy time-based add-on rules.
  { id: "extra_services", label: "Add-ons", Icon: Puzzle },
];

/**
 * Core formula inputs that belong under "Base calculation". Slice 12P moves the
 * single visible start-time setting (base_hours / base_visit_hours) here so
 * "Start time for a mission" sits alongside Minutes per m² and Minimum visit time.
 */
const BASE_CALC_KEYS = new Set([
  "base_hours",
  "base_visit_hours",
  "hours_per_sqm",
  "minimum_hours",
  "minimum_hours_per_visit",
]);

/**
 * Slice 12P — rule keys hidden from the normal admin UX. `strict_setup_start_minutes`
 * is an admin-only, default-0 override that visually duplicates the start-time
 * concept; the engine still reads it (formula unchanged), it's just not shown
 * as a separate card to avoid confusing duplicate start-time settings.
 */
const HIDDEN_RULE_KEYS = new Set(["strict_setup_start_minutes"]);

/** Route a rule to a business section (key-aware, with type fallbacks). */
function ruleSectionId(rule: PricingRuleConfig): string {
  const { ruleKey: key, ruleType: type } = rule;
  if (BASE_CALC_KEYS.has(key)) return "base";
  // Slice 12P — extra-service hour rules (bathroom/toilet/kitchen/etc.) belong
  // with the customer-selectable add-ons, not the core base calculation.
  if (key.includes("_extra_hours")) return "extra_services";
  // Slice 12Q follow-up — the price rounding interval now lives WITH the
  // price-range margins (lower margin, upper margin, rounding interval) instead
  // of a standalone Rounding section.
  if (type === "margin_percent" || type === "rounding") return "margins";
  if (type === "addon_hours" || type === "addon_price") return "extra_services";
  if (key.includes("minutes") || key.includes("pet")) return "time_adjustments";
  return "base";
}

/** Linked rule pair displayed as a single "Small-visit add-on" card. */
const SMALL_VISIT_THRESHOLD_KEY = "under_minimum_visit_threshold_minutes";
const SMALL_VISIT_ADD_KEY = "under_minimum_visit_start_minutes";

/** Square-meter sample points used by the per-m² time preview. */
const TIME_PREVIEW_SQM = [50, 100, 150] as const;

/**
 * Slice 12O — a non-monetary preview describing the calculated cleaning TIME a
 * rule controls. Prices, VAT and RUT are intentionally excluded because they
 * depend on plan, interval and checkout settings the edit dialog cannot know.
 * Returns either a per-m² table (for per-m² rules) or a single explanation line.
 */
function buildTimePreview(
  ruleKey: string,
  timeUnit: RuleTimeUnit,
  value: number,
): { rows: Array<{ sqm: number; text: string }> } | { text: string } {
  if (timeUnit === "hoursPerSqm") {
    return {
      rows: TIME_PREVIEW_SQM.map((sqm) => ({ sqm, text: formatHoursWithMinutes(sqm * value) })),
    };
  }
  if (ruleKey === "minimum_hours" || ruleKey === "minimum_hours_per_visit") {
    return { text: `The calculated visit time can never be lower than ${formatHoursWithMinutes(value)}.` };
  }
  if (ruleKey === "base_hours" || ruleKey === "base_visit_hours") {
    return { text: `Adds ${formatHoursWithMinutes(value)} once to each mission calculation.` };
  }
  if (ruleKey === "every_four_weeks_start_minutes") {
    return {
      text: `Adds ${formatMinutesWithHours(value)} for customers with cleaning every fourth week.`,
    };
  }
  if (ruleKey === SMALL_VISIT_THRESHOLD_KEY) {
    return {
      text: `If the estimated visit time is under ${formatMinutesWithHours(value)}, extra time is added.`,
    };
  }
  if (ruleKey === SMALL_VISIT_ADD_KEY) {
    return {
      text: `Adds ${formatMinutesWithHours(value)} when the visit is under the small-visit threshold.`,
    };
  }
  const formatted = timeUnit === "minutes" ? formatMinutesWithHours(value) : formatHoursWithMinutes(value);
  return { text: `This rule adds ${formatted} to the cleaning-time calculation.` };
}

function formatValue(rule: PricingRuleConfig, currency: string): string {
  if (rule.valueNumeric === null) return "—";
  const tu = ruleTimeUnit(rule);
  if (tu !== "none") return formatTimeUnitValue(rule.valueNumeric, tu);
  const unit = ruleUnit(rule, currency);
  const num = rule.valueNumeric.toLocaleString("sv-SE");
  return unit ? `${num} ${unit}` : num;
}

/** Audit values are formatted with the same time-aware rules as the cards. */
function formatAuditValue(ruleKey: string, ruleType: string, value: number | null): string {
  if (value === null) return "—";
  const tu = ruleTimeUnitFromKeyType(ruleKey, ruleType);
  if (tu !== "none") return formatTimeUnitValue(value, tu);
  return value.toLocaleString("sv-SE");
}

/** Compact date + time for the audit history list. */
function formatStamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString("sv-SE", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// ── Edit dialog (existing numeric value only — every other field is locked) ──

function PricingRuleEditDialog({
  rule,
  service,
  currency,
  enabled,
  open,
  onOpenChange,
  onSave,
}: {
  rule: PricingRuleConfig;
  service: CalculatorServiceConfig;
  currency: string;
  enabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (rule: PricingRuleConfig, newValue: number, note: string | null) => Promise<void>;
}) {
  const timeUnit = ruleTimeUnit(rule);
  const isTime = timeUnit !== "none";
  // Stored unit: minute rules save the Minutes field; hour / per-m² rules save the Hours field.
  const storedIsHours = timeUnit === "hours" || timeUnit === "hoursPerSqm";

  // Non-time rules use a single Value field; time rules use mirrored Minutes/Hours fields.
  const [valueStr, setValueStr] = useState<string>(rule.valueNumeric === null ? "" : String(rule.valueNumeric));
  const [minutesStr, setMinutesStr] = useState<string>("");
  const [hoursStr, setHoursStr] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);

  useEffect(() => {
    if (open) {
      const v = rule.valueNumeric;
      setValueStr(v === null ? "" : String(v));
      if (v === null) {
        setMinutesStr("");
        setHoursStr("");
      } else if (storedIsHours) {
        setHoursStr(String(v));
        setMinutesStr(formatPlainNumber(v * 60, 2));
      } else {
        setMinutesStr(String(v));
        setHoursStr(formatPlainNumber(v / 60, 4));
      }
      setNote("");
      setConfirmed(false);
      setError(null);
    }
  }, [open, rule, storedIsHours]);

  // Mirror the two time fields: editing one immediately updates the other.
  const onMinutesChange = useCallback((raw: string) => {
    setMinutesStr(raw);
    const n = parseLooseNumber(raw);
    setHoursStr(n === null ? "" : formatPlainNumber(n / 60, 4));
  }, []);
  const onHoursChange = useCallback((raw: string) => {
    setHoursStr(raw);
    const n = parseLooseNumber(raw);
    setMinutesStr(n === null ? "" : formatPlainNumber(n * 60, 2));
  }, []);

  // The value persisted is always in the rule's STORED unit (minutes or hours).
  const savedRaw = isTime ? (storedIsHours ? hoursStr : minutesStr) : valueStr;
  const validation = useMemo(() => validatePricingRuleValue(savedRaw), [savedRaw]);
  const unit = ruleUnit(rule, currency);
  const isUnchanged = validation.value !== null && validation.value === rule.valueNumeric;
  const minutesLabel = timeUnit === "hoursPerSqm" ? "Minutes per m²" : "Minutes";
  const hoursLabel = timeUnit === "hoursPerSqm" ? "Hours per m²" : "Hours";
  const helperText = RULE_HELPER_TEXT[rule.ruleKey] ?? null;

  // Slice 12O — time-only preview for time-based rules. No price/VAT/RUT here.
  const timePreview = useMemo(() => {
    if (!isTime || validation.value === null) return null;
    return buildTimePreview(rule.ruleKey, timeUnit, validation.value);
  }, [isTime, validation.value, rule.ruleKey, timeUnit]);

  const handleSave = useCallback(async () => {
    setError(null);
    if (validation.value === null) {
      setError(validation.error ?? "Enter a valid value.");
      return;
    }
    if (!confirmed) {
      setError("Confirm the price-impact warning before saving.");
      return;
    }
    setSubmitting(true);
    try {
      await onSave(rule, validation.value, note.trim() === "" ? null : note.trim());
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. No change was saved.");
    } finally {
      setSubmitting(false);
    }
  }, [validation, confirmed, onSave, rule, note, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit pricing value</DialogTitle>
          <DialogDescription>
            Only the numeric value is editable. The rule key, type, pricing model and service are locked.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <p className="text-sm font-medium">{ruleLabel(rule.ruleKey)}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <LockedChip>{rule.ruleKey}</LockedChip>
              <LockedChip>{rule.ruleType}</LockedChip>
              <LockedChip>{service.pricingModel}</LockedChip>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">{service.displayName}</p>
          </div>

          {helperText ? <p className="text-xs text-muted-foreground">{helperText}</p> : null}

          {isTime ? (
            <div className="space-y-1.5">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="rule-minutes">{minutesLabel}</Label>
                  <Input
                    id="rule-minutes"
                    type="text"
                    inputMode="decimal"
                    value={minutesStr}
                    onChange={(e) => onMinutesChange(e.target.value)}
                    aria-invalid={validation.error !== null}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rule-hours">{hoursLabel}</Label>
                  <Input
                    id="rule-hours"
                    type="text"
                    inputMode="decimal"
                    value={hoursStr}
                    onChange={(e) => onHoursChange(e.target.value)}
                    aria-invalid={validation.error !== null}
                  />
                </div>
              </div>
              {validation.value !== null ? (
                <p className="text-[11px] font-medium text-foreground/80" data-testid="time-unit-preview">
                  {formatTimeUnitValue(validation.value, timeUnit)}
                </p>
              ) : null}
              {validation.error ? (
                <p className="text-xs text-red-600 dark:text-red-400">{validation.error}</p>
              ) : null}
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="rule-value">Value{unit ? ` (${unit})` : ""}</Label>
              <Input
                id="rule-value"
                type="text"
                inputMode="decimal"
                value={valueStr}
                onChange={(e) => setValueStr(e.target.value)}
                aria-invalid={validation.error !== null}
              />
              {validation.error ? (
                <p className="text-xs text-red-600 dark:text-red-400">{validation.error}</p>
              ) : null}
            </div>
          )}

          {/* Slice 12O — time-only preview (no price / VAT / RUT) for time rules. */}
          {isTime ? (
            <div className="rounded-xl border border-border bg-muted/30 p-3" data-testid="time-preview">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Estimated time preview
              </p>
              {timePreview ? (
                "rows" in timePreview ? (
                  <ul className="mt-2 space-y-1">
                    {timePreview.rows.map((row) => (
                      <li
                        key={row.sqm}
                        className="flex items-center justify-between gap-3 text-sm"
                        data-testid={`time-preview-row-${row.sqm}`}
                      >
                        <span className="text-muted-foreground">{row.sqm} m²</span>
                        <span className="font-semibold tabular-nums">{row.text}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm font-medium">{timePreview.text}</p>
                )
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">Enter a valid value to preview the calculated time.</p>
              )}
              <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
                This preview only shows calculated cleaning time. Prices, VAT and RUT are not shown here because they
                depend on plan, interval, tax and public checkout settings.
              </p>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="rule-note">Reason (optional)</Label>
            <Textarea
              id="rule-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Why are you changing this value?"
            />
          </div>

          {/* Price-impact warning (stronger when the calculator is live) */}
          {enabled ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p>
                The public calculator is currently enabled. This change may affect live customer quotes.
              </p>
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p>This change affects public price calculations.</p>
            </div>
          )}

          <label className="flex items-start gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              aria-label="Confirm price-impact"
            />
            <span>I understand this changes the public price calculation.</span>
          </label>

          {isUnchanged ? (
            <p className="text-xs text-muted-foreground">The value is unchanged.</p>
          ) : null}
          {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={submitting || isUnchanged}>
            Save value
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Compact rule card (read-only value + Edit for numeric values) ────────────

function RuleCard({
  rule,
  currency,
  onEdit,
}: {
  rule: PricingRuleConfig;
  currency: string;
  onEdit: (rule: PricingRuleConfig) => void;
}) {
  const editable = rule.valueNumeric !== null;
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-xl border border-border bg-background p-3",
        !rule.active && "opacity-60",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium leading-tight">{ruleLabel(rule.ruleKey)}</span>
        {!rule.active ? <Pill tone="muted">Inactive</Pill> : null}
      </div>
      {RULE_HELPER_TEXT[rule.ruleKey] ? (
        <p className="text-[11px] leading-snug text-muted-foreground">{RULE_HELPER_TEXT[rule.ruleKey]}</p>
      ) : null}
      <div>
        <LockedChip>{rule.ruleKey}</LockedChip>
      </div>
      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <span className="text-sm font-semibold tabular-nums">{formatValue(rule, currency)}</span>
        {editable ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onEdit(rule)}
            aria-label={`Edit ${ruleLabel(rule.ruleKey)}`}
          >
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Button>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Lock className="h-3 w-3" /> Locked
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Linked "Small-visit add-on" card: the under-minimum threshold and the extra
 * time it adds are two separate technical rules, but they only make sense
 * together, so they are shown as one connected card. Both values stay editable
 * and write back to their original rule keys.
 */
function SmallVisitAddOnCard({
  thresholdRule,
  addRule,
  onEdit,
}: {
  thresholdRule: PricingRuleConfig;
  addRule: PricingRuleConfig;
  onEdit: (rule: PricingRuleConfig) => void;
}) {
  const inactive = !thresholdRule.active || !addRule.active;
  return (
    <div
      className={cn(
        "col-span-full flex flex-col gap-3 rounded-xl border border-border bg-background p-3 sm:col-span-2",
        inactive && "opacity-60",
      )}
      data-testid="linked-rule-small-visit"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium leading-tight">Small-visit add-on</span>
        {inactive ? <Pill tone="muted">Inactive</Pill> : null}
      </div>
      <p className="text-xs text-muted-foreground">
        If the estimated visit time is under the threshold, the calculator adds the extra time below.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-muted/30 p-2.5">
          <p className="text-[11px] font-medium text-muted-foreground">If estimated visit time is under</p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums">
            {formatMinutesWithHours(thresholdRule.valueNumeric ?? 0)}
          </p>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <LockedChip>{thresholdRule.ruleKey}</LockedChip>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onEdit(thresholdRule)}
              aria-label={`Edit ${ruleLabel(thresholdRule.ruleKey)}`}
            >
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-muted/30 p-2.5">
          <p className="text-[11px] font-medium text-muted-foreground">Then add</p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums">
            {formatMinutesWithHours(addRule.valueNumeric ?? 0)}
          </p>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <LockedChip>{addRule.ruleKey}</LockedChip>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onEdit(addRule)}
              aria-label={`Edit ${ruleLabel(addRule.ruleKey)}`}
            >
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Pricing model that uses the per-sqm adjustment ranges (home cleaning only). */
const SQM_ADJUSTMENT_PRICING_MODEL = "home_cleaning_recommended_hours";

/** "2.28 min/m²" — the effective per-m² minutes after applying a range %. */
function effectiveMinutesPerSqm(baseHoursPerSqm: number, adjustmentPercent: number): string {
  const minutes = baseHoursPerSqm * 60 * (1 + adjustmentPercent / 100);
  return `${formatPlainNumber(minutes, 2)} min/m²`;
}

/** Validates the edited ranges (Slice 12Q rules). Returns an error message or null. */
function validateSqmRanges(ranges: SqmAdjustmentRangeConfig[]): string | null {
  let openEnded = 0;
  for (const r of ranges) {
    if (!Number.isFinite(r.fromSqm) || r.fromSqm < 0) return "From m² must be 0 or greater.";
    if (r.toSqm !== null) {
      if (!Number.isFinite(r.toSqm)) return "To m² must be a number or left empty.";
      if (r.toSqm <= r.fromSqm) return "To m² must be greater than From m².";
    } else {
      openEnded += 1;
    }
    if (!Number.isFinite(r.adjustmentPercent)) return "Adjustment % must be a number.";
  }
  if (openEnded > 1) return "Only one open-ended range (empty To m²) is allowed.";
  // Overlap check on sorted ranges.
  const sorted = [...ranges].sort((a, b) => a.fromSqm - b.fromSqm);
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const prevTo = prev.toSqm === null ? Infinity : prev.toSqm;
    if (cur.fromSqm <= prevTo) return "Ranges must not overlap.";
  }
  return null;
}

/**
 * Slice 12Q — "Adjustment for square meters" editor (home cleaning only). Each
 * range scales the configured Minutes per m² by a percentage for areas inside
 * `[fromSqm, toSqm]` (empty To = open-ended top range). The effective per-m²
 * minutes is shown live so the link to Minutes per m² is obvious. Saves the full
 * range list to `settings_json.homeSqmAdjustments` via {@link onSave}; the stored
 * value/meaning never changes here — only the per-m² TIME component is adjusted.
 */
/**
 * Internal draft row: editable fields are held as raw strings so the admin can
 * type intermediate values like "-", "-7." or "" without the controlled input
 * snapping back to 0. Strings are parsed to numbers only on save (Slice 12Q —
 * negative adjustment support).
 */
type SqmDraftRow = { fromSqm: string; toSqm: string; adjustmentPercent: string };

function toDraftRow(r: SqmAdjustmentRangeConfig): SqmDraftRow {
  return {
    fromSqm: String(r.fromSqm),
    toSqm: r.toSqm === null ? "" : String(r.toSqm),
    adjustmentPercent: String(r.adjustmentPercent),
  };
}

function SqmAdjustmentEditor({
  ranges: initial,
  baseHoursPerSqm,
  onSave,
}: {
  ranges: readonly SqmAdjustmentRangeConfig[];
  baseHoursPerSqm: number;
  onSave: (ranges: SqmAdjustmentRangeConfig[]) => Promise<void>;
}) {
  const [rows, setRows] = useState<SqmDraftRow[]>(() => initial.map(toDraftRow));
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number>(0);
  // GPM-UX-ADMIN-6 — the ranges table is collapsed by default so it no longer
  // dominates Pricing; the collapsed state still shows a one-line summary. Local
  // UI state only — saved data is untouched.
  const [tableOpen, setTableOpen] = useState<boolean>(false);

  useEffect(() => {
    setRows(initial.map(toDraftRow));
    setError(null);
  }, [initial]);

  const updateRow = useCallback((idx: number, patch: Partial<SqmDraftRow>) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }, []);
  const addRow = useCallback(() => {
    setRows((prev) => {
      const lastTo = prev.length > 0 ? parseLooseNumber(prev[prev.length - 1].toSqm) : null;
      const from = lastTo !== null && Number.isFinite(lastTo) ? lastTo + 1 : 0;
      return [...prev, { fromSqm: String(from), toSqm: "", adjustmentPercent: "0" }];
    });
  }, []);
  const removeRow = useCallback((idx: number) => {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const handleSave = useCallback(async () => {
    const cleaned: SqmAdjustmentRangeConfig[] = rows.map((r) => {
      const toRaw = r.toSqm.trim();
      return {
        fromSqm: parseLooseNumber(r.fromSqm) ?? 0,
        toSqm: toRaw === "" ? null : parseLooseNumber(toRaw),
        adjustmentPercent: parseLooseNumber(r.adjustmentPercent) ?? 0,
      };
    });
    const validationError = validateSqmRanges(cleaned);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSave(cleaned.sort((a, b) => a.fromSqm - b.fromSqm));
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the adjustment ranges.");
    } finally {
      setSaving(false);
    }
  }, [rows, onSave]);

  return (
    <div
      className="col-span-full rounded-xl border border-border bg-background p-3"
      data-testid="sqm-adjustment-editor"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Ruler className="h-4 w-4 text-primary" aria-hidden="true" />
          <span className="text-sm font-semibold">Adjustment for square meters</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setTableOpen((v) => !v)}
          aria-expanded={tableOpen}
          data-testid="sqm-adjustment-toggle"
        >
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", tableOpen && "rotate-180")} />
          {tableOpen ? "Collapse table" : "Expand table"}
        </Button>
      </div>
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
        Adjusts the Minutes per m² value based on the customer's square-meter range. Example: if Minutes per m² is
        {" "}
        {formatPlainNumber(baseHoursPerSqm * 60, 2)} and the range adjustment is -5%, the effective value becomes
        {" "}
        {effectiveMinutesPerSqm(baseHoursPerSqm, -5)}.
      </p>

      {!tableOpen ? (
        <p className="mt-2 text-xs font-medium text-muted-foreground" data-testid="sqm-adjustment-summary">
          {rows.length === 0
            ? "No ranges configured — Minutes per m² is used as-is."
            : `${rows.length} range${rows.length === 1 ? "" : "s"} configured`}
        </p>
      ) : (
        <>
      {rows.length === 0 ? (
        <p className="mt-3 rounded-lg border border-border bg-background p-3 text-xs text-muted-foreground" data-testid="sqm-adjustment-empty">
          No square-meter adjustments configured. Minutes per m² is used as-is.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((row, idx) => (
            <li
              key={idx}
              className="grid grid-cols-1 gap-2 rounded-lg border border-border bg-background p-2.5 sm:grid-cols-[1fr_1fr_1fr_auto_auto] sm:items-end"
              data-testid={`sqm-adjustment-row-${idx}`}
            >
              <div className="space-y-1">
                <Label className="text-[11px]" htmlFor={`sqm-from-${idx}`}>From m²</Label>
                <Input
                  id={`sqm-from-${idx}`}
                  type="text"
                  inputMode="decimal"
                  value={row.fromSqm}
                  onChange={(e) => updateRow(idx, { fromSqm: e.target.value })}
                  aria-label={`From m² for range ${idx + 1}`}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]" htmlFor={`sqm-to-${idx}`}>To m² (empty = no limit)</Label>
                <Input
                  id={`sqm-to-${idx}`}
                  type="text"
                  inputMode="decimal"
                  value={row.toSqm}
                  onChange={(e) => updateRow(idx, { toSqm: e.target.value })}
                  aria-label={`To m² for range ${idx + 1}`}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]" htmlFor={`sqm-pct-${idx}`}>Adjustment %</Label>
                <Input
                  id={`sqm-pct-${idx}`}
                  type="text"
                  inputMode="text"
                  value={row.adjustmentPercent}
                  onChange={(e) => updateRow(idx, { adjustmentPercent: e.target.value })}
                  aria-label={`Adjustment percent for range ${idx + 1}`}
                />
              </div>
              <div className="space-y-1">
                <span className="block text-[11px] text-muted-foreground">Effective</span>
                <span className="text-xs font-semibold tabular-nums" data-testid={`sqm-adjustment-effective-${idx}`}>
                  {effectiveMinutesPerSqm(baseHoursPerSqm, parseLooseNumber(row.adjustmentPercent) ?? 0)}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeRow(idx)}
                aria-label={`Remove range ${idx + 1}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {error ? <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p> : null}

      <div className="mt-3 flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={addRow}>
          <PlusCircle className="h-3.5 w-3.5" /> Add range
        </Button>
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save ranges"}
        </Button>
        {savedAt > 0 && !saving && !error ? (
          <span className="text-[11px] text-muted-foreground" data-testid="sqm-adjustment-saved">Saved.</span>
        ) : null}
      </div>
        </>
      )}
    </div>
  );
}

/** Body of an expanded service card: locked identifiers + business sections. */
function ServiceRulesBody({
  service,
  rules,
  currency,
  onEditRule,
  onSaveSqmAdjustments,
  addonsSlot,
}: {
  service: CalculatorServiceConfig;
  rules: PricingRuleConfig[];
  currency: string;
  onEditRule: (rule: PricingRuleConfig) => void;
  onSaveSqmAdjustments?: (service: CalculatorServiceConfig, ranges: SqmAdjustmentRangeConfig[]) => Promise<void>;
  /**
   * GPM-UX-ADMIN-7 — the customer-facing add-ons editor, rendered inside the
   * unified "Add-ons" subsection. When present, the Add-ons section is always
   * shown (even with no legacy time-based add-on rules).
   */
  addonsSlot?: ReactNode;
}) {
  // GPM-UX-ADMIN-3 — inactive pricing items stay hidden by default behind a toggle.
  const [showInactive, setShowInactive] = useState<boolean>(false);

  // Base per-m² time (hours) drives the live "effective min/m²" in the editor.
  const baseHoursPerSqm = useMemo(() => {
    const rule = rules.find((r) => r.ruleKey === "hours_per_sqm");
    return rule && rule.valueNumeric !== null ? rule.valueNumeric : 0;
  }, [rules]);

  // Inactive (non-hidden) rules the toggle can reveal.
  const inactiveCount = useMemo(
    () => rules.filter((r) => !HIDDEN_RULE_KEYS.has(r.ruleKey) && !r.active).length,
    [rules],
  );

  const sections = useMemo(() => {
    // Slice 12P — hide legacy/internal duplicate rules from the normal UX; GPM-UX-ADMIN-3
    // additionally hides inactive rules unless the admin reveals them.
    const visible = rules.filter(
      (r) => !HIDDEN_RULE_KEYS.has(r.ruleKey) && (showInactive || r.active),
    );
    return RULE_SECTIONS.map((s) => ({
      ...s,
      rules: visible.filter((r) => ruleSectionId(r) === s.id).sort((a, b) => a.sortOrder - b.sortOrder),
    })).filter((s) => s.rules.length > 0 || (s.id === "extra_services" && Boolean(addonsSlot)));
  }, [rules, showInactive, addonsSlot]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <LockedChip>{service.serviceKey}</LockedChip>
        <LockedChip>{service.pricingModel}</LockedChip>
        <div className="ml-auto">
          <InactiveItemsToggle
            hiddenCount={inactiveCount}
            open={showInactive}
            onToggle={() => setShowInactive((v) => !v)}
            showLabel="Show inactive pricing items"
            hideLabel="Hide inactive pricing items"
            testId={`pricing-inactive-toggle-${service.id}`}
          />
        </div>
      </div>

      {rules.length === 0 && !addonsSlot ? (
        <p className="text-sm text-muted-foreground">No pricing rules configured for this service.</p>
      ) : (
        sections.map((section) => {
          const SectionIcon = section.Icon;

          // GPM-UX-ADMIN-7 — the unified "Add-ons" subsection. One header, one
          // concept: customer-facing add-ons (the injected slot) + any legacy
          // time-based add-on rules, presented together and always rendered last.
          if (section.id === "extra_services") {
            return (
              <section
                key={section.id}
                className={pricingSubsectionClass}
                data-testid={`rule-section-${section.id}`}
              >
                <div className="mb-1 flex items-center gap-2">
                  <span
                    className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary"
                    data-testid={`rule-section-icon-${section.id}`}
                  >
                    <SectionIcon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <h4 className="text-sm font-semibold">{section.label}</h4>
                </div>
                <p className="mb-3 text-[11px] leading-snug text-muted-foreground">
                  Add-ons are optional extras the customer can choose. They can increase or decrease time,
                  add a fixed price, or adjust the calculated price.
                </p>
                {addonsSlot ? <div>{addonsSlot}</div> : null}
                {section.rules.length > 0 ? (
                  <div className={cn(addonsSlot && "mt-4 border-t border-primary/15 pt-4")}>
                    {addonsSlot ? (
                      <p className="mb-2 text-xs font-semibold text-foreground/80">
                        Existing time-based add-on rules
                      </p>
                    ) : null}
                    <div
                      className="grid auto-rows-fr grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
                      data-testid={`rule-grid-${section.id}`}
                    >
                      {section.rules.map((rule) => (
                        <RuleCard key={rule.legacyId} rule={rule} currency={currency} onEdit={onEditRule} />
                      ))}
                    </div>
                  </div>
                ) : null}
              </section>
            );
          }

          const thresholdRule =
            section.id === "time_adjustments"
              ? section.rules.find((r) => r.ruleKey === SMALL_VISIT_THRESHOLD_KEY)
              : undefined;
          const addRule =
            section.id === "time_adjustments"
              ? section.rules.find((r) => r.ruleKey === SMALL_VISIT_ADD_KEY)
              : undefined;
          const hasLinkedSmallVisit = Boolean(thresholdRule && addRule);
          const standaloneRules = hasLinkedSmallVisit
            ? section.rules.filter(
                (r) => r.ruleKey !== SMALL_VISIT_THRESHOLD_KEY && r.ruleKey !== SMALL_VISIT_ADD_KEY,
              )
            : section.rules;
          return (
            <section
              key={section.id}
              className={pricingSubsectionClass}
              data-testid={`rule-section-${section.id}`}
            >
              <div className="mb-3 flex items-center gap-2">
                <span
                  className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary"
                  data-testid={`rule-section-icon-${section.id}`}
                >
                  <SectionIcon className="h-4 w-4" aria-hidden="true" />
                </span>
                <h4 className="text-sm font-semibold">{section.label}</h4>
              </div>
              {/* GPM-UX-ADMIN-5 — home's Base calculation packs its rule cards AND the
                  square-meter adjustment editor into ONE dense row on wide screens: three
                  narrow rule cards (Start time / Minutes per m² / Minimum visit time) beside
                  one wider adjustment card, instead of tall half-empty cards with the
                  adjustment block dropped below. Other sections/services keep the standard grid. */}
              {section.id === "base" &&
              service.pricingModel === SQM_ADJUSTMENT_PRICING_MODEL &&
              onSaveSqmAdjustments ? (
                <div
                  className="grid grid-cols-1 gap-2 xl:grid-cols-5 xl:items-start"
                  data-testid={`rule-grid-${section.id}`}
                >
                  <div className="grid auto-rows-fr grid-cols-1 gap-2 sm:grid-cols-3 xl:col-span-3">
                    {standaloneRules.map((rule) => (
                      <RuleCard key={rule.legacyId} rule={rule} currency={currency} onEdit={onEditRule} />
                    ))}
                  </div>
                  <div className="xl:col-span-2">
                    <SqmAdjustmentEditor
                      ranges={service.homeSqmAdjustments ?? []}
                      baseHoursPerSqm={baseHoursPerSqm}
                      onSave={(ranges) => onSaveSqmAdjustments(service, ranges)}
                    />
                  </div>
                </div>
              ) : (
                <div
                  className="grid auto-rows-fr grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
                  data-testid={`rule-grid-${section.id}`}
                >
                  {hasLinkedSmallVisit && thresholdRule && addRule ? (
                    <SmallVisitAddOnCard thresholdRule={thresholdRule} addRule={addRule} onEdit={onEditRule} />
                  ) : null}
                  {standaloneRules.map((rule) => (
                    <RuleCard key={rule.legacyId} rule={rule} currency={currency} onEdit={onEditRule} />
                  ))}
                </div>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}

// ── Audit history ────────────────────────────────────────────────────────────

/**
 * GPM-UX-ADMIN-4 — the append-only pricing-change history. Relocated out of the
 * Pricing workspace and now rendered inside the Settings section; exported so the
 * Settings editor can compose it alongside the other settings panels. Presentation
 * only — it just reads the audit entries it is given.
 */
export function PricingChangeHistory({ entries, isLoading }: { entries: PricingRuleAuditEntry[]; isLoading: boolean }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <History className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Recent pricing changes</h3>
      </div>
      {isLoading ? (
        <p className="mt-3 text-sm text-muted-foreground">Loading change history…</p>
      ) : entries.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No pricing changes recorded yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-start justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{ruleLabel(entry.ruleKey)}</span>
                  <LockedChip>{entry.ruleKey}</LockedChip>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  <span className="tabular-nums">{formatAuditValue(entry.ruleKey, entry.ruleType ?? "", entry.oldValue)}</span>
                  {" → "}
                  <span className="font-medium tabular-nums text-foreground">
                    {formatAuditValue(entry.ruleKey, entry.ruleType ?? "", entry.newValue)}
                  </span>
                  {entry.note ? <span className="italic"> · {entry.note}</span> : null}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="whitespace-nowrap text-xs text-muted-foreground">{formatStamp(entry.at)}</p>
                <p className="truncate text-[11px] text-muted-foreground">{entry.actorName}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export interface PricingRulesViewProps {
  services: CalculatorServiceConfig[];
  pricingRules: PricingRuleConfig[];
  plans: CleaningPlanConfig[];
  currency: string;
  enabled: boolean;
  /**
   * GPM-UX-ADMIN-4 — when true the view renders the (already service-scoped) rules
   * expanded inline instead of inside a collapsed service card, so the workbench's
   * Pricing section needs no extra "expand this service" click.
   */
  embedded?: boolean;
  onSaveRuleValue: (rule: PricingRuleConfig, newValue: number, note: string | null) => Promise<void>;
  /** Slice 12Q — persists the home-cleaning per-sqm adjustment ranges to settings_json. */
  onSaveSqmAdjustments?: (service: CalculatorServiceConfig, ranges: SqmAdjustmentRangeConfig[]) => Promise<void>;
  /**
   * GPM-UX-ADMIN-7 — the customer-facing add-ons editor, rendered inside the
   * unified "Add-ons" subsection (last in the Pricing section). Only meaningful
   * in embedded mode, where the view is scoped to a single selected service.
   */
  addonsSlot?: ReactNode;
}

/**
 * Pricing Rules — read-only display PLUS safe editing of EXISTING numeric values
 * (Slice 10B). Rule keys, types, pricing models and formula stay locked; editing
 * a value shows a live before/after price preview, requires explicit confirmation
 * (stronger when the calculator is live), and records the change in the
 * append-only audit trail surfaced under "Recent pricing changes".
 */
export function PricingRulesView({
  services,
  pricingRules,
  plans,
  currency,
  enabled,
  embedded = false,
  onSaveRuleValue,
  onSaveSqmAdjustments,
  addonsSlot,
}: PricingRulesViewProps) {
  const orderedServices = useMemo(
    () => [...services].sort((a, b) => a.sortOrder - b.sortOrder),
    [services],
  );

  const [editingRule, setEditingRule] = useState<PricingRuleConfig | null>(null);
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());

  const toggleOpen = useCallback((id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const editingContext = useMemo(() => {
    if (!editingRule) return null;
    const service = services.find((s) => s.id === editingRule.serviceId) ?? null;
    if (!service) return null;
    const serviceRules = pricingRules.filter((r) => r.serviceId === editingRule.serviceId);
    return { service, serviceRules };
  }, [editingRule, services, pricingRules]);

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <p>
          You can edit an <span className="font-medium">existing rule's value</span> with a live price preview and
          confirmation. Rule keys, types, the pricing model and the formula stay locked — adding or removing rules and
          creating new pricing models is not available here.
        </p>
      </div>

      {orderedServices.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
          <SlidersHorizontal className="mx-auto h-5 w-5 text-muted-foreground" />
          <p className="mt-2">No services to show pricing rules for.</p>
        </div>
      ) : embedded ? (
        // GPM-UX-ADMIN-4 — the workbench already scoped to one selected service, so
        // render its rules expanded inline (no redundant per-service expand click).
        <div className="space-y-4">
          {orderedServices.map((service) => (
            <div
              key={service.id}
              className="rounded-2xl border border-border bg-card p-4"
              data-testid={`pricing-service-${service.id}`}
            >
              <ServiceRulesBody
                service={service}
                rules={pricingRules.filter((r) => r.serviceId === service.id)}
                currency={currency}
                onEditRule={setEditingRule}
                onSaveSqmAdjustments={onSaveSqmAdjustments}
                addonsSlot={addonsSlot}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {orderedServices.map((service) => {
            const rules = pricingRules.filter((r) => r.serviceId === service.id);
            const stateTone = service.enabled ? "green" : service.comingSoon ? "amber" : "muted";
            const stateLabel = service.enabled ? "Active" : service.comingSoon ? "Coming soon" : "Hidden";
            return (
              <CollapsibleServiceCard
                key={service.id}
                open={openIds.has(service.id)}
                onOpenChange={() => toggleOpen(service.id)}
                title={service.displayName}
                subtitle={service.serviceKey}
                countLabel={`${rules.length} pricing rule${rules.length === 1 ? "" : "s"}`}
                badges={<Pill tone={stateTone}>{stateLabel}</Pill>}
              >
                <ServiceRulesBody
                  service={service}
                  rules={rules}
                  currency={currency}
                  onEditRule={setEditingRule}
                  onSaveSqmAdjustments={onSaveSqmAdjustments}
                />
              </CollapsibleServiceCard>
            );
          })}
        </div>
      )}

      {editingRule && editingContext ? (
        <PricingRuleEditDialog
          rule={editingRule}
          service={editingContext.service}
          currency={currency}
          enabled={enabled}
          open={editingRule !== null}
          onOpenChange={(open) => {
            if (!open) setEditingRule(null);
          }}
          onSave={onSaveRuleValue}
        />
      ) : null}
    </div>
  );
}

export default PricingRulesView;
