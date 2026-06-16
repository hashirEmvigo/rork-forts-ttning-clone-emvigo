/**
 * Time Bank – Agreement Template Rule Binding (Phase 8 · template rule model).
 *
 * Templates PROVIDE SUGGESTED defaults; Agreements OWN the final active rules.
 * This module is the PURE bridge between an Agreement Template's advisory
 * {@link TimeBankTemplateRules} and the authoritative {@link TimeBankRules}
 * stored on a wallet at agreement-creation time.
 *
 * Core contract:
 *   1. `defaultTemplateTimeBankRules()` returns the SAFE DEFAULT: Time Bank OFF,
 *      unlimited carryover, no expiry, no cancellation credit policy.
 *   2. `inheritTimeBankRulesFromTemplate(templateRules, overrides?)` merges
 *      template suggestions with explicit overrides to produce a final
 *      {@link TimeBankRules} snapshot. The result is owned by the agreement
 *      and NEVER live-linked to the template — template changes cannot rewrite
 *      existing agreements.
 *   3. `templateTimeBankEnabled(templateRules)` answers whether a template
 *      wants Time Bank turned on (required for wallet auto-creation).
 *
 * This module is PURE and FOUNDATION ONLY:
 *   * No Supabase writes, no localStorage, no UI, no flags, no activation.
 *   * No migration is created; no production-authoritative flip; no rollout.
 *   * Every function returns NEW objects and never mutates its inputs.
 *
 * Entitlement gate (requirement 5):
 *   * Templates MAY suggest Time Bank rules.
 *   * An entitlement MUST still decide whether the company/package can use
 *     Time Bank — no hidden activation through template selection.
 *   * This module does NOT enforce entitlements; the caller must apply that
 *     gate before creating a wallet.
 */
import type {
  TimeBankCancellationPolicy,
  TimeBankRules,
  TimeBankTemplateRules,
} from "@/types";
import {
  defaultCancellationPolicy,
  defaultTimeBankRules,
  validateCancellationPolicy,
} from "./timeBank";

// ── Safe template defaults ────────────────────────────────────

/**
 * The SAFE default template rules: Time Bank OFF, no allocation, unlimited
 * carryover, no expiry, no cancellation credit policy. A template with these
 * rules will never trigger automatic wallet creation — an admin must explicitly
 * enable Time Bank and set a positive allocation.
 */
export function defaultTemplateTimeBankRules(): Required<TimeBankTemplateRules> {
  return {
    timeBankEnabled: false,
    allocationMinutes: 0,
    refillFrequency: "monthly",
    carryoverPolicy: "unlimited",
    maxBalanceMinutes: null,
    expiryAfterDays: null,
    negativeFloorMinutes: 0,
    cancellationCreditPolicy: defaultCancellationPolicy({ enabled: false }),
    warningThresholdPercent: 20,
    criticalThresholdPercent: 5,
    warningThresholdMinutes: null,
    criticalThresholdMinutes: null,
    refillAnchor: "01",
  };
}

// ── Template → authoritative rules ───────────────────────────

/** Options for {@link inheritTimeBankRulesFromTemplate}. */
export interface InheritTemplateRulesInput {
  /**
   * The template's suggested Time Bank rules. When `null`/`undefined` the
   * function returns the safe-default rules (Time Bank OFF).
   */
  templateRules?: TimeBankTemplateRules | null;

  /**
   * Explicit overrides applied AFTER the template's suggestions but BEFORE
   * the safe defaults fill in any remaining gaps. Use this for agreement-level
   * tweaks made during creation (e.g. a custom allocation for this customer).
   * Fields set here always win over the template.
   */
  override?: Partial<TimeBankRules>;
}

