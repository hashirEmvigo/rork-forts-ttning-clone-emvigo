/**
 * Agreement Versioning persistence layer (Phase 2 · foundation write path).
 *
 * The production WRITE path that turns the pure versioning LOGIC layer
 * (`agreementVersioning.ts`) into durable Supabase rows on the LOCKED Customer
 * Agreement schema (migration 0013). It is the missing half between
 * `createNewAgreementVersion()` (which only produces new in-memory objects) and
 * the repository read surface (`listVersionChain` / `getDetail` / `listLines`).
 *
 * Two entry points:
 *
 *   1. {@link persistAgreementVersion} — persists ONE version + its line
 *      snapshots (used for the initial v1 and any standalone write).
 *
 *   2. {@link persistNewAgreementVersion} — the supersede flow: derives the new
 *      version + snapshot lines from a live current version, then writes the
 *      superseded prior copy, the new live version and the new line snapshots.
 *      The prior historical row is only ever touched by the supersede operation
 *      (its status flips to `superseded` + `supersededById` link + `updatedAt`);
 *      its commercial terms and lines are never mutated.
 *
 * Both resolve the real tenant UUID via the existing {@link loadCompanyUuidMap}
 * (so RLS's `company_id` FK is satisfied), support `dryRun`, write parents
 * before children, and are idempotent (upsert on `legacy_id`, so a re-persist
 * heals drift rather than duplicating rows).
 *
 * FOUNDATION ONLY — this changes NO business behaviour and performs NO
 * activation:
 *   * localStorage stays the operational source of truth; these tables remain a
 *     shadow copy until a future, explicit cut-over.
 *   * No feature flag, no production-authoritative flip, no customer rollout.
 *   * Out of scope (nothing here): Time Bank, Invoice Basis, Agreement
 *     Templates, Pricing Engine, RUT, Customer Portal, UI.
 */
import type { CustomerAgreement, CustomerAgreementLine } from "@/types";
import {
  createNewAgreementVersion,
  snapshotLinesForNewVersion,
  type CreateVersionOptions,
  type CreateVersionResult,
} from "./agreementVersioning";
import { supabaseCustomerAgreementRepository } from "./customerAgreementRepository";
import { loadCompanyUuidMap } from "./customerMigration";

/** Shared write options across the persistence entry points. */
export interface PersistOptions {
  /**
   * App-facing company id used to resolve the real tenant UUID for RLS. When
   * omitted, the agreement's own `companyId` is used.
   */
  companyId?: string | null;
  /** When true, compute the plan + report but write nothing. */
  dryRun?: boolean;
}

/** Structured outcome of a version persistence run (or dry-run). */
export interface PersistVersionReport {
  ok: boolean;
  dryRun: boolean;
  /** Stable version-chain key the wallet/Time Bank will bind to. */
  agreementGroupId: string;
  /** The prior version flipped to `superseded` (only on the supersede flow). */
  supersededVersionId: string | null;
  /** The version id that is the live head after this run. */
  liveVersionId: string;
  /** Agreement VERSION rows actually written (0 on dry-run). */
  writtenVersionCount: number;
  /** Agreement LINE rows actually written (0 on dry-run). */
  writtenLineCount: number;
  /** Fatal error, if the run failed. */
  error?: string;
}

/**
 * Resolves the real Supabase tenant UUID for an app-facing company id. Returns
 * null when no `companies` row matches (RLS would reject the write) so callers
 * can abort cleanly with a clear reason.
 */
async function resolveCompanyUuid(companyLegacyId: string): Promise<string | null> {
  const map = await loadCompanyUuidMap();
  return map.get(companyLegacyId) ?? null;
}

/**
 * Persists ONE agreement version and its line snapshots. Parents are written
 * before children. Idempotent on `legacy_id`. Use for the initial v1 or any
 * standalone version write that does not supersede a prior version.
 */
