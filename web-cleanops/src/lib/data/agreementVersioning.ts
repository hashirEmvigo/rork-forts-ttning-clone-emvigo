/**
 * Agreement Versioning Foundation (Phase 2 · logic only).
 *
 * The versioning + snapshot contract layer on top of the LOCKED Customer
 * Agreement schema (migration 0013). The data model already carries every
 * versioning column — `agreementGroupId`, 1-based `version`,
 * `supersedesVersionId` / `supersededById`, the `status` state machine and the
 * immutable line snapshots. What was missing is the *behaviour*: how to derive
 * a new version without mutating history, how to resolve the live version,
 * how to read the version that was in commercial effect on a given date, and
 * how to prove the future TimeBankWallet binds to the stable
 * `agreementGroupId` (NOT a version id).
 *
 * This module is PURE and FOUNDATION ONLY:
 *   * No Supabase writes, no localStorage, no UI, no flags, no activation.
 *   * It never mutates the records passed to it — version creation returns NEW
 *     objects (the previous version is returned as a copy with its supersede
 *     links/status updated), so historical terms stay byte-stable.
 *   * Out of scope (nothing here): Time Bank, Invoice Basis, Agreement
 *     Templates, Pricing Engine, RUT, Customer Portal.
 *
 * Async read resolvers (`resolveCurrent*`) compose the EXISTING
 * `supabaseCustomerAgreementRepository` read surface — they add no new tables
 * and do not change existing reads.
 */
import type {
  AgreementStatus,
  BillingModel,
  CustomerAgreement,
  CustomerAgreementLine,
  InvoiceInterval,
} from "@/types";
import { supabaseCustomerAgreementRepository } from "./customerAgreementRepository";
import type { DetailParams } from "./types";

// ── Status helpers (mirror the LOCKED CONTRACT 3 state machine) ──

/**
 * Terminal statuses — a version in any of these can never be superseded again
 * nor returned to `active`. Superseded/cancelled/ended are end-of-life leaves.
 */
export const TERMINAL_AGREEMENT_STATUSES: readonly AgreementStatus[] = [
  "superseded",
  "cancelled",
  "ended",
] as const;

/** Statuses that represent a still-operative (non-terminal) version. */
export const LIVE_AGREEMENT_STATUSES: readonly AgreementStatus[] = [
  "draft",
  "active",
  "paused",
] as const;

/** True when `status` is one of the terminal end-of-life statuses. */
export function isTerminalStatus(status: AgreementStatus): boolean {
  return TERMINAL_AGREEMENT_STATUSES.includes(status);
}

/** True when `status` is non-terminal (draft / active / paused). */
export function isLiveStatus(status: AgreementStatus): boolean {
  return !isTerminalStatus(status);
}

/**
 * Only an `active` or `paused` version may be superseded by a new version
 * (CONTRACT 3). Draft, superseded, cancelled and ended versions cannot.
 */
export function canBeSuperseded(status: AgreementStatus): boolean {
  return status === "active" || status === "paused";
}

// ── Resolvers over an in-memory version chain ────────────────

/**
 * All versions belonging to one agreement group, sorted oldest → newest by
 * `version`. Pure filter — does not mutate the input array.
 */
export function listVersionsForGroup(
  versions: CustomerAgreement[],
  agreementGroupId: string,
): CustomerAgreement[] {
  return versions
    .filter((v) => v.agreementGroupId === agreementGroupId)
    .slice()
    .sort((a, b) => a.version - b.version);
}

/** A single version by its (version-level) id, or null when absent. */
export function findVersionById(
  versions: CustomerAgreement[],
  id: string,
): CustomerAgreement | null {
  return versions.find((v) => v.id === id) ?? null;
}

/**
 * The CURRENT live version of a group: the non-terminal version with the
 * highest `version`. Returns null when every version is terminal (a fully
 * ended/cancelled group). The LOCKED invariant is exactly one non-terminal
 * version per group; if data violates that, the newest live one wins
 * deterministically (and {@link validateVersionChain} will flag the anomaly).
 */
export function resolveCurrentVersion(
  versions: CustomerAgreement[],
): CustomerAgreement | null {
  const live = versions.filter((v) => isLiveStatus(v.status));
  if (live.length === 0) return null;
  return live.reduce((best, v) => (v.version > best.version ? v : best));
}

