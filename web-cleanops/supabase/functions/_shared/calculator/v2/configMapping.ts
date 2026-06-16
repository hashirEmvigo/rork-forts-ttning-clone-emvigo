/**
 * ⚠️  FAITHFUL DENO MIRROR of `src/lib/calculator/v2/configMapping.ts`. Kept
 *     behaviour-identical by `src/lib/calculator/v2/parity.test.ts` (Slice V2-E1).
 *     The ONLY intentional difference vs. the canonical source is the import
 *     specifier below (explicit `.ts` extension, required by Deno). Any change to
 *     the canonical module must be mirrored here, or the parity test fails.
 *
 * Calculator V2 — canonical config mapper (Slice V2-CFG).
 *
 * Pure normalization from existing Admin/DB-style rows (`calculator_services`,
 * `cleaning_plans`, `pricing_rules`) into ONE {@link CalculatorServiceConfigV2}
 * that the shared engine (Slice V2-B) and the display-pricing layer (Slice V2-C)
 * consume. This is the boundary that turns the messy multi-location legacy config
 * into the single predictable shape the rest of V2 relies on.
 *
 * Scope + isolation (per the approved Slice V2-CFG constraints):
 *   • PURE: no Supabase client, no React, no Edge Function, no runtime wiring.
 *     Callers load the rows however they like (loader/hook/function) and hand the
 *     grouped rows for ONE service here. Nothing here is wired into the public
 *     calculator, Admin UI, or the Deno function, and no schema/migration is
 *     implied by this slice.
 *
 * Source-of-truth decisions encoded here (the headline fixes from the audit):
 *   • Public display rounding comes from
 *     `calculator_services.settings_json.displayRoundingInterval` — NEVER from an
 *     active-gated `pricing_rules.rounding_increment`. If a rounding_increment
 *     rule exists it is deliberately ignored, and a `rounding_rule_ignored`
 *     warning is emitted so the Admin-vs-calculator drift the audit flagged is
 *     visible instead of silent.
 *   • Plans are the pricing source of truth (from `cleaning_plans`). The legacy
 *     "plans enabled" flag, global "plan model", global "recommended default plan"
 *     dropdown, and global "base hourly price excl VAT" are NOT mapped into V2.
 *     A service's pricing comes from its plan cards alone.
 *   • The `hours_per_sqm` rule is STORED in hours per m² but the Admin edits it as
 *     MINUTES per m²; V2 normalizes to the canonical {@link SqmTimeConfigV2.baseMinutesPerSqm}
 *     (= hours_per_sqm × 60), so 0.04 h/m² → 2.4 min/m². Start/minimum time map the
 *     same way (× 60), tolerating both the home (`base_hours`/`minimum_hours`) and
 *     office (`base_visit_hours`/`minimum_hours_per_visit`) legacy rule spellings.
 *   • VAT/RUT are resolved at the service level with DEFAULT-PLAN-WINS precedence.
 *     When active plans disagree the mapper warns (never silently averages).
 *
 * Gaps deliberately surfaced as issues rather than guessed:
 *   • `deep_cleaning` (Storstädning) exists as a hidden-draft service identity but
 *     has no pricing rules/plans and an engine-unsupported pricing_model, so its
 *     mapped config is flagged structurally incomplete (no `sqmTime`, no plan).
 *   • Office per-fixture extras (toilets/workstations/meeting rooms/kitchen) have
 *     no slot in the V2 `sqmTime` model yet; only base/per-m²/minimum time is
 *     mapped here. Modelling those extras is a later slice (V2-F).
 */

import type {
  BookingModeV2,
  CalculatorPlanV2,
  CalculatorServiceConfigV2,
  PlanKindV2,
  PriceRangeMarginsV2,
  PricingBasisV2,
  PublicLayoutV2,
  RutConfigV2,
  SqmAdjustmentRangeV2,
  SqmTimeConfigV2,
  VatConfigV2,
  VatDisplayMode,
} from "./types.ts";
import {
  pricingBasisForGenericModel,
  resolveGenericPricingModel,
  type GenericPricingModel,
} from "./pricingModel.ts";

// ── Input row shapes (snake_case, as loaded from Supabase; tolerant supersets) ──

