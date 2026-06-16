/**
 * Customer Agreement — resolver + versioning helpers (Phase 1 foundation).
 *
 * Pure, storage-agnostic business logic for the commercial-agreement foundation.
 * Enforces the three LOCKED contracts from the Development Center
 * (`customer_agreement`):
 *
 *   CONTRACT 1 — Hybrid Billing Precedence:
 *     effectiveBillingModel = line.billingModelOverride ?? agreement.billingModel.
 *     `billingModelOverride` is ONLY legal when agreement.billingModel = "hybrid";
 *     for every non-hybrid agreement it MUST be null/undefined.
 *
 *   CONTRACT 3 — Agreement Status State Machine:
 *     draft   → active | cancelled
 *     active  → paused | superseded | cancelled | ended
 *     paused  → active | cancelled | ended
 *     superseded / cancelled / ended are TERMINAL.
 *     Only `active` or `paused` agreements may be superseded by a new version.
 *
 *   Versioning (agreementGroupId chain): commercial changes create a NEW version
 *     (version + 1, same agreementGroupId); the prior version is marked
 *     `superseded` and never overwritten. Historical commercial terms are
 *     immutable.
 *
 * These helpers are deterministic: callers inject ids/timestamps so versioning
 * is testable without touching the clock or any store.
 */
import type {
  AgreementStatus,
  BillingModel,
  CustomerAgreement,
  CustomerAgreementLine,
  PricingModel,
} from "@/types";

// ── CONTRACT 1 — Hybrid billing precedence ────────────────

/**
 * Resolves the billing model that actually applies to a line.
 * `line.billingModelOverride ?? agreement.billingModel` (CONTRACT 1).
 */
export function effectiveBillingModel(
  agreement: Pick<CustomerAgreement, "billingModel">,
  line: Pick<CustomerAgreementLine, "billingModelOverride">,
): BillingModel {
  return line.billingModelOverride ?? agreement.billingModel;
}

/** Whether per-line {@link CustomerAgreementLine.billingModelOverride} is legal. */
export function isBillingModelOverrideAllowed(
  agreement: Pick<CustomerAgreement, "billingModel">,
): boolean {
  return agreement.billingModel === "hybrid";
}

/**
 * Validates a single line's billing override against CONTRACT 1.
 * Returns an error message, or `null` when the line is valid.
 */
export function validateLineBillingOverride(
  agreement: Pick<CustomerAgreement, "billingModel">,
  line: Pick<CustomerAgreementLine, "billingModelOverride">,
): string | null {
  const hasOverride =
    line.billingModelOverride !== null && line.billingModelOverride !== undefined;
  if (hasOverride && !isBillingModelOverrideAllowed(agreement)) {
    return `billingModelOverride is only allowed when the agreement billingModel is "hybrid" (got "${agreement.billingModel}").`;
  }
  return null;
}

// ── CONTRACT 3 — Agreement status state machine ───────────

/** Allowed forward transitions for each {@link AgreementStatus} (CONTRACT 3). */
export const AGREEMENT_STATUS_TRANSITIONS: Record<AgreementStatus, readonly AgreementStatus[]> = {
  draft: ["active", "cancelled"],
  active: ["paused", "superseded", "cancelled", "ended"],
  paused: ["active", "cancelled", "ended"],
  superseded: [],
  cancelled: [],
  ended: [],
};

/** Terminal statuses that can never transition onwards. */
export const TERMINAL_AGREEMENT_STATUSES: readonly AgreementStatus[] = [
  "superseded",
  "cancelled",
  "ended",
];

/** Whether a status is terminal (no outgoing transitions). */
export function isTerminalStatus(status: AgreementStatus): boolean {
  return TERMINAL_AGREEMENT_STATUSES.includes(status);
}

/** Whether `from → to` is a legal status transition (CONTRACT 3). */
export function canTransitionStatus(from: AgreementStatus, to: AgreementStatus): boolean {
  return AGREEMENT_STATUS_TRANSITIONS[from].includes(to);
}

/**
 * Asserts a status transition, throwing a descriptive error when illegal.
 * Use at the boundary where a status change is persisted.
 */