/** True when a "YYYY-MM-DD" date falls within `[validFrom, validTo]` (inclusive, open-ended aware). */
function dateWithinValidity(agreement: CustomerAgreement, date: string): boolean {
  const from = agreement.validFrom;
  const to = agreement.validTo;
  if (from !== undefined && from !== null && date < from) return false;
  if (to !== undefined && to !== null && date > to) return false;
  return true;
}

/**
 * The version that was in COMMERCIAL EFFECT on a specific "YYYY-MM-DD" date —
 * for audit, payroll, statistics and future billing history. Superseded
 * versions are intentionally INCLUDED (a superseded version was the live one
 * during its own validity window). Among versions whose validity window covers
 * the date, the highest `version` wins. Returns null when none cover the date.
 */
export function resolveVersionActiveOn(
  versions: CustomerAgreement[],
  date: string,
): CustomerAgreement | null {
  const covering = versions.filter((v) => dateWithinValidity(v, date));
  if (covering.length === 0) return null;
  return covering.reduce((best, v) => (v.version > best.version ? v : best));
}

// ── Version creation (supersede, snapshot, never overwrite) ──

/** Commercial fields a new version may set. Omitted fields inherit from the prior version. */
export interface VersionChangeInput {
  billingModel?: BillingModel;
  invoiceInterval?: InvoiceInterval;
  validFrom?: string;
  validTo?: string | null;
  name?: string;
  notes?: string;
}

/** Inputs for {@link createNewAgreementVersion}. Ids/timestamps are injected for determinism. */
export interface CreateVersionOptions {
  /** Stable, caller-supplied id for the NEW version (must be unique). */
  newAgreementId: string;
  /** Timestamp applied to the new version + the supersede update. */
  now: string;
  /** Status the new version starts in. Only `draft` or `active` are valid entry states. */
  newStatus?: Extract<AgreementStatus, "draft" | "active">;
  /** Commercial changes for the new version (inherits prior values otherwise). */
  changes?: VersionChangeInput;
  createdBy?: string | null;
}

/** Result of superseding: a copy of the prior version (now terminal) + the new live version. */
export interface CreateVersionResult {
  /** The prior version, copied with `status: "superseded"` + `supersededById` set. */
  previous: CustomerAgreement;
  /** The brand-new version with its own id, `version + 1` and supersede link. */
  next: CustomerAgreement;
}

/**
 * Creates a NEW agreement version that supersedes `current`, without ever
 * mutating `current` (history stays immutable). The returned `previous` is a
 * COPY of `current` flipped to `superseded`; `next` is the new live version.
 *
 * Throws when `current` cannot be superseded (not active/paused) — enforcing
 * the LOCKED state machine.
 */
export function createNewAgreementVersion(
  current: CustomerAgreement,
  options: CreateVersionOptions,
): CreateVersionResult {
  if (!canBeSuperseded(current.status)) {
    throw new Error(
      `Cannot supersede agreement ${current.id}: status "${current.status}" is not active/paused.`,
    );
  }
  const { newAgreementId, now } = options;
  const changes = options.changes ?? {};
  const newStatus: AgreementStatus = options.newStatus ?? "active";

  const previous: CustomerAgreement = {
    ...current,
    status: "superseded",
    supersededById: newAgreementId,
    updatedAt: now,
  };

  const next: CustomerAgreement = {
    ...current,
    id: newAgreementId,
    // agreementGroupId is carried forward unchanged — the version-chain key is
    // stable across versions (this is what TimeBankWallet binds to).
    agreementGroupId: current.agreementGroupId,
    version: current.version + 1,
    status: newStatus,
    supersedesVersionId: current.id,
    supersededById: null,
    billingModel: changes.billingModel ?? current.billingModel,
    invoiceInterval: changes.invoiceInterval ?? current.invoiceInterval,
    validFrom: changes.validFrom ?? current.validFrom,
    validTo: changes.validTo !== undefined ? changes.validTo : current.validTo,
    name: changes.name ?? current.name,
    notes: changes.notes ?? current.notes,
    createdBy: options.createdBy ?? current.createdBy ?? null,
    createdAt: now,
    updatedAt: now,
  };

  return { previous, next };
}

