/**
 * Price Calculator — Library item TYPES + pure row→view mappers
 * (GPM-CALC-LIBRARY-2A, migration 0077).
 *
 * Reusable, company-scoped DEFAULTS for calculator questions and add-ons. These
 * library items are NOT the public read model and NOT service-scoped: activating
 * a library item (a LATER ticket) copies its defaults onto a service-scoped
 * `calculator_questions` / `calculator_addons` row and stamps that row's
 * `library_item_id`. A service row with `library_item_id = null` is a plain
 * custom row and keeps behaving exactly as before.
 *
 * SCOPE OF THIS MODULE (Ticket 1 — schema foundation):
 *   • Row shapes (snake_case) mirroring the 0077 tables.
 *   • App-facing camelCase views.
 *   • PURE mappers (no I/O) — independently unit-tested.
 * Supabase read/write ADAPTERS are added in a later ticket (GPM-CALC-LIBRARY-2B);
 * this file intentionally imports no client so it stays pure and dependency-light.
 */
import type { CalculatorAddonInputType, QuestionOption } from "./calculatorConfigAdmin";

// ── Raw DB row shapes (snake_case, mirror migration 0077) ───────────────────

/** A `calculator_question_library_items` row as returned by Supabase. */
export interface QuestionLibraryItemRow {
  id: string;
  legacy_id: string;
  company_id: string;
  company_legacy_id: string;
  question_key: string;
  label: string;
  help_text: string | null;
  input_type: string;
  default_required: boolean;
  default_affects_pricing: boolean;
  default_options_json: unknown;
  default_validation_json: unknown;
  default_sort_order: number;
  description: string | null;
  active: boolean;
}

/** A `calculator_addon_library_items` row as returned by Supabase. */
export interface AddonLibraryItemRow {
  id: string;
  legacy_id: string;
  company_id: string;
  company_legacy_id: string;
  addon_key: string;
  name: string;
  public_label: string;
  description: string | null;
  input_type: string;
  boolean_default: boolean;
  quantity_min: number | string;
  quantity_max: number | string | null;
  quantity_step: number | string;
  quantity_default: number | string;
  effect_time_minutes: number | string;
  effect_fixed_excl_vat: number | string;
  effect_percent: number | string;
  default_sort_order: number;
  active: boolean;
}

// ── App-facing views (camelCase) ────────────────────────────────────────────

/**
 * Editor view of a reusable question library item. `id` is the uuid that an
 * activated `calculator_questions` row stores in `library_item_id`; `legacyId`
 * is the stable idempotent upsert key.
 */
export interface QuestionLibraryItem {
  id: string;
  legacyId: string;
  companyId: string;
  companyLegacyId: string;
  questionKey: string;
  label: string;
  helpText: string | null;
  inputType: string;
  defaultRequired: boolean;
  defaultAffectsPricing: boolean;
  defaultOptions: QuestionOption[];
  defaultValidation: Record<string, unknown>;
  defaultSortOrder: number;
  description: string | null;
  active: boolean;
}

/**
 * Editor view of a reusable add-on library item. `id` is the uuid that an
 * activated `calculator_addons` row stores in `library_item_id`. Effects mirror
 * the three explicit channels of `calculator_addons` (time / fixed / percent).
 */
export interface AddonLibraryItem {
  id: string;
  legacyId: string;
  companyId: string;
  companyLegacyId: string;
  addonKey: string;
  name: string;
  publicLabel: string;
  description: string | null;
  inputType: CalculatorAddonInputType;
  booleanDefault: boolean;
  quantityMin: number;
  quantityMax: number | null;
  quantityStep: number;
  quantityDefault: number;
  effectTimeMinutes: number;
  effectFixedExclVat: number;
  effectPercent: number;
  defaultSortOrder: number;
  active: boolean;
}

// ── Pure coercion helpers (no I/O; self-contained so the module stays pure) ──

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

/** Parses a loosely-typed options blob into a clean `{value,label}[]` (mirrors parseQuestionOptions). */
function parseLibraryOptions(raw: unknown): QuestionOption[] {
  if (!Array.isArray(raw)) return [];
  const out: QuestionOption[] = [];
  for (const item of raw) {
    const obj = asRecord(item);
    const value = typeof obj.value === "string" ? obj.value : null;
    if (value === null || value === "") continue;
    const label = typeof obj.label === "string" && obj.label.trim() !== "" ? obj.label : value;
    out.push({ value, label });
  }
  return out;
}

/** Coerces a raw add-on input type to a supported value (defaults to boolean). */
function addonInputTypeOrDefault(value: unknown): CalculatorAddonInputType {
  return value === "quantity" ? "quantity" : "boolean";
}

// ── Pure row → view mappers ─────────────────────────────────────────────────

/** Maps a `calculator_question_library_items` row to its editor view. */
export function mapQuestionLibraryItemRow(row: QuestionLibraryItemRow): QuestionLibraryItem {
  return {
    id: row.id,
    legacyId: row.legacy_id,
    companyId: row.company_id,
    companyLegacyId: row.company_legacy_id,
    questionKey: row.question_key,
    label: row.label,
    helpText: row.help_text ?? null,
    inputType: row.input_type,
    defaultRequired: row.default_required === true,
    defaultAffectsPricing: row.default_affects_pricing === true,
    defaultOptions: parseLibraryOptions(row.default_options_json),
    defaultValidation: asRecord(row.default_validation_json),
    defaultSortOrder: row.default_sort_order ?? 0,
    description: row.description ?? null,
    active: row.active === true,
  };
}

/** Maps a `calculator_addon_library_items` row to its editor view. */
export function mapAddonLibraryItemRow(row: AddonLibraryItemRow): AddonLibraryItem {
  return {
    id: row.id,
    legacyId: row.legacy_id,
    companyId: row.company_id,
    companyLegacyId: row.company_legacy_id,
    addonKey: row.addon_key,
    name: row.name,
    publicLabel: row.public_label,
    description: row.description ?? null,
    inputType: addonInputTypeOrDefault(row.input_type),
    booleanDefault: row.boolean_default === true,
    quantityMin: numberOrDefault(row.quantity_min, 0),
    quantityMax: numberOrNull(row.quantity_max),
    quantityStep: numberOrDefault(row.quantity_step, 1),
    quantityDefault: numberOrDefault(row.quantity_default, 0),
    effectTimeMinutes: numberOrDefault(row.effect_time_minutes, 0),
    effectFixedExclVat: numberOrDefault(row.effect_fixed_excl_vat, 0),
    effectPercent: numberOrDefault(row.effect_percent, 0),
    defaultSortOrder: row.default_sort_order ?? 0,
    active: row.active === true,
  };
}
