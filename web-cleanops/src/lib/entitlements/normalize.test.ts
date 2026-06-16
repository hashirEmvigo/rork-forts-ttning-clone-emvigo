import { describe, expect, it } from "vitest";

import {
  buildResolutionContext,
  normalizeAssignments,
  normalizeBundles,
  normalizeOverrides,
} from "./normalize";
import type {
  BundleAssignmentRow,
  BundleGrantLimitRow,
  BundleGrantRow,
  BundleRow,
  CompanyOverrideLimitRow,
  CompanyOverrideRow,
} from "./types";

// Anchored "now" so all window assertions are deterministic.
const NOW = new Date("2025-06-01T12:00:00.000Z");

function bundleRow(over: Partial<BundleRow> = {}): BundleRow {
  return {
    id: "b1",
    slug: "professional",
    name: "Professional",
    description: null,
    bundle_type: "base_plan",
    status: "active",
    is_assignable: true,
    billing_provider: null,
    billing_product_id: null,
    created_at: null,
    updated_at: null,
    ...over,
  };
}

function grantRow(over: Partial<BundleGrantRow> = {}): BundleGrantRow {
  return { id: "g1", bundle_id: "b1", service_key: "media_uploads", status: "trial", ...over };
}

function grantLimitRow(over: Partial<BundleGrantLimitRow> = {}): BundleGrantLimitRow {
  return { id: "gl1", grant_id: "g1", limit_key: "media_upload_count", limit_value: 500, value_text: null, ...over };
}

function assignmentRow(over: Partial<BundleAssignmentRow> = {}): BundleAssignmentRow {
  return {
    id: "a1",
    company_id: "c1",
    bundle_id: "b1",
    role: "base",
    status: "active",
    starts_at: "2025-01-01T00:00:00.000Z",
    ends_at: null,
    ...over,
  };
}

function overrideRow(over: Partial<CompanyOverrideRow> = {}): CompanyOverrideRow {
  return {
    id: "o1",
    company_id: "c1",
    service_key: "media_uploads",
    status: "enabled",
    reason: "negotiated deal",
    starts_at: "2025-01-01T00:00:00.000Z",
    ends_at: null,
    ...over,
  };
}

function overrideLimitRow(over: Partial<CompanyOverrideLimitRow> = {}): CompanyOverrideLimitRow {
  return { id: "ol1", override_id: "o1", limit_key: "media_upload_count", limit_value: 1000, value_text: null, ...over };
}

describe("normalizeBundles", () => {
  it("flattens a valid bundle with grants and numeric limits", () => {
    const { bundles, issues } = normalizeBundles({
      bundles: [bundleRow()],
      grants: [grantRow()],
      grantLimits: [grantLimitRow()],
    });
    expect(issues).toHaveLength(0);
    expect(bundles).toHaveLength(1);
    expect(bundles[0].grants).toHaveLength(1);
    const grant = bundles[0].grants[0];
    expect(grant.serviceKey).toBe("media_uploads");
    expect(grant.status).toBe("trial");
    expect(grant.limits).toEqual([
      { limitKey: "media_upload_count", kind: "numeric", value: 500 },
    ]);
  });

  it("drops grants with an unknown service key and records an issue", () => {
    const { bundles, issues } = normalizeBundles({
      bundles: [bundleRow()],
      grants: [grantRow({ service_key: "nonexistent_feature" })],
      grantLimits: [],
    });
    expect(bundles[0].grants).toHaveLength(0);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("unknown-service-key");
  });

  it("drops grants with an invalid status and records an issue", () => {
    const { bundles, issues } = normalizeBundles({
      bundles: [bundleRow()],
      grants: [grantRow({ status: "paused" })],
      grantLimits: [],
    });
    expect(bundles[0].grants).toHaveLength(0);
    expect(issues[0].kind).toBe("invalid-grant-status");
  });

  it("drops limit rows whose key is not declared for the service", () => {
    const { issues } = normalizeBundles({
      bundles: [bundleRow()],
      grants: [grantRow()],
      grantLimits: [grantLimitRow({ limit_key: "unknown_limit" })],
    });
    expect(issues.some((i) => i.kind === "unknown-limit-key")).toBe(true);
  });

  it("drops limit rows violating the numeric-XOR-text one-of shape", () => {
    const both = normalizeBundles({
      bundles: [bundleRow()],
      grants: [grantRow()],
      grantLimits: [grantLimitRow({ limit_value: 500, value_text: "x" })],
    });
    expect(both.issues.some((i) => i.kind === "invalid-limit-value")).toBe(true);

    const neither = normalizeBundles({
      bundles: [bundleRow()],
      grants: [grantRow()],
      grantLimits: [grantLimitRow({ limit_value: null, value_text: null })],
    });
    expect(neither.issues.some((i) => i.kind === "invalid-limit-value")).toBe(true);
  });

  it("orders bundles by slug and grants by service key deterministically", () => {
    const { bundles } = normalizeBundles({
      bundles: [bundleRow({ id: "b2", slug: "zeta" }), bundleRow({ id: "b1", slug: "alpha" })],
      grants: [
        grantRow({ id: "g2", bundle_id: "b1", service_key: "preferred_time_evaluation", status: "enabled" }),
        grantRow({ id: "g1", bundle_id: "b1", service_key: "media_uploads" }),
      ],
      grantLimits: [],
    });
    expect(bundles.map((b) => b.slug)).toEqual(["alpha", "zeta"]);
    expect(bundles[0].grants.map((g) => g.serviceKey)).toEqual([
      "media_uploads",
      "preferred_time_evaluation",
    ]);
  });
});