/**
 * Applies a template's suggested Time Bank rules and returns a SNAPSHOT of
 * authoritative {@link TimeBankRules}. The result is a COPY — it is never
 * live-linked to the template, so later template changes never rewrite existing
 * agreements.
 *
 * Resolution order (last wins):
 *   1. Safe defaults (`defaultTimeBankRules(0)`)
 *   2. Template suggestions (only the fields that are explicitly set)
 *   3. Explicit overrides (always win)
 *
 * The returned rules are a concrete, immutable commercial snapshot ready to be
 * stored on a wallet or an agreement. The caller must still apply the
 * entitlement gate before creating a wallet.
 *
 * Note: `cancellationCreditPolicy` is NOT stored on `TimeBankRules` — it is a
 * separate policy object stored at the company/template/agreement level. This
 * function does NOT embed it in the rules; callers must handle it separately
 * via {@link inheritCancellationPolicyFromTemplate}.
 */
export function inheritTimeBankRulesFromTemplate(
  input: InheritTemplateRulesInput,
): TimeBankRules {
  const template = input.templateRules ?? {};

  const merged: TimeBankRules = {
    ...defaultTimeBankRules(0),

    // Template field mapping (only set the ones that are explicitly provided)
    ...(template.allocationMinutes !== undefined
      ? { allocationMinutes: template.allocationMinutes }
      : {}),
    ...(template.refillFrequency !== undefined
      ? { refillFrequency: template.refillFrequency }
      : {}),
    ...(template.carryoverPolicy !== undefined
      ? { carryoverPolicy: template.carryoverPolicy }
      : {}),
    ...(template.maxBalanceMinutes !== undefined
      ? { maxBalanceMinutes: template.maxBalanceMinutes }
      : {}),
    ...(template.expiryAfterDays !== undefined
      ? { expiryAfterDays: template.expiryAfterDays }
      : {}),
    ...(template.negativeFloorMinutes !== undefined
      ? { negativeFloorMinutes: template.negativeFloorMinutes }
      : {}),
    ...(template.warningThresholdPercent !== undefined
      ? { warningThresholdPercent: template.warningThresholdPercent }
      : {}),
    ...(template.criticalThresholdPercent !== undefined
      ? { criticalThresholdPercent: template.criticalThresholdPercent }
      : {}),
    ...(template.warningThresholdMinutes !== undefined
      ? { warningThresholdMinutes: template.warningThresholdMinutes }
      : {}),
    ...(template.criticalThresholdMinutes !== undefined
      ? { criticalThresholdMinutes: template.criticalThresholdMinutes }
      : {}),
    ...(template.refillAnchor !== undefined
      ? { refillAnchor: template.refillAnchor }
      : {}),

    // Explicit overrides always win
    ...input.override,
  };

  return merged;
}

/** Options for {@link inheritCancellationPolicyFromTemplate}. */
export interface InheritCancellationPolicyInput {
  /**
   * The template's suggested cancellation credit policy. When `null`/`undefined`
   * the function returns the company default (disabled).
   */
  templatePolicy?: TimeBankCancellationPolicy | null;

  /**
   * Explicit overrides applied AFTER the template's suggestion. Fields set here
   * always win.
   */
  override?: Partial<TimeBankCancellationPolicy>;
}

/** Outcome of {@link inheritCancellationPolicyFromTemplate}. */
export interface CancellationPolicyInheritance {
  /** The final, authoritative cancellation policy (a copy). */
  policy: TimeBankCancellationPolicy;
  /** Validation result for the final policy. */
  valid: boolean;
  /** Validation errors, if any. */
  errors: string[];
}

/**
 * Applies a template's suggested cancellation credit policy and returns a
 * validated SNAPSHOT. The result is a COPY — never live-linked to the template.
 *
 * Resolution order:
 *   1. Default (disabled, no deduction)
 *   2. Template suggestion (only if explicitly set)
 *   3. Explicit overrides (always win)
 *
 * The returned policy is always validated; callers should reject invalid
 * policies before saving.
 */
export function inheritCancellationPolicyFromTemplate(
  input: InheritCancellationPolicyInput,
): CancellationPolicyInheritance {
  const merged: TimeBankCancellationPolicy = {
    ...defaultCancellationPolicy({ enabled: false }),
    ...(input.templatePolicy ?? {}),
    ...input.override,
  };

  const validation = validateCancellationPolicy(merged);
  return {
    policy: merged,
    valid: validation.ok,
    errors: validation.errors,
  };
}