/**
 * A `calculator_services` row. `settings_json` is the canonical home for the V2
 * presentation + display-rounding fields (`displayRoundingInterval`,
 * `bookingMode`, `publicLayout`, optional `vat`/`rut` toggles, `homeSqmAdjustments`).
 */
export interface ServiceRowV2 {
  service_key: string;
  display_name?: string | null;
  enabled?: boolean | null;
  pricing_model?: string | null;
  settings_json?: unknown;
}

/**
 * A `cleaning_plans` row. Carries both legacy columns (`hourly_rate`,
 * `vat_rate_percent`, `rut_*`) and the forward V2 plan columns
 * (`start_adjustment_hours`, `price_per_sqm_excl_vat`, `fixed_adjustment_excl_vat`,
 * `minimum_price_excl_vat`). A plan is treated as active unless `active === false`.
 *
 * NOTE: the forward V2 columns now exist on the live `cleaning_plans` table
 * (migration 0073, Slice V2-D0) and the Admin read/write path maps them (Slice
 * V2-D). Office/deep per-plan authoring is still pending in Admin, but this pure
 * mapper already normalizes the clean contract; it changes no schema itself.
 */
export interface PlanRowV2 {
  plan_key: string;
  name?: string | null;
  description?: string | null;
  active?: boolean | null;
  is_default?: boolean | null;
  sort_order?: number | null;
  /** hourly basis: price per hour excl VAT. */
  hourly_rate?: number | string | null;
  /** hourly basis: start-time price adjustment in hours (price-only; may be negative). */
  start_adjustment_hours?: number | string | null;
  /** sqm_fixed basis: price per m² excl VAT. */
  price_per_sqm_excl_vat?: number | string | null;
  /** any basis: optional fixed amount excl VAT added to the raw price. */
  fixed_adjustment_excl_vat?: number | string | null;
  /** any basis: optional minimum raw price (excl VAT) floor. */
  minimum_price_excl_vat?: number | string | null;
  /** VAT/RUT resolved at service level with default-plan-wins precedence. */
  vat_rate_percent?: number | string | null;
  rut_eligible?: boolean | null;
  rut_enabled?: boolean | null;
  rut_percent?: number | string | null;
}

/**
 * A `pricing_rules` row. Used ONLY for m² time settings (base/per-m²/minimum) and
 * range margins (`range_min_percent`/`range_max_percent`). It is NEVER the source
 * of public display rounding — `rounding_increment` rows are deliberately ignored.
 * A rule is treated as active unless `active === false`.
 */
export interface PricingRuleRowV2 {
  rule_key: string;
  value_numeric?: number | string | null;
  active?: boolean | null;
}

/** Central fallbacks (e.g. company `calculator_settings`) used when plans omit a value. */
export interface ConfigMappingDefaults {
  /** VAT fallback when the default plan has no rate. Defaults to 25. */
  defaultVatRatePercent?: number;
  /** ISO currency code. Defaults to SEK. */
  currency?: string;
}

/** Grouped rows for ONE service, as loaded by the caller. */
export interface BuildServiceConfigInputV2 {
  service: ServiceRowV2;
  plans?: readonly PlanRowV2[];
  pricingRules?: readonly PricingRuleRowV2[];
  defaults?: ConfigMappingDefaults;
}

// ── Output ──────────────────────────────────────────────────────────────────

export type ConfigMappingSeverity = "warning" | "error";

/**
 * A normalization note. `error` means the mapped config is not yet usable for a
 * real customer price (e.g. an enabled service with no active plan, or an hourly
 * service with no m² time rules). `warning` means the mapping succeeded but a
 * human should look (e.g. plans disagree on VAT, or an ignored rounding rule).
 */
export interface ConfigMappingIssue {
  code: string;
  message: string;
  severity: ConfigMappingSeverity;
  field?: string;
}

/** The mapper result: the canonical config plus any normalization issues. */
export interface BuildServiceConfigResultV2 {
  config: CalculatorServiceConfigV2;
  issues: ConfigMappingIssue[];
}

// ── Static vocabularies ──────────────────────────────────────────────────────

