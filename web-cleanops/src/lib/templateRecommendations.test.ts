import { describe, expect, it } from "vitest";

import {
  effectiveAudience,
  isRecommendedForSegment,
  partitionByRecommendation,
  recommendedAudiences,
} from "./templateRecommendations";
import type { ChecklistTemplateV2 } from "@/types";

/** Minimal template stub carrying just the audience used by the helper. */
function tpl(id: string, audience?: ChecklistTemplateV2["audience"]) {
  return { id, audience };
}

describe("templateRecommendations — effectiveAudience", () => {
  it("treats a missing audience as general", () => {
    expect(effectiveAudience(tpl("a"))).toBe("general");
    expect(effectiveAudience(tpl("b", "b2b"))).toBe("b2b");
  });
});

describe("templateRecommendations — recommendedAudiences", () => {
  it("recommends B2B + General for a B2B customer", () => {
    expect(recommendedAudiences("b2b")).toEqual(["b2b", "general"]);
  });

  it("recommends B2C + General for a B2C customer", () => {
    expect(recommendedAudiences("b2c")).toEqual(["b2c", "general"]);
  });

  it("recommends General for a One-Time customer", () => {
    expect(recommendedAudiences("one_time")).toEqual(["general"]);
  });

  it("recommends nothing when the segment is unknown", () => {
    expect(recommendedAudiences(undefined)).toEqual([]);
  });
});

describe("templateRecommendations — isRecommendedForSegment", () => {
  it("matches by audience and treats unset as general", () => {
    expect(isRecommendedForSegment(tpl("a", "b2b"), "b2b")).toBe(true);
    expect(isRecommendedForSegment(tpl("a", "general"), "b2b")).toBe(true);
    expect(isRecommendedForSegment(tpl("a", "b2c"), "b2b")).toBe(false);
    // Unset audience → general → recommended for everyone with a segment.
    expect(isRecommendedForSegment(tpl("a"), "one_time")).toBe(true);
    expect(isRecommendedForSegment(tpl("a", "b2b"), undefined)).toBe(false);
  });
});

describe("templateRecommendations — partitionByRecommendation", () => {
  it("splits recommended from others and orders by audience priority", () => {
    const templates = [
      tpl("general-1", "general"),
      tpl("b2b-1", "b2b"),
      tpl("b2c-1", "b2c"),
      tpl("b2b-2", "b2b"),
    ];
    const { recommended, others } = partitionByRecommendation(templates, "b2b");
    // B2B audience comes before general; b2c excluded.
    expect(recommended.map((t) => t.id)).toEqual(["b2b-1", "b2b-2", "general-1"]);
    expect(others.map((t) => t.id)).toEqual(["b2c-1"]);
  });

  it("preserves relative order within the same audience bucket (stable)", () => {
    const templates = [tpl("g1", "general"), tpl("g2", "general")];
    const { recommended } = partitionByRecommendation(templates, "one_time");
    expect(recommended.map((t) => t.id)).toEqual(["g1", "g2"]);
  });

  it("recommends nothing and keeps all as others when segment is unknown", () => {
    const templates = [tpl("a", "b2b"), tpl("b", "general")];
    const { recommended, others } = partitionByRecommendation(
      templates,
      undefined,
    );
    expect(recommended).toEqual([]);
    expect(others.map((t) => t.id)).toEqual(["a", "b"]);
  });
});