export async function persistAgreementVersion(
  agreement: CustomerAgreement,
  lines: CustomerAgreementLine[],
  options: PersistOptions = {},
): Promise<PersistVersionReport> {
  const dryRun = options.dryRun ?? false;
  const companyLegacyId = options.companyId ?? agreement.companyId;

  const report: PersistVersionReport = {
    ok: false,
    dryRun,
    agreementGroupId: agreement.agreementGroupId,
    supersededVersionId: null,
    liveVersionId: agreement.id,
    writtenVersionCount: 0,
    writtenLineCount: 0,
  };

  const uuid = await resolveCompanyUuid(companyLegacyId);
  if (!uuid) {
    report.error = `No Supabase company found for legacy_id "${companyLegacyId}". Migrate companies first.`;
    return report;
  }

  if (dryRun) {
    report.ok = true;
    return report;
  }

  try {
    report.writtenVersionCount = await supabaseCustomerAgreementRepository.upsertVersions(
      [agreement],
      uuid,
    );
    report.writtenLineCount = await supabaseCustomerAgreementRepository.upsertLines(lines, uuid);
    report.ok = true;
    return report;
  } catch (err) {
    report.error = err instanceof Error ? err.message : "Unknown persistence error.";
    return report;
  }
}

/** Inputs for {@link persistNewAgreementVersion}. */
export interface PersistNewVersionOptions extends CreateVersionOptions, PersistOptions {
  /**
   * Stable id generator for each snapshot line on the new version. Defaults to
   * `${newAgreementId}-line-${index}`.
   */
  lineIdFor?: (sourceLine: CustomerAgreementLine, index: number) => string;
}

/** {@link persistNewAgreementVersion} returns the report plus the derived objects. */
export interface PersistNewVersionResult extends CreateVersionResult {
  report: PersistVersionReport;
  /** The new version's immutable line snapshots. */
  lines: CustomerAgreementLine[];
}

/**
 * The full supersede + persist flow:
 *
 *   1. {@link createNewAgreementVersion} derives the superseded prior copy +
 *      the new live version (throwing if `current` is not active/paused).
 *   2. {@link snapshotLinesForNewVersion} clones the prior lines onto the new
 *      version with fresh ids (historical lines are never reused or mutated).
 *   3. The prior (superseded) copy and the new version are upserted parents-first,
 *      then the new line snapshots.
 *
 * Idempotent on `legacy_id`. SHADOW / FOUNDATION ONLY — no activation.
 */
export async function persistNewAgreementVersion(
  current: CustomerAgreement,
  currentLines: CustomerAgreementLine[],
  options: PersistNewVersionOptions,
): Promise<PersistNewVersionResult> {
  const dryRun = options.dryRun ?? false;
  const { previous, next } = createNewAgreementVersion(current, options);
  const lineIdFor =
    options.lineIdFor ?? ((_line, index) => `${next.id}-line-${index}`);
  const lines = snapshotLinesForNewVersion(currentLines, next, lineIdFor, options.now);

  const companyLegacyId = options.companyId ?? next.companyId;
  const report: PersistVersionReport = {
    ok: false,
    dryRun,
    agreementGroupId: next.agreementGroupId,
    supersededVersionId: previous.id,
    liveVersionId: next.id,
    writtenVersionCount: 0,
    writtenLineCount: 0,
  };

  const uuid = await resolveCompanyUuid(companyLegacyId);
  if (!uuid) {
    report.error = `No Supabase company found for legacy_id "${companyLegacyId}". Migrate companies first.`;
    return { previous, next, lines, report };
  }

  if (dryRun) {
    report.ok = true;
    return { previous, next, lines, report };
  }

  try {
    // Parents first: the superseded prior copy + the new live version. Writing
    // both in one upsert keeps the chain consistent (no window where the prior
    // version points at a successor that does not yet exist).
    report.writtenVersionCount = await supabaseCustomerAgreementRepository.upsertVersions(
      [previous, next],
      uuid,
    );
    report.writtenLineCount = await supabaseCustomerAgreementRepository.upsertLines(lines, uuid);
    report.ok = true;
    return { previous, next, lines, report };
  } catch (err) {
    report.error = err instanceof Error ? err.message : "Unknown persistence error.";
    return { previous, next, lines, report };
  }
}