/**
 * Legacy-safety net (GPM-1): service keys that priced by fixed m² rate before the
 * generic pricing model drove the basis. This ONLY fills in for pre-GPM-1 rows
 * whose `pricing_model` does not resolve to a supported generic model; it never
 * overrides a model that already resolves to a basis. The primary, intended
 * selector is the generic pricing model (see {@link resolvePricingBasis}).
 */
const SQM_FIXED_LEGACY_SERVICE_KEYS: ReadonlySet<string> = new Set(["move_out_cleaning"]);

interface PresentationDefault {
  bookingMode: BookingModeV2;
  publicLayout: PublicLayoutV2;
}

/**
 * Per-service-key booking/layout defaults, used when `settings_json` does not
 * specify them. These are the documented backfills for this slice (the preferred
 * future source is `settings_json.bookingMode` / `settings_json.publicLayout`).
 */
const PRESENTATION_BY_SERVICE_KEY: Readonly<Record<string, PresentationDefault>> = {
  home_cleaning: { bookingMode: "recurring", publicLayout: "recurring_cleaning" },
  office_cleaning: { bookingMode: "recurring", publicLayout: "recurring_cleaning" },
  deep_cleaning: { bookingMode: "one_off", publicLayout: "one_off_cleaning" },
  move_out_cleaning: { bookingMode: "one_off", publicLayout: "move_out_cleaning" },
};

const FALLBACK_PRESENTATION: PresentationDefault = {
  bookingMode: "recurring",
  publicLayout: "recurring_cleaning",
};

const BOOKING_MODES: readonly BookingModeV2[] = ["recurring", "one_off"];
const PUBLIC_LAYOUTS: readonly PublicLayoutV2[] = [
  "recurring_cleaning",
  "one_off_cleaning",
  "move_out_cleaning",
];

/** Legacy rule-key spellings for the start time component (home vs office). */
const START_TIME_RULE_KEYS: readonly string[] = ["base_hours", "base_visit_hours"];
/** Legacy rule-key spelling for the per-m² time component (shared). */
const PER_SQM_TIME_RULE_KEYS: readonly string[] = ["hours_per_sqm"];
/** Legacy rule-key spellings for the minimum visit time (home vs office). */
const MINIMUM_TIME_RULE_KEYS: readonly string[] = ["minimum_hours", "minimum_hours_per_visit"];
const ALL_TIME_RULE_KEYS: readonly string[] = [
  ...START_TIME_RULE_KEYS,
  ...PER_SQM_TIME_RULE_KEYS,
  ...MINIMUM_TIME_RULE_KEYS,
];

const DEFAULT_VAT_RATE_PERCENT = 25;
const DEFAULT_RUT_PERCENT = 50;
const DEFAULT_CURRENCY = "SEK";

// ── Coercion helpers (loosely-typed rows arrive from JSON/Postgres) ──────────

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function numberOrDefault(value: unknown, fallback: number): number {
  const n = numberOrNull(value);
  return n === null ? fallback : n;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}

/** Rounds to 2 decimals to tame float noise (e.g. 0.04 × 60 → 2.4). */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** A row counts as active unless it is explicitly `active === false`. */
function isActive(active: boolean | null | undefined): boolean {
  return active !== false;
}

function bookingModeOrNull(value: unknown): BookingModeV2 | null {
  return typeof value === "string" && (BOOKING_MODES as readonly string[]).includes(value)
    ? (value as BookingModeV2)
    : null;
}

function publicLayoutOrNull(value: unknown): PublicLayoutV2 | null {
  return typeof value === "string" && (PUBLIC_LAYOUTS as readonly string[]).includes(value)
    ? (value as PublicLayoutV2)
    : null;
}

function vatDisplayModeOr(value: unknown, fallback: VatDisplayMode): VatDisplayMode {
  return value === "incl" || value === "excl" ? value : fallback;
}

// ── Pricing-rule index (active-only) ─────────────────────────────────────────

/**
 * Indexes the ACTIVE pricing rules by key (last finite value wins). Mirrors how
 * the live function loads active rules. Display rounding is intentionally NOT
 * sourced from here — see the module header.
 *
 * NOTE: margins are read from this active index, so an inactive
 * `range_*_percent` rule is ignored the same way the legacy runtime ignores it.
 * That is the same active-gating shape as the rounding bug and is flagged in the
 * Slice report as a future risk; per the slice constraints it is not "solved"
 * here (no UI/runtime/schema change), only documented.
 */