export function assertStatusTransition(from: AgreementStatus, to: AgreementStatus): void {
  if (!canTransitionStatus(from, to)) {
    throw new Error(
      `Illegal agreement status transition: "${from}" → "${to}". ` +
        `Allowed from "${from}": [${AGREEMENT_STATUS_TRANSITIONS[from].join(", ") || "none (terminal)"}].`,
    );
  }
}

/** Only `active` or `paused` agreements may be superseded by a new version. */
export function canBeSuperseded(status: AgreementStatus): boolean {
  return status === "active" || status === "paused";
}

// ── Pricing resolution ────────────────────────────────────

/**
 * Resolves a line's commercial total from its {@link PricingModel}.
 *  - `fixed`  → agreedPrice (the agreed line total).
 *  - `per_unit` → agreedPrice × quantity.
 *  - `custom` → agreedPrice is authoritative; no derivation (REFINEMENT 3).
 * Returns `null` when the price cannot be resolved (missing inputs).
 */
export function resolveLineTotal(
  line: Pick<CustomerAgreementLine, "pricingModel" | "agreedPrice" | "quantity">,
): number | null {
  const price = line.agreedPrice ?? null;
  if (price === null) return null;
  const model: PricingModel = line.pricingModel;
  if (model === "per_unit") {
    const qty = line.quantity ?? null;
    if (qty === null) return null;
    return roundMoney(price * qty);
  }
  // fixed | custom → the agreed price/snapshot is authoritative.
  return roundMoney(price);
}

/** Rounds to 2 decimals (money), avoiding float drift in totals. */
function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// ── Validation ────────────────────────────────────────────

/** A single validation problem found on an agreement or one of its lines. */
export interface AgreementValidationIssue {
  /** Stable machine code for the rule that failed. */
  code:
    | "version_below_one"
    | "missing_agreement_group_id"
    | "line_group_mismatch"
    | "line_agreement_mismatch"
    | "line_billing_override_illegal"
    | "invalid_valid_window";
  message: string;
  /** The offending line id, when the issue is line-scoped. */
  lineId?: string;
}

/** Outcome of {@link validateAgreement}. `ok` is true only when no issues. */
export interface AgreementValidationResult {
  ok: boolean;
  issues: AgreementValidationIssue[];
}

/**
 * Validates an agreement header and its lines against the locked invariants:
 * version ≥ 1, lines belong to this version + group, CONTRACT 1 override rule,
 * and a sane validity window. Pure — never mutates its inputs.
 */
export function validateAgreement(
  agreement: CustomerAgreement,
  lines: readonly CustomerAgreementLine[] = [],
): AgreementValidationResult {
  const issues: AgreementValidationIssue[] = [];

  if (agreement.version < 1) {
    issues.push({
      code: "version_below_one",
      message: `Agreement version must be >= 1 (got ${agreement.version}).`,
    });
  }
  if (!agreement.agreementGroupId) {
    issues.push({
      code: "missing_agreement_group_id",
      message: "Agreement must have an agreementGroupId.",
    });
  }
  if (
    agreement.validFrom &&
    agreement.validTo &&
    agreement.validTo < agreement.validFrom
  ) {
    issues.push({
      code: "invalid_valid_window",
      message: `validTo (${agreement.validTo}) must be on or after validFrom (${agreement.validFrom}).`,
    });
  }

  for (const line of lines) {
    if (line.agreementId !== agreement.id) {
      issues.push({
        code: "line_agreement_mismatch",
        message: `Line "${line.id}" references agreement "${line.agreementId}", expected "${agreement.id}".`,
        lineId: line.id,
      });
    }
    if (line.agreementGroupId !== agreement.agreementGroupId) {
      issues.push({
        code: "line_group_mismatch",
        message: `Line "${line.id}" group "${line.agreementGroupId}" does not match agreement group "${agreement.agreementGroupId}".`,
        lineId: line.id,
      });
    }
    const overrideError = validateLineBillingOverride(agreement, line);
    if (overrideError) {
      issues.push({
        code: "line_billing_override_illegal",
        message: `Line "${line.id}": ${overrideError}`,
        lineId: line.id,
      });
    }
  }

  return { ok: issues.length === 0, issues };
}

// ── Versioning ────────────────────────────────────────────

