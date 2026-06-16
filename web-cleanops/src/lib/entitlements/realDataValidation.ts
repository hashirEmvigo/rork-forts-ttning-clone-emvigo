import { SERVICE_FEATURE_REGISTRY } from "@/lib/serviceRegistry";
import type {
  CompanyServiceEntitlement,
  ServiceGlobalEntitlement,
} from "@/types";

import type { LegacyEntitlementState } from "./backfill";
import {
  runShadowComparison,
  type ShadowComparisonReport,
  type ShadowMismatch,
} from "./shadowCompare";
import type { EntitlementLoadIssue } from "./types";

/**
 * Phase 5 (real-data) — production shadow validation report.
 *
 * This module turns the *live* legacy entitlement state (the same four datasets
 * the app holds today: companies, company entitlements, global entitlements, and
 * the Preferred Time Evaluation master gate) into a single, measurable
 * cutover-readiness report by running the existing {@link runShadowComparison}
 * harness over it.
 *
 * It is a pure, deterministic wrapper. It performs NO I/O, reads/writes no
 * Supabase, flips no feature flag, and is not imported by any production screen —
 * computing this report cannot change app behaviour. Identical input always
 * produces an identical report.
 *
 * IMPORTANT — where the input comes from: the legacy entitlement records
 * (`companyServiceEntitlements`, `serviceGlobalEntitlements`, `systemSettings`)
 * are held in app state / localStorage, NOT in Supabase. The bundle tables from
 * Phase 1 are still empty. So the only place the real datasets coexist is a live
 * super-admin session; the operator collects them there and feeds them in (see
 * the runbook accompanying this phase). This keeps the validation grounded in
 * real data without any new production wiring.
 */

/** The minimal company shape the validator needs: the id entitlements key on. */
export interface ValidationCompany {
  /** The company id in the SAME id space the entitlement records use. */
  id: string;
}

/** The Preferred Time Evaluation master-gate slice of system settings. */
export interface ValidationSystemSettings {
  allowPreferredTimeEvaluation: boolean;
}

/** The live legacy datasets, exactly as held in app state. */
export interface RealDataValidationInput {
  /** All current companies (each must receive exactly one base assignment). */
  companies: ValidationCompany[];
  /** All current explicit per-company entitlement records. */
  companyEntitlements: CompanyServiceEntitlement[];
  /** All current platform-wide availability records. */
  globalEntitlements: ServiceGlobalEntitlement[];
  /** Current system settings carrying the PTE master gate. */
  systemSettings: ValidationSystemSettings;
  /** The instant to resolve both paths against. Defaults to now. */
  now?: Date;
}

/** A structural invariant that did not hold during the run. */
export interface InvariantViolation {
  kind: "base-plan-invariant";
  message: string;
}

/** Default cap on how many mismatches are echoed inline for triage. */
export const DEFAULT_SAMPLE_MISMATCH_LIMIT = 25;

/**
 * The measurable real-data validation outcome. The cutover gate is
 * {@link RealDataValidationReport.passed}: true ONLY when
 * `mismatchCount === 0`, `loadIssueCount === 0`, and
 * `invariantViolationCount === 0`.
 */
export interface RealDataValidationReport {
  /** The three-zeros cutover gate. */
  passed: boolean;
  /** The instant both paths were resolved against (ISO). */
  now: string;
  /** Distinct companies analysed (union of companies + any referenced by a record). */
  companiesAnalysed: number;
  /** Registry services compared per company. */
  servicesCompared: number;
  /** Total (company × service × field) comparisons performed. */
  featureComparisons: number;
  /** Divergences between the legacy path and the new pipeline. */
  mismatchCount: number;
  /** Normalization findings on the synthetic rows (must be zero). */
  loadIssueCount: number;
  /** Normalization findings, in full, for triage (PII-free). */
  loadIssues: EntitlementLoadIssue[];
  /** Structural invariant failures (must be zero). */
  invariantViolationCount: number;
  /** Structural invariant failures, in full. */
  invariantViolations: InvariantViolation[];
  /** A bounded, sorted sample of mismatches for inline triage. */
  sampleMismatches: ShadowMismatch[];
  /** Mismatch counts grouped by compared field, for quick triage. */
  summaryByField: Record<string, number>;
  /** The full underlying shadow report (all mismatches, never truncated). */
  shadow: ShadowComparisonReport;
}