function indexActiveRules(rules: readonly PricingRuleRowV2[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of rules) {
    if (!r || typeof r.rule_key !== "string" || !isActive(r.active)) continue;
    const value = numberOrNull(r.value_numeric);
    if (value !== null) map.set(r.rule_key, value);
  }
  return map;
}

/** First present key's value from an index, else `fallback`. */
function ruleValueAny(index: Map<string, number>, keys: readonly string[], fallback: number): number {
  for (const key of keys) {
    const v = index.get(key);
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return fallback;
}

function hasAnyRule(index: Map<string, number>, keys: readonly string[]): boolean {
  return keys.some((key) => index.has(key));
}

// ── sqmAdjustments parser (settings_json.homeSqmAdjustments → V2 ranges) ─────

/**
 * Parses a loosely-typed `homeSqmAdjustments` blob into clean, sorted V2 ranges.
 * Drops malformed rows; tolerates missing/legacy data (empty = no adjustment).
 * `toSqm` may be null (open-ended top range). Kept local so the V2 folder stays
 * self-contained (no import from the Supabase-bound admin module).
 */
function parseSqmAdjustmentsV2(raw: unknown): SqmAdjustmentRangeV2[] {
  if (!Array.isArray(raw)) return [];
  const out: SqmAdjustmentRangeV2[] = [];
  for (const item of raw) {
    const obj = asRecord(item);
    const fromSqm = numberOrNull(obj.fromSqm);
    const adjustmentPercent = numberOrNull(obj.adjustmentPercent);
    if (fromSqm === null || fromSqm < 0 || adjustmentPercent === null) continue;
    const toSqm = numberOrNull(obj.toSqm);
    if (toSqm !== null && toSqm < fromSqm) continue;
    out.push({ fromSqm, toSqm, adjustmentPercent });
  }
  return out.sort((a, b) => a.fromSqm - b.fromSqm);
}

// ── Sub-resolvers ─────────────────────────────────────────────────────────────

/** Pricing-basis resolution result (GPM-1): basis + the generic model + engine support. */
interface ResolvedPricingBasisV2 {
  basis: PricingBasisV2;
  genericModel: GenericPricingModel;
  /** True when the V2 engine implements the resolved generic model (hourly_by_area / sqm_fixed). */
  engineSupported: boolean;
}

/**
 * Resolves the pricing basis from the GENERIC pricing model (GPM-1), normalized
 * from the service's stored `pricing_model` — NOT from `serviceKey`. A supported
 * generic model maps straight to its basis. An engine-unsupported generic model
 * (unit_based / fixed_package / manual_quote) is reported with
 * `engineSupported: false` so the mapper flags it instead of silently pricing it
 * as hourly; `serviceKey` only survives as a reduced legacy-safety net
 * ({@link SQM_FIXED_LEGACY_SERVICE_KEYS}) for old rows whose model does not resolve.
 */
function resolvePricingBasis(service: ServiceRowV2): ResolvedPricingBasisV2 {
  const genericModel = resolveGenericPricingModel(service.pricing_model);
  const basisFromModel = pricingBasisForGenericModel(genericModel);
  if (basisFromModel !== null) {
    return { basis: basisFromModel, genericModel, engineSupported: true };
  }
  if (SQM_FIXED_LEGACY_SERVICE_KEYS.has(service.service_key)) {
    return { basis: "sqm_fixed", genericModel, engineSupported: true };
  }
  return { basis: "hourly", genericModel, engineSupported: false };
}

/** Booking/layout come from settings_json when valid, else the per-key default. */
function resolvePresentation(service: ServiceRowV2, settings: Record<string, unknown>): PresentationDefault {
  const fallback = PRESENTATION_BY_SERVICE_KEY[service.service_key] ?? FALLBACK_PRESENTATION;
  return {
    bookingMode: bookingModeOrNull(settings.bookingMode) ?? fallback.bookingMode,
    publicLayout: publicLayoutOrNull(settings.publicLayout) ?? fallback.publicLayout,
  };
}

/**
 * Builds the m² time config for the hourly basis from active rules, normalizing
 * the hours-stored rule values into V2 canonical MINUTES (× 60). Returns null
 * (plus an emitted issue via the caller) when no time rules exist at all — that
 * is the structural gap for an unconfigured hourly service like deep_cleaning.
 */
function resolveSqmTime(index: Map<string, number>): SqmTimeConfigV2 | null {
  if (!hasAnyRule(index, ALL_TIME_RULE_KEYS)) return null;
  return {
    baseMinutesPerSqm: round2(ruleValueAny(index, PER_SQM_TIME_RULE_KEYS, 0) * 60),
    startMinutes: round2(ruleValueAny(index, START_TIME_RULE_KEYS, 0) * 60),
    minimumMinutes: round2(ruleValueAny(index, MINIMUM_TIME_RULE_KEYS, 0) * 60),
  };
}

/** Margins map straight from the active range_*_percent rules (missing → 0). */
function resolveMargins(index: Map<string, number>): PriceRangeMarginsV2 {
  return {
    lowerPercent: ruleValueAny(index, ["range_min_percent"], 0),
    upperPercent: ruleValueAny(index, ["range_max_percent"], 0),
  };
}

/** Maps one plan row into a V2 plan, stamping `kind` from the service basis. */
function mapPlanV2(row: PlanRowV2, basis: PricingBasisV2): CalculatorPlanV2 {
  const kind: PlanKindV2 = basis;
  return {
    planKey: row.plan_key,
    label: stringOr(row.name, row.plan_key),
    description: typeof row.description === "string" ? row.description : null,
    active: isActive(row.active),
    isDefault: row.is_default === true,
    sortOrder: numberOrDefault(row.sort_order, 0),
    kind,
    hourlyRateExclVat: basis === "hourly" ? numberOrNull(row.hourly_rate) : null,
    startAdjustmentHours: basis === "hourly" ? numberOrDefault(row.start_adjustment_hours, 0) : null,
    pricePerSqmExclVat: basis === "sqm_fixed" ? numberOrNull(row.price_per_sqm_excl_vat) : null,
    fixedAdjustmentExclVat: numberOrNull(row.fixed_adjustment_excl_vat),
    minimumPriceExclVat: numberOrNull(row.minimum_price_excl_vat),
  };
}

/** Active plan rows, with the default-plan resolution (explicit default → first). */
function resolveActivePlanRows(plans: readonly PlanRowV2[]): {
  activeRows: PlanRowV2[];
  defaultRow: PlanRowV2 | null;
} {
  const activeRows = plans.filter((p) => isActive(p.active));
  const defaultRow = activeRows.find((p) => p.is_default === true) ?? activeRows[0] ?? null;
  return { activeRows, defaultRow };
}

// ── Main mapper ───────────────────────────────────────────────────────────────

/**
 * Normalizes the loaded Admin/DB-style rows for ONE service into a canonical
 * {@link CalculatorServiceConfigV2}, plus the normalization {@link ConfigMappingIssue}s.
 * Pure and deterministic — no I/O, no throwing: an unconfigured service maps to a
 * structurally-complete config carrying `error` issues so callers can decide what
 * to do (this slice does not consume the result anywhere).
 */
export function buildServiceConfigV2(input: BuildServiceConfigInputV2): BuildServiceConfigResultV2 {
  const { service } = input;
  const planRows = input.plans ?? [];
  const ruleRows = input.pricingRules ?? [];
  const defaults = input.defaults ?? {};
  const issues: ConfigMappingIssue[] = [];

  const settings = asRecord(service.settings_json);
  const enabled = service.enabled === true;
  const { basis: pricingBasis, genericModel, engineSupported } = resolvePricingBasis(service);
  const presentation = resolvePresentation(service, settings);
  const ruleIndex = indexActiveRules(ruleRows);

  // GPM-1: an engine-unsupported generic model must never silently auto-price as
  // hourly. Flag it explicitly; downstream it builds no time config and the engine
  // refuses to price it.
  if (!engineSupported) {
    issues.push({
      code: "unsupported_pricing_model",
      severity: "error",
      field: "pricingBasis",
      message:
        `Service "${service.service_key}" resolves to generic pricing model "${genericModel}", ` +
        `which the V2 engine does not implement yet; it cannot auto-price and must stay on the ` +
        `legacy path or manual review.`,
    });
  }

  // Display rounding — settings_json ONLY (never an active-gated pricing rule).
  const settingsInterval = numberOrNull(settings.displayRoundingInterval);
  const displayRoundingInterval = settingsInterval !== null && settingsInterval > 0 ? settingsInterval : null;
  flagIgnoredRoundingRule(ruleRows, displayRoundingInterval, issues);

  // m² time + margins from active rules. Only an engine-supported hourly model
  // builds a time config — an unsupported model is already flagged above and must
  // not silently produce an hourly time estimate.
  const sqmTime = pricingBasis === "hourly" && engineSupported ? resolveSqmTime(ruleIndex) : null;
  if (pricingBasis === "hourly" && engineSupported && sqmTime === null) {
    issues.push({
      code: "missing_sqm_time_config",
      severity: "error",
      field: "sqmTime",
      message: `Service "${service.service_key}" has no m² time rules (base/per-m²/minimum); it cannot price hourly yet.`,
    });
  }
  const margins = resolveMargins(ruleIndex);
  const sqmAdjustments = parseSqmAdjustmentsV2(settings.homeSqmAdjustments);

  // Plans — the pricing source of truth. Keep all (active + inactive), sorted.
  const plans = planRows
    .map((row) => mapPlanV2(row, pricingBasis))
    .sort((a, b) => (a.sortOrder !== b.sortOrder ? a.sortOrder - b.sortOrder : a.planKey.localeCompare(b.planKey)));
  const { activeRows, defaultRow } = resolveActivePlanRows(planRows);

  if (activeRows.length === 0) {
    issues.push({
      code: "no_active_plan",
      severity: enabled ? "error" : "warning",
      field: "plans",
      message: enabled
        ? `Enabled service "${service.service_key}" has no active plan; at least one active plan is required.`
        : `Service "${service.service_key}" has no active plan (it is disabled, so this is informational).`,
    });
  }
  flagPlanPricingGaps(plans, pricingBasis, issues);

  // VAT/RUT — service-level, default-plan-wins, warn on disagreement.
  const vat = resolveVat(activeRows, defaultRow, settings, defaults, issues);
  const rut = resolveRut(activeRows, defaultRow, settings, issues);

  const config: CalculatorServiceConfigV2 = {
    serviceKey: service.service_key,
    displayName: stringOr(service.display_name, service.service_key),
    enabled,
    pricingBasis,
    bookingMode: presentation.bookingMode,
    publicLayout: presentation.publicLayout,
    vat,
    rut,
    margins,
    displayRoundingInterval,
    sqmTime,
    sqmAdjustments,
    plans,
    // Generic add-ons (Slice V2-E0D): the canonical config carries an explicit empty
    // list until a later slice loads authored `calculator_addons` rows. This mapper
    // does NOT read that table yet, and V2 never maps legacy special add-on rules.
    addons: [],
    currency: stringOr(defaults.currency, DEFAULT_CURRENCY),
  };

  return { config, issues };
}

// ── Issue-emitting resolvers (kept after the main fn for readability) ────────

/**
 * Emits a `rounding_rule_ignored` warning when a positive `rounding_increment`
 * pricing rule exists but differs from the resolved settings_json interval — the
 * exact Admin-vs-calculator drift the audit flagged. The rule is examined
 * regardless of its active flag (the admin can see it either way).
 */
function flagIgnoredRoundingRule(
  rules: readonly PricingRuleRowV2[],
  resolvedInterval: number | null,
  issues: ConfigMappingIssue[],
): void {
  const roundingRule = rules.find((r) => r?.rule_key === "rounding_increment");
  const ruleValue = numberOrNull(roundingRule?.value_numeric);
  if (ruleValue !== null && ruleValue > 0 && ruleValue !== resolvedInterval) {
    issues.push({
      code: "rounding_rule_ignored",
      severity: "warning",
      field: "displayRoundingInterval",
      message:
        `A pricing_rules.rounding_increment of ${ruleValue} exists but is ignored; ` +
        `V2 public display rounding uses settings_json.displayRoundingInterval ` +
        `(${resolvedInterval ?? "nearest whole SEK"}).`,
    });
  }
}

/** Warns when an active plan lacks the price field its basis needs. */
function flagPlanPricingGaps(
  plans: readonly CalculatorPlanV2[],
  basis: PricingBasisV2,
  issues: ConfigMappingIssue[],
): void {
  for (const plan of plans) {
    if (!plan.active) continue;
    if (basis === "hourly" && !(typeof plan.hourlyRateExclVat === "number" && plan.hourlyRateExclVat > 0)) {
      issues.push({
        code: "plan_missing_hourly_rate",
        severity: "warning",
        field: "plans",
        message: `Active hourly plan "${plan.planKey}" has no positive hourly rate.`,
      });
    }
    if (basis === "sqm_fixed" && !(typeof plan.pricePerSqmExclVat === "number" && plan.pricePerSqmExclVat > 0)) {
      issues.push({
        code: "plan_missing_price_per_sqm",
        severity: "warning",
        field: "plans",
        message: `Active sqm_fixed plan "${plan.planKey}" has no positive price per m².`,
      });
    }
  }
}

/**
 * Resolves service-level VAT with default-plan-wins precedence. Emits
 * `vat_mismatch_between_plans` when active plans carry differing VAT rates (never
 * silently averages). Toggle/default mode come from `settings_json.vat` (a V2
 * presentation field) with safe defaults (no toggle, incl-VAT shown first).
 */
function resolveVat(
  activeRows: readonly PlanRowV2[],
  defaultRow: PlanRowV2 | null,
  settings: Record<string, unknown>,
  defaults: ConfigMappingDefaults,
  issues: ConfigMappingIssue[],
): VatConfigV2 {
  const distinctRates = new Set(
    activeRows.map((p) => numberOrNull(p.vat_rate_percent)).filter((v): v is number => v !== null),
  );
  if (distinctRates.size > 1) {
    issues.push({
      code: "vat_mismatch_between_plans",
      severity: "warning",
      field: "vat",
      message: `Active plans disagree on VAT rate (${[...distinctRates].join(", ")}); using the default plan's value.`,
    });
  }

  const ratePercent =
    numberOrNull(defaultRow?.vat_rate_percent) ??
    (typeof defaults.defaultVatRatePercent === "number" ? defaults.defaultVatRatePercent : DEFAULT_VAT_RATE_PERCENT);

  const vatSettings = asRecord(settings.vat);
  return {
    ratePercent,
    customerToggle: vatSettings.customerToggle === true,
    defaultMode: vatDisplayModeOr(vatSettings.defaultMode, "incl"),
  };
}

/**
 * Resolves service-level RUT with default-plan-wins precedence. Emits
 * `rut_mismatch_between_plans` when active plans disagree on eligibility or
 * percent. `customerToggle` comes from `settings_json.rut.customerToggle`, else
 * defaults to whether the service is eligible.
 */
function resolveRut(
  activeRows: readonly PlanRowV2[],
  defaultRow: PlanRowV2 | null,
  settings: Record<string, unknown>,
  issues: ConfigMappingIssue[],
): RutConfigV2 {
  const distinctEligible = new Set(activeRows.map((p) => p.rut_eligible === true));
  const distinctPercent = new Set(
    activeRows.map((p) => numberOrNull(p.rut_percent)).filter((v): v is number => v !== null),
  );
  if (distinctEligible.size > 1 || distinctPercent.size > 1) {
    issues.push({
      code: "rut_mismatch_between_plans",
      severity: "warning",
      field: "rut",
      message: "Active plans disagree on RUT eligibility/percent; using the default plan's value.",
    });
  }

  const eligible = defaultRow?.rut_eligible === true;
  const rutSettings = asRecord(settings.rut);
  return {
    eligible,
    enabledByDefault: defaultRow?.rut_enabled === true,
    percent: numberOrNull(defaultRow?.rut_percent) ?? DEFAULT_RUT_PERCENT,
    customerToggle: typeof rutSettings.customerToggle === "boolean" ? rutSettings.customerToggle : eligible,
  };
}