/**
 * Deep-copies a prior version's lines onto a NEW version so historical line
 * rows never change when prices/services change later. Source lines are NOT
 * mutated; each clone gets a fresh id (via `lineIdFor`) and is re-parented to
 * `next`. This is the line-level half of the "snapshot, never overwrite" rule.
 */
export function snapshotLinesForNewVersion(
  sourceLines: CustomerAgreementLine[],
  next: CustomerAgreement,
  lineIdFor: (sourceLine: CustomerAgreementLine, index: number) => string,
  now: string,
): CustomerAgreementLine[] {
  return sourceLines.map((line, index) => ({
    ...line,
    id: lineIdFor(line, index),
    agreementId: next.id,
    agreementGroupId: next.agreementGroupId,
    createdAt: now,
    updatedAt: now,
  }));
}

// ── Change classification (what forces a new version) ────────

/** Header fields whose change forces a new version (commercial terms). */
const VERSIONED_HEADER_FIELDS: ReadonlyArray<keyof CustomerAgreement> = [
  "billingModel",
  "invoiceInterval",
  "validFrom",
];

/** Line fields whose change forces a new version (commercial terms). */
const VERSIONED_LINE_FIELDS: ReadonlyArray<keyof CustomerAgreementLine> = [
  "billingModelOverride",
  "pricingModel",
  "agreedPrice",
  "quantity",
  "unit",
  "vat",
  "sourceServiceId",
  "serviceNameSnapshot",
  "categoryTypeSnapshot",
  "serviceBasisTypeSnapshot",
  "sortOrder",
];

/** Outcome of {@link diffRequiresNewVersion}. */
export interface VersionDiffResult {
  /** True when a NEW version must be created instead of an in-place edit. */
  requiresNewVersion: boolean;
  /** Human-readable reasons (which commercial fields changed). Empty when in-place. */
  reasons: string[];
}

function scalarEqual(a: unknown, b: unknown): boolean {
  const an = a === undefined || a === null ? "" : String(a);
  const bn = b === undefined || b === null ? "" : String(b);
  return an === bn;
}

/**
 * Decides whether moving from `(currentHeader, currentLines)` to
 * `(proposedHeader, proposedLines)` requires a NEW version or is a safe
 * in-place edit. Commercial changes (price, billing model, invoice
 * interval/frequency, service, recurrence-driven line changes, validFrom)
 * require a new version. Pure metadata edits — `name`, `notes`, and a
 * `validTo` extension while commercial terms are unchanged — are in-place.
 */
export function diffRequiresNewVersion(
  currentHeader: CustomerAgreement,
  currentLines: CustomerAgreementLine[],
  proposedHeader: Pick<
    CustomerAgreement,
    "billingModel" | "invoiceInterval" | "validFrom" | "validTo"
  >,
  proposedLines: CustomerAgreementLine[],
): VersionDiffResult {
  const reasons: string[] = [];

  for (const field of VERSIONED_HEADER_FIELDS) {
    if (!scalarEqual(currentHeader[field], proposedHeader[field as keyof typeof proposedHeader])) {
      reasons.push(`header.${String(field)} changed`);
    }
  }

  if (currentLines.length !== proposedLines.length) {
    reasons.push(`line count changed (${currentLines.length} → ${proposedLines.length})`);
  } else {
    const proposedById = new Map(proposedLines.map((l) => [l.id, l]));
    for (const current of currentLines) {
      const proposed = proposedById.get(current.id);
      if (!proposed) {
        reasons.push(`line ${current.id} removed/replaced`);
        continue;
      }
      for (const field of VERSIONED_LINE_FIELDS) {
        if (!scalarEqual(current[field], proposed[field])) {
          reasons.push(`line ${current.id}.${String(field)} changed`);
        }
      }
    }
  }

  return { requiresNewVersion: reasons.length > 0, reasons };
}

// ── Migration / compatibility (foundation-safe) ──────────────

/**
 * Normalises a pre-versioning agreement into a clean version-1 head: forces
 * `version` to 1 and clears the supersede links. Pure — returns a NEW object,
 * never mutating the input. Used so existing agreements become version 1
 * WITHOUT any live migration or source-of-truth change.
 */
