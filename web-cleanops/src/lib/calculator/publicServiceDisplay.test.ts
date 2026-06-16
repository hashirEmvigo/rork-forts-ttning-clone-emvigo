import { describe, expect, it } from "vitest";

import { DEFAULT_FEATURED_LIMIT, partitionFeaturedServices } from "./publicServiceDisplay";

const SERVICES = ["home", "move_out", "office", "window", "deep"];

describe("partitionFeaturedServices", () => {
  it("shows all and no 'more' when there are fewer than the limit", () => {
    const out = partitionFeaturedServices(["home", "move_out"]);
    expect(out.featured).toEqual(["home", "move_out"]);
    expect(out.more).toEqual([]);
    expect(out.hasMore).toBe(false);
  });

  it("shows all and no 'more' at exactly the limit", () => {
    const out = partitionFeaturedServices(["home", "move_out", "office"]);
    expect(out.featured).toEqual(["home", "move_out", "office"]);
    expect(out.hasMore).toBe(false);
  });

  it("splits the head from the rest when above the limit", () => {
    const out = partitionFeaturedServices(SERVICES);
    expect(out.featured).toEqual(["home", "move_out", "office"]);
    expect(out.more).toEqual(["window", "deep"]);
    expect(out.hasMore).toBe(true);
  });

  it("respects a custom limit", () => {
    const out = partitionFeaturedServices(SERVICES, 2);
    expect(out.featured).toEqual(["home", "move_out"]);
    expect(out.more).toEqual(["office", "window", "deep"]);
    expect(out.hasMore).toBe(true);
  });

  it("falls back to the default for a non-positive/NaN limit", () => {
    expect(partitionFeaturedServices(SERVICES, 0).featured).toHaveLength(DEFAULT_FEATURED_LIMIT);
    expect(partitionFeaturedServices(SERVICES, Number.NaN).featured).toHaveLength(DEFAULT_FEATURED_LIMIT);
  });

  it("handles an empty list", () => {
    const out = partitionFeaturedServices([]);
    expect(out.featured).toEqual([]);
    expect(out.more).toEqual([]);
    expect(out.hasMore).toBe(false);
  });
});
