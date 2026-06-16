/**
 * Calculator V2 — plan selection.
 *
 * Pure logic that resolves which plan a calculation should use, and whether the
 * public UI must offer the visitor a choice. Plans are the source of truth for
 * pricing (Slice V2-D); a service that is enabled must have at least one active
 * plan. Selection precedence:
 *
 *   1. An explicitly requested plan key that maps to an ACTIVE plan.
 *   2. The single active plan (auto-selected — no public choice needed).
 *   3. The active plan flagged `isDefault`.
 *   4. The first active plan by sort order.
 *
 * `requiresPublicChoice` is true only when more than one plan is active, so a
 * single-plan service never shows a confusing public plan picker.
 */

import type { CalculatorPlanV2, PriceIssue } from "./types";

/** The outcome of resolving a plan for a calculation. */
export interface PlanSelectionResultV2 {
  /** The selected plan, or null when no active plan exists. */
  plan: CalculatorPlanV2 | null;
  /** Active plans, sorted (sortOrder asc, then planKey) for stable UI ordering. */
  activePlans: CalculatorPlanV2[];
  /** True when more than one plan is active (public UI should offer a choice). */
  requiresPublicChoice: boolean;
  /** Populated only when `plan` is null (no active plan to price with). */
  issue: PriceIssue | null;
}

/** Stable sort: lowest sortOrder first, planKey as a deterministic tiebreaker. */
function bySortOrderThenKey(a: CalculatorPlanV2, b: CalculatorPlanV2): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.planKey.localeCompare(b.planKey);
}

/**
 * Resolves the plan to price with from a service's plan list. A requested key is
 * honoured only when it maps to an active plan; otherwise selection falls through
 * to single → default → first. Returns the sorted active list and whether the
 * public UI should surface a plan choice.
 */
export function selectPlanV2(
  plans: readonly CalculatorPlanV2[],
  requestedPlanKey?: string | null,
): PlanSelectionResultV2 {
  const activePlans = plans.filter((p) => p.active).slice().sort(bySortOrderThenKey);

  if (activePlans.length === 0) {
    return {
      plan: null,
      activePlans,
      requiresPublicChoice: false,
      issue: {
        code: "no_active_plan",
        message: "Tjänsten har ingen aktiv prisplan.",
      },
    };
  }

  const requiresPublicChoice = activePlans.length > 1;

  const requested =
    requestedPlanKey != null
      ? activePlans.find((p) => p.planKey === requestedPlanKey) ?? null
      : null;

  const selected =
    requested ??
    (activePlans.length === 1 ? activePlans[0] : null) ??
    activePlans.find((p) => p.isDefault) ??
    activePlans[0];

  return { plan: selected, activePlans, requiresPublicChoice, issue: null };
}
