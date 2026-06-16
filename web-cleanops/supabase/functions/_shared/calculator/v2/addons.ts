/**
 * ⚠️  FAITHFUL DENO MIRROR of `src/lib/calculator/v2/addons.ts`. Kept
 *     behaviour-identical by `src/lib/calculator/v2/parity.test.ts` (Slice V2-E1).
 *     The ONLY intentional difference vs. the canonical source is the import
 *     specifier below (explicit `.ts` extension, required by Deno). Any change to
 *     the canonical module must be mirrored here, or the parity test fails.
 *
 * Calculator V2 — pure generic add-on resolver (Slice V2-E0D).
 *
 * Turns Admin-authored {@link CalculatorAddonConfigV2} definitions plus the
 * customer's {@link AddonSelectionsV2} answers into the aggregated
 * {@link ResolvedAddonEffectsV2} the shared engine consumes. This is the V2
 * replacement for the legacy hardcoded special add-on rules (pet/oven/bathroom/…):
 * V2 NEVER reads those legacy rules — add-on effects come only from this generic,
 * data-driven resolver.
 *
 * Hard boundaries (per the approved Generic Add-on Engine design):
 *   • PURE: no DB, no React, no Edge Function, no I/O. Callers load add-on rows and
 *     hand them here; nothing is wired into the public/Admin runtime by this slice.
 *   • Three independent effect channels are aggregated separately and never mixed:
 *       - `addonMinutes`    — real SERVICE time (the engine adds it to the visible
 *                             time estimate AND, for hourly services, the price).
 *       - `addonFixedExclVat` — flat excl-VAT amount (may be negative = discount).
 *       - `addonPercent`    — NET additive percent, applied ONCE by the engine
 *                             (e.g. +15 and −10 → +5), never compounded.
 *   • Selection → multiplier: boolean → 0/1 (missing/invalid → `booleanDefault`);
 *     quantity → the requested number clamped to [min, max], snapped to step, and
 *     never negative (missing/invalid → `quantityDefault`).
 *   • Only `active` add-ons contribute. `publicVisible` does NOT gate the math, so
 *     an internally-applied non-public add-on still affects the price.
 */

import type {
  AddonSelectionsV2,
  AddonSelectionValueV2,
  CalculatorAddonConfigV2,
  ResolvedAddonEffectLineV2,
  ResolvedAddonEffectsV2,
} from "./types.ts";

/** Rounds to 2 decimals to tame float noise (e.g. 0.1 + 0.2). NOT display rounding. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Reads a finite number or falls back to 0 (fail-safe for optional config fields). */
function num(value: number | null | undefined): number {
  return Number.isFinite(value) ? (value as number) : 0;
}

/**
 * Resolves a boolean add-on to a 0/1 multiplier. A strict boolean answer wins;
 * anything else (missing answer, or a non-boolean value from bad client data)
 * falls back safely to the configured `booleanDefault`.
 */
function resolveBooleanMultiplier(
  addon: CalculatorAddonConfigV2,
  raw: AddonSelectionValueV2 | undefined,
): number {
  if (typeof raw === "boolean") return raw ? 1 : 0;
  return addon.booleanDefault ? 1 : 0;
}

/**
 * Resolves a quantity add-on to a non-negative multiplier: parse → clamp to
 * [min, max] → snap to the nearest step (relative to min) → re-clamp. A missing or
 * non-numeric answer falls back to `quantityDefault`. `min` is floored at 0 and a
 * non-positive step is treated as 1, so a malformed config can never produce a
 * negative or NaN multiplier.
 */
function resolveQuantityMultiplier(
  addon: CalculatorAddonConfigV2,
  raw: AddonSelectionValueV2 | undefined,
): number {
  const min = Math.max(0, num(addon.quantityMin));
  const max =
    addon.quantityMax === null ||
    addon.quantityMax === undefined ||
    !Number.isFinite(addon.quantityMax)
      ? null
      : Math.max(min, addon.quantityMax as number);
  const step =
    Number.isFinite(addon.quantityStep) && (addon.quantityStep as number) > 0
      ? (addon.quantityStep as number)
      : 1;

  const requested =
    typeof raw === "number" && Number.isFinite(raw) ? raw : num(addon.quantityDefault);

  let value = Math.max(min, requested);
  if (max !== null) value = Math.min(max, value);

  const snapped = min + Math.round((value - min) / step) * step;
  let normalized = Math.max(min, snapped);
  if (max !== null) normalized = Math.min(max, normalized);

  return round2(Math.max(0, normalized));
}

/** Dispatches to the boolean or quantity multiplier based on the add-on input type. */
function resolveMultiplier(
  addon: CalculatorAddonConfigV2,
  raw: AddonSelectionValueV2 | undefined,
): number {
  return addon.inputType === "boolean"
    ? resolveBooleanMultiplier(addon, raw)
    : resolveQuantityMultiplier(addon, raw);
}

/**
 * Resolves customer add-on selections into the aggregated effects the engine
 * consumes. Pure + deterministic, never throws: unknown selection keys, inactive
 * add-ons, zero multipliers, and malformed input are all skipped safely.
 *
 * Per-line raw products are summed first and the aggregates rounded once (avoiding
 * double-rounding drift). `addonMinutes` is floored at 0 (time is real work and is
 * never negative); fixed and percent may be negative to model discounts.
 *
 * @param addons     The service's add-on definitions (active + inactive).
 * @param selections The customer's answers keyed by `addonKey`.
 */
export function resolveAddonEffects(
  addons: readonly CalculatorAddonConfigV2[] | undefined,
  selections: AddonSelectionsV2 | undefined,
): ResolvedAddonEffectsV2 {
  const lines: ResolvedAddonEffectLineV2[] = [];
  let rawMinutes = 0;
  let rawFixed = 0;
  let rawPercent = 0;

  if (addons && addons.length > 0) {
    const sel = selections ?? {};
    const seen = new Set<string>();

    for (const addon of addons) {
      if (!addon || typeof addon.addonKey !== "string" || addon.addonKey === "") continue;
      if (addon.active !== true) continue;
      if (seen.has(addon.addonKey)) continue;
      seen.add(addon.addonKey);

      const multiplier = resolveMultiplier(addon, sel[addon.addonKey]);
      if (multiplier === 0) continue;

      const timeMinutes = num(addon.effectTimeMinutes) * multiplier;
      const fixedExclVat = num(addon.effectFixedExclVat) * multiplier;
      const percent = num(addon.effectPercent) * multiplier;

      rawMinutes += timeMinutes;
      rawFixed += fixedExclVat;
      rawPercent += percent;

      lines.push({
        addonKey: addon.addonKey,
        multiplier,
        timeMinutes: round2(timeMinutes),
        fixedExclVat: round2(fixedExclVat),
        percent: round2(percent),
      });
    }
  }

  return {
    addonMinutes: round2(Math.max(0, rawMinutes)),
    addonFixedExclVat: round2(rawFixed),
    addonPercent: round2(rawPercent),
    lines,
  };
}
