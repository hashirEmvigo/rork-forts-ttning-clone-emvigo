/**
 * Agreement Template → Customer Agreement orchestration (Phase 9 · controlled
 * creation flow).
 *
 * The single controlled data flow that turns a PERSISTED Agreement Template into
 * a PERSISTED Customer Agreement v1, optionally provisioning a Time Bank wallet:
 *
 *   Persisted Agreement Template
 *     ↓ load template + active lines (scope-guarded)
 *   Validate template usable (active + ≥1 active line)
 *     ↓
 *   Pure Template → Agreement snapshot (createAgreementFromTemplate)
 *     ↓
 *   ENTITLEMENT GATE — decide whether Time Bank may be enabled
 *     ↓
 *   Persist Customer Agreement v1 + lines (parent before children)
 *     ↓
 *   Optional Time Bank wallet creation (idempotent per agreementGroupId)
 *     ↓
 *   Structured creation report
 *
 * Design contracts:
 *   1. Templates SUGGEST; agreements OWN. The created agreement is an INDEPENDENT
 *      snapshot — the template id is recorded for traceability only and future
 *      template edits/deletion never affect the agreement.
 *   2. Templates MUST NEVER bypass entitlements. Time Bank is only enabled when
 *      the snapshot wants it AND the injected entitlement gate allows it. When
 *      denied, the agreement is STILL created but Time Bank is forced OFF and NO
 *      wallet is created (customer-friendly: the operational agreement is not
 *      blocked by a missing add-on).
 *   3. Wallet creation is IDEMPOTENT per agreementGroupId (no duplicates) and
 *      appends NO refill transaction — the refill scheduler stays inactive.
 *   4. The cancellation credit policy is copied into the snapshot only; NO
 *      transaction is created at agreement creation — the policy is used later
 *      when a visit is cancelled.
 *
 * FOUNDATION / ORCHESTRATION ONLY — no UI, no scheduler, no live migration, no
 * customer-facing flow, no billing/payroll wiring, no production-authoritative
 * cut-over. The entitlement decision is INJECTED so this module never reaches
 * into (and so can never silently activate) the entitlement pipeline itself.
 */
import type {
  CustomerAgreement,
  CustomerAgreementLine,
  ServiceEntitlementStatus,
  TimeBankCancellationPolicy,
  TimeBankWallet,
} from "@/types";
import {
  createAgreementFromTemplate,
  validateTemplateForCreation,
  type CreateAgreementOverrides,
} from "./agreementTemplates";
import type { AgreementTimeBankSnapshot } from "./timeBankTemplateBinding";
import type {
  TimeBankEntitlementDecision,
  TimeBankEntitlementSource,
} from "./timeBankEntitlement";
import { supabaseAgreementTemplatesRepository } from "./agreementTemplatesRepository";
import { supabaseCustomerAgreementRepository } from "./customerAgreementRepository";
import { ensureWalletForAgreement } from "./timeBankPersistence";
import { loadCompanyUuidMap } from "./customerMigration";

/**
 * The result a {@link TimeBankEntitlementGate} may return: either a bare boolean
 * (allow / deny) or a structured {@link TimeBankEntitlementDecision} carrying the
 * resolved status, source, and denial reason for richer reporting.
 */
export type TimeBankGateResult = boolean | TimeBankEntitlementDecision;

/**
 * Decides whether a company/package is entitled to use Time Bank. INJECTED so
 * the orchestrator never couples to (and so can never silently activate) the
 * entitlement pipeline; production callers pass the real gate from
 * {@link createTimeBankEntitlementGate}. May be sync or async, and may return a
 * bare boolean or a structured decision. When OMITTED the gate defaults to
 * DENIED (safe default — no hidden activation through template selection).
 */
export type TimeBankEntitlementGate = (
  companyId: string,
) => TimeBankGateResult | Promise<TimeBankGateResult>;

/** Normalizes a gate result into a structured decision for reporting. */
function normalizeGateResult(
  result: TimeBankGateResult,
): TimeBankEntitlementDecision {
  if (typeof result === "boolean") {
    return {
      allowed: result,
      status: result ? "enabled" : "disabled",
      source: result ? "override" : "none",
      contributingBundleIds: [],
      globallyAvailable: result,
      denialReason: result ? null : "Entitlement gate denied Time Bank.",
    };
  }
  return result;
}