describe("normalizeAssignments", () => {
  it("keeps an active, open-ended assignment", () => {
    expect(normalizeAssignments([assignmentRow()], NOW)).toHaveLength(1);
  });

  it("excludes cancelled assignments", () => {
    expect(normalizeAssignments([assignmentRow({ status: "cancelled" })], NOW)).toHaveLength(0);
  });

  it("excludes future-dated assignments", () => {
    const future = assignmentRow({ starts_at: "2025-12-01T00:00:00.000Z" });
    expect(normalizeAssignments([future], NOW)).toHaveLength(0);
  });

  it("excludes expired assignments", () => {
    const expired = assignmentRow({ ends_at: "2025-03-01T00:00:00.000Z" });
    expect(normalizeAssignments([expired], NOW)).toHaveLength(0);
  });

  it("excludes assignments with an invalid role", () => {
    expect(normalizeAssignments([assignmentRow({ role: "owner" })], NOW)).toHaveLength(0);
  });
});

describe("normalizeOverrides", () => {
  it("normalizes an enabled override with limits", () => {
    const { overrides, issues } = normalizeOverrides(
      { overrides: [overrideRow()], overrideLimits: [overrideLimitRow()] },
      NOW,
    );
    expect(issues).toHaveLength(0);
    expect(overrides).toHaveLength(1);
    expect(overrides[0].status).toBe("enabled");
    expect(overrides[0].limits).toEqual([
      { limitKey: "media_upload_count", kind: "numeric", value: 1000 },
    ]);
  });

  it("accepts a null status (limits-only override)", () => {
    const { overrides } = normalizeOverrides(
      { overrides: [overrideRow({ status: null })], overrideLimits: [overrideLimitRow()] },
      NOW,
    );
    expect(overrides).toHaveLength(1);
    expect(overrides[0].status).toBeNull();
  });

  it("drops overrides with an unknown service key", () => {
    const { overrides, issues } = normalizeOverrides(
      { overrides: [overrideRow({ service_key: "nope" })], overrideLimits: [] },
      NOW,
    );
    expect(overrides).toHaveLength(0);
    expect(issues[0].kind).toBe("unknown-service-key");
  });

  it("drops overrides with an invalid non-null status", () => {
    const { overrides, issues } = normalizeOverrides(
      { overrides: [overrideRow({ status: "weird" })], overrideLimits: [] },
      NOW,
    );
    expect(overrides).toHaveLength(0);
    expect(issues[0].kind).toBe("invalid-override-status");
  });

  it("excludes expired overrides based on now", () => {
    const { overrides } = normalizeOverrides(
      { overrides: [overrideRow({ ends_at: "2025-02-01T00:00:00.000Z" })], overrideLimits: [] },
      NOW,
    );
    expect(overrides).toHaveLength(0);
  });
});

describe("buildResolutionContext", () => {
  it("assembles parts and defaults the registry to the code-owned one", () => {
    const ctx = buildResolutionContext({
      globalEntitlements: [],
      bundles: [],
      assignments: [],
      overrides: [],
      now: NOW,
    });
    expect(ctx.registry.length).toBeGreaterThan(0);
    expect(ctx.now).toBe(NOW);
    expect(ctx.bundles).toEqual([]);
  });
});
