/**
 * Operational Execution — Time Reporting review helpers (Phase 1 foundation).
 *
 * Pure, framework-agnostic helpers over the review/triage concepts:
 * {@link FlagResolutionStatus} and {@link AiReviewRecommendation}. These exist
 * so the high-volume, exception-based Time Reporting workspace (built later)
 * has a single, tested source of truth for how flags resolve and how AI
 * recommendations are interpreted.
 *
 * NON-NEGOTIABLE: AI never makes a final approval decision. These helpers only
 * classify/prioritise; the admin always decides. Nothing here mutates state,
 * persists, or touches payroll/invoice/time-bank.
 */

import type {
  AiReviewRecommendation,
  FlagResolutionStatus,
} from "@/types/timeReporting";

/**
 * Flag statuses that still need a human to look at them. Kept separate from a
 * time report's approval status: a report can be approved while a flag remains
 * open or kept_for_review.
 */
const ACTIONABLE_FLAG_STATUSES: ReadonlySet<FlagResolutionStatus> = new Set([
  "open",
  "kept_for_review",
  "escalated",
]);

/**
 * Flag statuses considered closed/handled (no further triage required):
 * `reviewed`, `approved`, `dismissed`.
 */
const RESOLVED_FLAG_STATUSES: ReadonlySet<FlagResolutionStatus> = new Set([
  "reviewed",
  "approved",
  "dismissed",
]);

/** True when the flag still needs attention (open, kept for review, escalated). */
export function isActionableFlag(status: FlagResolutionStatus): boolean {
  return ACTIONABLE_FLAG_STATUSES.has(status);
}

/** True when the flag has been handled (reviewed, approved, or dismissed). */
export function isResolvedFlag(status: FlagResolutionStatus): boolean {
  return RESOLVED_FLAG_STATUSES.has(status);
}

/** True when the flag was escalated as a true exception requiring follow-up. */
export function isEscalatedFlag(status: FlagResolutionStatus): boolean {
  return status === "escalated";
}

/**
 * Relative triage priority for an AI recommendation — higher means it should
 * surface sooner for human review. Pure ranking only; never an auto-decision.
 *  - high_risk            → 3 (review first)
 *  - needs_human_decision → 2
 *  - review_recommended   → 1
 *  - insufficient_data    → 1 (cannot be auto-approved; needs eyes)
 *  - likely_approve       → 0 (safe to mass-approve after a glance)
 */
export function aiRecommendationPriority(rec: AiReviewRecommendation): number {
  switch (rec) {
    case "high_risk":
      return 3;
    case "needs_human_decision":
      return 2;
    case "review_recommended":
    case "insufficient_data":
      return 1;
    case "likely_approve":
      return 0;
  }
}

/**
 * Whether a recommendation is, on its own, a candidate for bulk "likely-safe"
 * approval. ONLY `likely_approve` qualifies — and even then the admin confirms
 * the bulk action. Everything else requires explicit human review.
 */
export function isBulkApproveCandidate(rec: AiReviewRecommendation): boolean {
  return rec === "likely_approve";
}

/**
 * Whether a recommendation should keep a record out of any bulk action and
 * route it to focused human review (high risk or an explicit human decision).
 */
export function requiresHumanDecision(rec: AiReviewRecommendation): boolean {
  return rec === "high_risk" || rec === "needs_human_decision";
}