/** Injected, deterministic inputs for creating a new agreement version. */
export interface SupersedeOptions {
  /** App-facing id for the NEW version. */
  newAgreementId: string;
  /** ISO timestamp applied to the supersede operation. */
  now: string;
  /**
   * Status the new version starts in. Defaults to `active`. Must be a
   * non-terminal status (`draft`, `active` or `paused`).
   */
  newStatus?: Extract<AgreementStatus, "draft" | "active" | "paused">;
  /** Optional actor recorded on the new version. */
  createdBy?: string | null;
}

/** The two records produced by {@link supersedeAgreement}. */
export interface SupersedeResult {
  /** The prior version, marked `superseded` and linked forward. */
  previous: CustomerAgreement;
  /** The new live version, linked back to the prior version. */
  next: CustomerAgreement;
}

/**
 * Creates a NEW agreement version from a current one, applying the locked
 * versioning rules (CONTRACT 3 + agreementGroupId chain):
 *  - the current agreement MUST be `active` or `paused` ({@link canBeSuperseded});
 *  - `next` keeps the same {@link CustomerAgreement.agreementGroupId}, gets
 *    `version + 1`, links back via `supersedesVersionId`;
 *  - `previous` is marked `superseded` and linked forward via `supersededById`.
 *
 * `commercialChanges` carries the changed commercial terms (billing model,
 * invoice interval, validity, name, notes, source metadata). It never changes
 * identity fields (id, agreementGroupId, version, status, chain links).
 *
 * Pure: returns NEW objects and never mutates the input.
 */
export function supersedeAgreement(
  current: CustomerAgreement,
  commercialChanges: Partial<
    Pick<
      CustomerAgreement,
      | "billingModel"
      | "invoiceInterval"
      | "validFrom"
      | "validTo"
      | "name"
      | "notes"
      | "sourceType"
      | "sourceReferenceId"
    >
  >,
  options: SupersedeOptions,
): SupersedeResult {
  if (!canBeSuperseded(current.status)) {
    throw new Error(
      `Only "active" or "paused" agreements may be superseded (got "${current.status}").`,
    );
  }

  const previous: CustomerAgreement = {
    ...current,
    status: "superseded",
    supersededById: options.newAgreementId,
    updatedAt: options.now,
  };

  const next: CustomerAgreement = {
    ...current,
    id: options.newAgreementId,
    version: current.version + 1,
    status: options.newStatus ?? "active",
    supersedesVersionId: current.id,
    supersededById: null,
    createdBy: options.createdBy ?? current.createdBy ?? null,
    createdAt: options.now,
    updatedAt: options.now,
    ...commercialChanges,
  };

  return { previous, next };
}

/**
 * Copies an agreement's lines onto a NEW version id (used when superseding).
 * Each copied line gets a fresh id via `makeLineId` and is re-pointed at the new
 * version while keeping its snapshots. Pure — returns new objects.
 */
export function copyLinesToVersion(
  lines: readonly CustomerAgreementLine[],
  next: Pick<CustomerAgreement, "id" | "agreementGroupId">,
  makeLineId: (sourceLineId: string, index: number) => string,
  now: string,
): CustomerAgreementLine[] {
  return lines.map((line, index) => ({
    ...line,
    id: makeLineId(line.id, index),
    agreementId: next.id,
    agreementGroupId: next.agreementGroupId,
    createdAt: now,
    updatedAt: now,
  }));
}

/**
 * Orders a version chain oldest → newest by {@link CustomerAgreement.version}.
 * Defensive against unordered storage reads. Returns a new array.
 */
export function sortVersionChain(
  versions: readonly CustomerAgreement[],
): CustomerAgreement[] {
  return [...versions].sort((a, b) => a.version - b.version);
}

/**
 * Returns the single live (non-terminal) version of a group, or `null` when
 * every version is terminal. By construction there is at most one.
 */
export function liveVersion(
  versions: readonly CustomerAgreement[],
): CustomerAgreement | null {
  const live = versions.filter((v) => !isTerminalStatus(v.status));
  if (live.length === 0) return null;
  // If storage ever holds more than one, prefer the highest version.
  return sortVersionChain(live)[live.length - 1] ?? null;
}