/** Inputs for {@link createCustomerAgreementFromTemplate}. */
export interface CreateCustomerAgreementFromTemplateInput {
  /** The persisted source template legacy id. */
  templateId: string;
  /** The customer the new agreement belongs to. */
  customerId: string;
  /** The company the new agreement belongs to (app-facing legacy id). */
  companyId: string;
  /**
   * App-facing company scope guard used when loading the template. Company
   * templates out of this scope are treated as not found.
   */
  scopeCompanyId?: string | null;
  /** Optional field-level overrides applied AFTER the template snapshot. */
  overrides?: CreateAgreementOverrides;
  /**
   * The entitlement gate. When omitted, Time Bank is treated as NOT entitled
   * (no wallet is created). Templates must never bypass entitlements.
   */
  timeBankEntitlementGate?: TimeBankEntitlementGate;
  /** Stable id used for a NEWLY created wallet (ignored when one exists). */
  walletId: string;
  /** Creation timestamp (ISO). */
  now: string;
  /** When true, compute the full plan + report but write nothing. */
  dryRun?: boolean;
}

/** Why Time Bank ended up enabled or disabled for the created agreement. */
export type TimeBankDecisionReason =
  | "template_disabled"
  | "entitlement_denied"
  | "enabled";

/** The Time Bank portion of a {@link CreateCustomerAgreementReport}. */
export interface TimeBankCreationOutcome {
  /** Whether the template snapshot WANTED Time Bank on. */
  requestedByTemplate: boolean;
  /** Whether the entitlement gate ALLOWED Time Bank. */
  entitlementAllowed: boolean;
  /** The effective decision after applying the gate. */
  enabled: boolean;
  /** Machine-readable reason for the decision. */
  reason: TimeBankDecisionReason;
  /** The wallet (existing or newly created); null when Time Bank is off. */
  wallet: TimeBankWallet | null;
  /** True when a NEW wallet was created (false when reused or off). */
  walletCreated: boolean;
  /** The cancellation credit policy copied into the snapshot (never executed). */
  cancellationCreditPolicy: TimeBankCancellationPolicy;
  /** The resolved entitlement status from the gate (for reporting/support). */
  entitlementStatus: ServiceEntitlementStatus;
  /** Where the entitlement decision came from (default/bundle/override/none). */
  entitlementSource: TimeBankEntitlementSource;
  /** Ids of the bundles that contributed an enabling/trial grant, if any. */
  contributingBundleIds: string[];
  /** A human-readable denial reason from the gate, when access was refused. */
  denialReason: string | null;
}

/** A structured report describing the orchestration outcome. */
export interface CreateCustomerAgreementReport {
  ok: boolean;
  dryRun: boolean;
  /** The created agreement v1 (snapshot). Null on early failure. */
  agreement: CustomerAgreement | null;
  /** The created agreement lines. Empty on failure. */
  lines: CustomerAgreementLine[];
  /** The full Time Bank snapshot produced by the pure flow. Null on failure. */
  timeBankSnapshot: AgreementTimeBankSnapshot | null;
  /** The Time Bank provisioning outcome. Null on early failure. */
  timeBank: TimeBankCreationOutcome | null;
  /** The source template id (traceability only). Null on early failure. */
  sourceTemplateId: string | null;
  /** The source template version at creation time. */
  sourceTemplateVersion: number | null;
  /** Number of agreement version rows written (0 on dryRun/failure). */
  writtenAgreementCount: number;
  /** Number of agreement line rows written (0 on dryRun/failure). */
  writtenLineCount: number;
  /** Validation errors that blocked creation. */
  errors: string[];
  /** A single fatal error message, when the run failed. */
  error?: string;
}

/**
 * Resolves the real Supabase tenant UUID for an app-facing company id. Returns
 * null when no `companies` row matches (RLS would reject the write).
 */
async function resolveCompanyUuid(companyLegacyId: string): Promise<string | null> {
  const map = await loadCompanyUuidMap();
  return map.get(companyLegacyId) ?? null;
}

function emptyReport(dryRun: boolean): CreateCustomerAgreementReport {
  return {
    ok: false,
    dryRun,
    agreement: null,
    lines: [],
    timeBankSnapshot: null,
    timeBank: null,
    sourceTemplateId: null,
    sourceTemplateVersion: null,
    writtenAgreementCount: 0,
    writtenLineCount: 0,
    errors: [],
  };
}

/**
 * Creates a PERSISTED Customer Agreement v1 from a persisted Agreement Template,
 * applying the entitlement gate before any Time Bank wallet is provisioned.
 *
 * Idempotency / safety model:
 *   * Creating an agreement from a template is NOT globally idempotent: each
 *     call mints a FRESH agreementGroupId + version-1 id, so two calls produce
 *     two independent agreements. This is intentional — re-running represents a
 *     genuine new agreement, not a retry. (A future idempotencyKey could be
 *     layered on if a provenance index is added; not in this foundation.)
 *   * Wallet creation IS idempotent per agreementGroupId, so a retry after a
 *     flaky wallet write never double-provisions.
 *   * Writes are ordered parent → children → wallet: the agreement version is
 *     written before its lines (no orphan lines), and the wallet last (a failed
 *     wallet write leaves a valid agreement, reported via `ok: false`).
 */