export function normalizeToVersionOne(agreement: CustomerAgreement): CustomerAgreement {
  return {
    ...agreement,
    version: 1,
    supersedesVersionId: null,
    supersededById: null,
  };
}

/** Outcome of {@link validateVersionChain}. */
export interface ChainIntegrityResult {
  ok: boolean;
  /** Anomalies found (sequence gaps, multiple live versions, broken links). */
  issues: string[];
  /** The resolved current live version id, or null. */
  liveVersionId: string | null;
  /** Count of non-terminal versions (the LOCKED invariant expects ≤ 1). */
  liveCount: number;
}

/**
 * Validates a single group's version chain against the LOCKED invariants:
 * contiguous 1-based version numbers, at most one non-terminal (live) version,
 * and consistent `supersedesVersionId` / `supersededById` links. Read-only.
 */
export function validateVersionChain(versions: CustomerAgreement[]): ChainIntegrityResult {
  const issues: string[] = [];
  const sorted = versions.slice().sort((a, b) => a.version - b.version);

  const groupIds = new Set(sorted.map((v) => v.agreementGroupId));
  if (groupIds.size > 1) {
    issues.push(`mixed agreementGroupIds in chain: ${[...groupIds].join(", ")}`);
  }

  sorted.forEach((v, index) => {
    if (v.version !== index + 1) {
      issues.push(`version sequence gap: expected ${index + 1}, found ${v.version} (${v.id})`);
    }
  });

  const live = sorted.filter((v) => isLiveStatus(v.status));
  if (live.length > 1) {
    issues.push(`multiple live versions: ${live.map((v) => v.id).join(", ")}`);
  }

  const byId = new Map(sorted.map((v) => [v.id, v]));
  for (const v of sorted) {
    if (v.supersededById) {
      const successor = byId.get(v.supersededById);
      if (!successor) {
        issues.push(`${v.id}.supersededById → ${v.supersededById} not found in chain`);
      } else if (successor.supersedesVersionId !== v.id) {
        issues.push(`${v.id} ↔ ${successor.id} supersede link mismatch`);
      }
      if (!isTerminalStatus(v.status)) {
        issues.push(`${v.id} has a successor but is not terminal (status ${v.status})`);
      }
    }
    if (v.supersedesVersionId && !byId.has(v.supersedesVersionId)) {
      issues.push(`${v.id}.supersedesVersionId → ${v.supersedesVersionId} not found in chain`);
    }
  }

  const liveVersion = resolveCurrentVersion(sorted);
  return {
    ok: issues.length === 0,
    issues,
    liveVersionId: liveVersion?.id ?? null,
    liveCount: live.length,
  };
}

// ── Time Bank binding contract (proof, not implementation) ───

/**
 * The key a future TimeBankWallet binds to. By LOCKED decision the wallet binds
 * to the stable {@link CustomerAgreement.agreementGroupId} — NOT a version id —
 * so it survives version changes, price changes and line changes. This helper
 * exists so the binding contract is verifiable today; it creates no wallet and
 * does not enable Time Bank.
 */
export function timeBankWalletBindingKey(agreement: CustomerAgreement): string {
  return agreement.agreementGroupId;
}

// ── Async resolvers over the existing repository read surface ─

/**
 * Loads a group's full chain via the existing repository and resolves the
 * current live version. Adds no new tables and does not change existing reads.
 */
export async function resolveCurrentVersionForGroup(
  agreementGroupId: string,
  params: DetailParams = {},
): Promise<CustomerAgreement | null> {
  const chain = await supabaseCustomerAgreementRepository.listVersionChain(
    agreementGroupId,
    params,
  );
  return resolveCurrentVersion(chain);
}

/**
 * Loads a group's full chain via the existing repository and resolves the
 * version in commercial effect on `date` ("YYYY-MM-DD").
 */
export async function resolveVersionActiveOnForGroup(
  agreementGroupId: string,
  date: string,
  params: DetailParams = {},
): Promise<CustomerAgreement | null> {
  const chain = await supabaseCustomerAgreementRepository.listVersionChain(
    agreementGroupId,
    params,
  );
  return resolveVersionActiveOn(chain, date);
}