// ── Time Bank enabled check ───────────────────────────────────

/**
 * Returns true when a template explicitly enables Time Bank AND allocates a
 * positive number of minutes. Both conditions must be met — a template with
 * `timeBankEnabled: true` but zero allocation is treated as OFF (safe default).
 */
export function templateTimeBankEnabled(
  templateRules: TimeBankTemplateRules | null | undefined,
): boolean {
  if (!templateRules) return false;
  if (templateRules.timeBankEnabled !== true) return false;
  const allocation = templateRules.allocationMinutes ?? 0;
  if (!Number.isInteger(allocation) || allocation <= 0) return false;
  return true;
}

// ── Agreement creation snapshot ───────────────────────────────

/**
 * The full Time Bank snapshot that gets COPIED into a Customer Agreement at
 * creation time. This is the boundary: template suggestion → agreement-owning
 * authoritative values. After this snapshot is taken the agreement owns every
 * field; the template can change freely without affecting the agreement.
 */
export interface AgreementTimeBankSnapshot {
  /** Whether Time Bank is enabled for this agreement. */
  timeBankEnabled: boolean;
  /** The authoritative {@link TimeBankRules} snapshot. */
  rules: TimeBankRules;
  /** The authoritative cancellation credit policy (a copy, validated). */
  cancellationCreditPolicy: TimeBankCancellationPolicy;
  /** Whether the cancellation policy is valid. */
  cancellationPolicyValid: boolean;
  /** Validation errors for the cancellation policy (empty when valid). */
  cancellationPolicyErrors: string[];
}

/** Inputs for {@link createAgreementTimeBankSnapshot}. */
export interface CreateSnapshotInput {
  /**
   * The template's suggested Time Bank rules. When `null`/`undefined` the
   * snapshot is created from safe defaults (Time Bank OFF).
   */
  templateRules?: TimeBankTemplateRules | null;

  /**
   * Explicit overrides for the authoritative {@link TimeBankRules}. Always
   * win over template suggestions.
   */
  rulesOverride?: Partial<TimeBankRules>;

  /**
   * Explicit override for the cancellation credit policy. Always wins over
   * the template's suggestion.
   */
  cancellationPolicyOverride?: Partial<TimeBankCancellationPolicy>;
}

/**
 * Creates the FULL Time Bank snapshot that gets COPIED into a Customer Agreement
 * at creation time. This is the single integration seam: templates call this to
 * produce the agreement-owning values, and after this call the agreement is
 * completely independent of the template.
 *
 * The snapshot includes:
 *   * `timeBankEnabled` — whether a wallet should be auto-created
 *   * `rules` — the authoritative {@link TimeBankRules}
 *   * `cancellationCreditPolicy` — a validated cancellation policy (copy)
 *
 * The caller MUST still apply the entitlement gate before creating any wallet.
 * This function only produces the snapshot; it does NOT create wallets or
 * enforce entitlements.
 */
export function createAgreementTimeBankSnapshot(
  input: CreateSnapshotInput,
): AgreementTimeBankSnapshot {
  const rules = inheritTimeBankRulesFromTemplate({
    templateRules: input.templateRules,
    override: input.rulesOverride,
  });

  const cancellation = inheritCancellationPolicyFromTemplate({
    templatePolicy: input.templateRules?.cancellationCreditPolicy ?? null,
    override: input.cancellationPolicyOverride,
  });

  return {
    timeBankEnabled: templateTimeBankEnabled(input.templateRules),
    rules,
    cancellationCreditPolicy: cancellation.policy,
    cancellationPolicyValid: cancellation.valid,
    cancellationPolicyErrors: cancellation.errors,
  };
}

// ── Re-exports ────────────────────────────────────────────────

export type { TimeBankTemplateRules };