export async function createCustomerAgreementFromTemplate(
  input: CreateCustomerAgreementFromTemplateInput,
): Promise<CreateCustomerAgreementReport> {
  const dryRun = input.dryRun ?? false;
  const report = emptyReport(dryRun);

  // ── 1. Load persisted template + lines (scope-guarded) ─────────
  const loaded = await supabaseAgreementTemplatesRepository.getTemplateWithLines(
    input.templateId,
    { companyId: input.scopeCompanyId },
  );
  if (!loaded) {
    report.error = `Template "${input.templateId}" not found or out of scope.`;
    return report;
  }

  // ── 2. Validate template usable (active + ≥1 active line) ──────
  const validation = validateTemplateForCreation(loaded.template, loaded.lines);
  if (!validation.valid) {
    report.errors = validation.errors;
    report.error = "Template is not usable for agreement creation.";
    return report;
  }

  // ── 3. Pure Template → Agreement snapshot ──────────────────────
  const snapshot = createAgreementFromTemplate({
    template: loaded.template,
    lines: loaded.lines,
    customerId: input.customerId,
    companyId: input.companyId,
    overrides: input.overrides,
  });
  report.agreement = snapshot.agreement;
  report.lines = snapshot.lines;
  report.timeBankSnapshot = snapshot.timeBankSnapshot;
  report.sourceTemplateId = snapshot.sourceTemplateId;
  report.sourceTemplateVersion = snapshot.sourceTemplateVersion;

  // ── 4. Entitlement gate (templates must NEVER bypass entitlements) ─
  const requestedByTemplate = snapshot.timeBankSnapshot.timeBankEnabled;
  const allocation = snapshot.timeBankSnapshot.rules.allocationMinutes ?? 0;
  const wantsWallet =
    requestedByTemplate && Number.isInteger(allocation) && allocation > 0;

  let decision: TimeBankEntitlementDecision = {
    allowed: false,
    status: "disabled",
    source: "none",
    contributingBundleIds: [],
    globallyAvailable: false,
    denialReason: "Time Bank not requested by template.",
  };
  if (wantsWallet) {
    decision = input.timeBankEntitlementGate
      ? normalizeGateResult(await input.timeBankEntitlementGate(input.companyId))
      : {
          allowed: false,
          status: "disabled",
          source: "none",
          contributingBundleIds: [],
          globallyAvailable: false,
          denialReason:
            "No entitlement gate supplied; Time Bank denied (no hidden activation).",
        };
  }
  const entitlementAllowed = decision.allowed;

  const timeBankEnabled = wantsWallet && entitlementAllowed;
  const reason: TimeBankDecisionReason = !requestedByTemplate
    ? "template_disabled"
    : !entitlementAllowed
      ? "entitlement_denied"
      : "enabled";

  report.timeBank = {
    requestedByTemplate,
    entitlementAllowed,
    enabled: timeBankEnabled,
    reason,
    wallet: null,
    walletCreated: false,
    cancellationCreditPolicy: snapshot.timeBankSnapshot.cancellationCreditPolicy,
    entitlementStatus: decision.status,
    entitlementSource: decision.source,
    contributingBundleIds: decision.contributingBundleIds,
    denialReason: timeBankEnabled ? null : decision.denialReason,
  };

  // ── 5. Resolve tenant + persist agreement (parent → children) ──
  const companyUuid = await resolveCompanyUuid(input.companyId);
  if (!companyUuid) {
    report.error = `No Supabase company found for legacy_id "${input.companyId}". Migrate companies first.`;
    return report;
  }

  if (dryRun) {
    report.ok = true;
    return report;
  }

  try {
    report.writtenAgreementCount =
      await supabaseCustomerAgreementRepository.upsertVersions(
        [snapshot.agreement],
        companyUuid,
      );
    report.writtenLineCount = await supabaseCustomerAgreementRepository.upsertLines(
      snapshot.lines,
      companyUuid,
    );
  } catch (err) {
    report.error =
      err instanceof Error ? err.message : "Unknown agreement persistence error.";
    return report;
  }

  // ── 6. Optional Time Bank wallet (idempotent; no refill) ───────
  if (timeBankEnabled) {
    const walletRes = await ensureWalletForAgreement({
      walletId: input.walletId,
      agreement: snapshot.agreement,
      rules: snapshot.timeBankSnapshot.rules,
      now: input.now,
      companyId: input.companyId,
    });
    if (!walletRes.ok) {
      // The agreement is persisted and valid; only wallet provisioning failed.
      report.error = walletRes.error ?? "Time Bank wallet creation failed.";
      return report;
    }
    report.timeBank.wallet = walletRes.wallet;
    report.timeBank.walletCreated = walletRes.created;
  }

  report.ok = true;
  return report;
}
