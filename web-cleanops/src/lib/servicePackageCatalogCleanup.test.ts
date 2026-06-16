import { describe, expect, it } from "vitest";

import {
  packagesContainingService,
  planServicePackageServiceRemoval,
} from "@/lib/servicePackageCatalogCleanup";
import type { ServicePackage, ServicePackageItem } from "@/types";

/**
 * SVCCAT — global package cleanup when a catalog service is hard-deleted.
 *
 * Proves the cleanup keys strictly on `sourceServiceId`, preserves every other
 * item (including legacy free-text items with no source link), keeps a package
 * that loses its last item, and never mutates its inputs.
 */

function item(overrides: Partial<ServicePackageItem> & Pick<ServicePackageItem, "id">): ServicePackageItem {
  return {
    name: "Window cleaning",
    categoryName: "Cleaning",
    billingType: "fixed",
    serviceBasisType: "billable",
    deductionEligible: false,
    deductionType: "none",
    smsEnabled: false,
    ...overrides,
  };
}

function pkg(overrides: Partial<ServicePackage> & Pick<ServicePackage, "id" | "items">): ServicePackage {
  return {
    name: overrides.id,
    archived: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("packagesContainingService", () => {
  it("returns packages that snapshotted the service by sourceServiceId", () => {
    const a = pkg({
      id: "pkg_a",
      items: [item({ id: "it_1", sourceServiceId: "svc_window" })],
    });
    const b = pkg({
      id: "pkg_b",
      items: [item({ id: "it_2", sourceServiceId: "svc_floor", name: "Floor care" })],
    });

    const result = packagesContainingService([a, b], "svc_window");

    expect(result.map((p) => p.id)).toEqual(["pkg_a"]);
  });

  it("ignores legacy free-text items with no source link", () => {
    const legacy = pkg({
      id: "pkg_legacy",
      items: [item({ id: "it_legacy" })], // no sourceServiceId
    });

    expect(packagesContainingService([legacy], "svc_window")).toEqual([]);
  });

  it("returns nothing for an empty/whitespace service id", () => {
    const a = pkg({ id: "pkg_a", items: [item({ id: "it_1", sourceServiceId: "svc_window" })] });
    expect(packagesContainingService([a], "")).toEqual([]);
    expect(packagesContainingService([a], "   ")).toEqual([]);
  });
});

describe("planServicePackageServiceRemoval", () => {
  it("removes only the matching item and keeps the others", () => {
    const a = pkg({
      id: "pkg_a",
      items: [
        item({ id: "it_window", sourceServiceId: "svc_window", name: "Window cleaning" }),
        item({ id: "it_floor", sourceServiceId: "svc_floor", name: "Floor care" }),
      ],
    });

    const { changed } = planServicePackageServiceRemoval([a], "svc_window", "2026-06-07T00:00:00.000Z");

    expect(changed).toHaveLength(1);
    expect(changed[0].id).toBe("pkg_a");
    expect(changed[0].items.map((it) => it.id)).toEqual(["it_floor"]);
    expect(changed[0].updatedAt).toBe("2026-06-07T00:00:00.000Z");
  });

  it("keeps a package that loses its last item (never deletes the package)", () => {
    const a = pkg({
      id: "pkg_only",
      items: [item({ id: "it_window", sourceServiceId: "svc_window" })],
    });

    const { changed } = planServicePackageServiceRemoval([a], "svc_window");

    expect(changed).toHaveLength(1);
    expect(changed[0].id).toBe("pkg_only");
    expect(changed[0].items).toEqual([]);
  });

  it("preserves legacy free-text items in an affected package", () => {
    const a = pkg({
      id: "pkg_mixed",
      items: [
        item({ id: "it_window", sourceServiceId: "svc_window" }),
        item({ id: "it_legacy", name: "Old free-text line" }), // no source link
      ],
    });

    const { changed } = planServicePackageServiceRemoval([a], "svc_window");

    expect(changed[0].items.map((it) => it.id)).toEqual(["it_legacy"]);
  });

  it("only returns packages that actually changed", () => {
    const a = pkg({ id: "pkg_a", items: [item({ id: "it_1", sourceServiceId: "svc_window" })] });
    const b = pkg({ id: "pkg_b", items: [item({ id: "it_2", sourceServiceId: "svc_floor" })] });

    const { changed } = planServicePackageServiceRemoval([a, b], "svc_window");

    expect(changed.map((p) => p.id)).toEqual(["pkg_a"]);
  });

  it("does not mutate the input packages or items", () => {
    const a = pkg({
      id: "pkg_a",
      items: [
        item({ id: "it_window", sourceServiceId: "svc_window" }),
        item({ id: "it_floor", sourceServiceId: "svc_floor" }),
      ],
    });

    planServicePackageServiceRemoval([a], "svc_window");

    expect(a.items.map((it) => it.id)).toEqual(["it_window", "it_floor"]);
  });

  it("returns no changes for an empty service id", () => {
    const a = pkg({ id: "pkg_a", items: [item({ id: "it_1", sourceServiceId: "svc_window" })] });
    expect(planServicePackageServiceRemoval([a], "  ").changed).toEqual([]);
  });
});
