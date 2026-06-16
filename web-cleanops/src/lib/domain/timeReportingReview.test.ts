import { describe, expect, it } from "vitest";

import {
  aiRecommendationPriority,
  isActionableFlag,
  isBulkApproveCandidate,
  isEscalatedFlag,
  isResolvedFlag,
  requiresHumanDecision,
} from "@/lib/domain/timeReportingReview";
import type {
  AiReviewRecommendation,
  FlagResolutionStatus,
} from "@/types/timeReporting";

describe("flag triage classifiers", () => {
  it("treats open / kept_for_review / escalated as still actionable", () => {
    const actionable: FlagResolutionStatus[] = ["open", "kept_for_review", "escalated"];
    for (const s of actionable) expect(isActionableFlag(s)).toBe(true);
  });

  it("treats reviewed / approved / dismissed as resolved (not actionable)", () => {
    const resolved: FlagResolutionStatus[] = ["reviewed", "approved", "dismissed"];
    for (const s of resolved) {
      expect(isResolvedFlag(s)).toBe(true);
      expect(isActionableFlag(s)).toBe(false);
    }
  });

  it("separates escalation from resolution (a report can be approved with a kept flag)", () => {
    expect(isEscalatedFlag("escalated")).toBe(true);
    expect(isEscalatedFlag("kept_for_review")).toBe(false);
    // kept_for_review is neither resolved nor escalated — it stays in triage.
    expect(isResolvedFlag("kept_for_review")).toBe(false);
  });
});

describe("AI recommendation helpers (recommend-only, never decide)", () => {
  it("ranks high-risk above review and likely-approve last", () => {
    expect(aiRecommendationPriority("high_risk")).toBeGreaterThan(
      aiRecommendationPriority("needs_human_decision"),
    );
    expect(aiRecommendationPriority("needs_human_decision")).toBeGreaterThan(
      aiRecommendationPriority("review_recommended"),
    );
    expect(aiRecommendationPriority("likely_approve")).toBe(0);
  });

  it("only likely_approve is a bulk-approve candidate", () => {
    const all: AiReviewRecommendation[] = [
      "likely_approve",
      "review_recommended",
      "high_risk",
      "needs_human_decision",
      "insufficient_data",
    ];
    for (const rec of all) {
      expect(isBulkApproveCandidate(rec)).toBe(rec === "likely_approve");
    }
  });

  it("routes high-risk and needs-human-decision to focused review", () => {
    expect(requiresHumanDecision("high_risk")).toBe(true);
    expect(requiresHumanDecision("needs_human_decision")).toBe(true);
    expect(requiresHumanDecision("likely_approve")).toBe(false);
    expect(requiresHumanDecision("review_recommended")).toBe(false);
  });
});