/**
 * Runs the production shadow validation over the live legacy datasets and
 * returns a measurable, deterministic report. Pure: no I/O, no writes, no flag.
 *
 * @param input - the live legacy datasets collected from a super-admin session.
 * @param sampleLimit - max mismatches echoed in `sampleMismatches`.
 */
export function buildRealDataValidationReport(
  input: RealDataValidationInput,
  sampleLimit: number = DEFAULT_SAMPLE_MISMATCH_LIMIT,
): RealDataValidationReport {
  const now = input.now ?? new Date();

  // Company id space: dedupe defensively; the shadow harness re-unions these
  // with any company referenced by an entitlement record, so no company with a
  // record is left without a base plan.
  const companyIds = Array.from(
    new Set<string>(input.companies.map((c) => c.id)),
  );

  const state: LegacyEntitlementState = {
    companyIds,
    companyEntitlements: input.companyEntitlements,
    globalEntitlements: input.globalEntitlements,
    systemSettings: {
      allowPreferredTimeEvaluation:
        input.systemSettings.allowPreferredTimeEvaluation === true,
    },
    registry: SERVICE_FEATURE_REGISTRY,
    now,
  };

  const shadow = runShadowComparison(state);

  const invariantViolations: InvariantViolation[] = shadow.basePlanInvariantHolds
    ? []
    : [
        {
          kind: "base-plan-invariant",
          message:
            "Base-plan invariant failed: not every analysed company received " +
            "exactly one active base assignment in the synthetic backfill.",
        },
      ];

  const cappedSample = Math.max(0, sampleLimit);

  return {
    passed:
      shadow.mismatchCount === 0 &&
      shadow.loadIssues.length === 0 &&
      invariantViolations.length === 0,
    now: shadow.now,
    companiesAnalysed: shadow.companyCount,
    servicesCompared: shadow.serviceCount,
    featureComparisons: shadow.comparisonCount,
    mismatchCount: shadow.mismatchCount,
    loadIssueCount: shadow.loadIssues.length,
    loadIssues: shadow.loadIssues,
    invariantViolationCount: invariantViolations.length,
    invariantViolations,
    sampleMismatches: shadow.mismatches.slice(0, cappedSample),
    summaryByField: shadow.summaryByField,
    shadow,
  };
}

/**
 * Formats a {@link RealDataValidationReport} into deterministic, PII-free log
 * lines: a headline gate line, the requested counts, any invariant violations,
 * and a bounded sample of mismatches. Never logs secrets or user data — only
 * company ids, service keys, and resolved values.
 */
export function formatRealDataValidationReport(
  report: RealDataValidationReport,
): string {
  const lines: string[] = [];
  lines.push(
    `[real-shadow] gate passed=${report.passed} now=${report.now}`,
  );
  lines.push(
    `[real-shadow] companiesAnalysed=${report.companiesAnalysed} ` +
      `servicesCompared=${report.servicesCompared} ` +
      `featureComparisons=${report.featureComparisons}`,
  );
  lines.push(
    `[real-shadow] mismatches=${report.mismatchCount} ` +
      `loadIssues=${report.loadIssueCount} ` +
      `invariantViolations=${report.invariantViolationCount}`,
  );
  for (const v of report.invariantViolations) {
    lines.push(`[real-shadow] invariant ${v.kind}: ${v.message}`);
  }
  for (const m of report.sampleMismatches) {
    lines.push(
      `[real-shadow] mismatch company=${m.companyId} service=${m.serviceKey} ` +
        `field=${m.field} legacy=${m.legacy} new=${m.new}`,
    );
  }
  if (report.mismatchCount > report.sampleMismatches.length) {
    lines.push(
      `[real-shadow] … ${report.mismatchCount - report.sampleMismatches.length} ` +
        "more mismatch(es) not shown (see report.shadow.mismatches)",
    );
  }
  return lines.join("\n");
}
