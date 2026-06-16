import { beforeEach, describe, expect, it } from "vitest";
import type { User } from "@/types";
import type { ProcessedImage } from "./mediaProcessing";
import {
  MEDIA_MANAGE_PERMISSION,
  attachMediaUsage,
  createMediaAsset,
  deleteMediaAsset,
  detachMediaUsage,
  isMediaVisibleInModule,
  listMediaAssets,
  listMediaForEntity,
  listMediaForModule,
  resolveMediaUsage,
  resolveMediaVisibility,
  summarizeCompanyMediaUsage,
  updateMediaAssetMeta,
} from "./mediaStore";

const PERMS = [MEDIA_MANAGE_PERMISSION];

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "u_admin",
    name: "Admin",
    email: "admin@a.test",
    role: "company_admin",
    companyId: "co_a",
    status: "active",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeProcessed(bytes = 30_000): ProcessedImage {
  const layer = (n: string, b: number) => ({
    layer: "micro" as const,
    url: `data:image/webp;base64,${n}`,
    width: 10,
    height: 10,
    bytes: b,
  });
  return {
    micro: layer("micro", Math.round(bytes * 0.1)),
    hover: { ...layer("hover", Math.round(bytes * 0.3)), layer: "hover" },
    preview: { ...layer("preview", Math.round(bytes * 0.6)), layer: "preview" },
    sourceWidth: 4000,
    sourceHeight: 3000,
    totalBytes: bytes,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe("createMediaAsset", () => {
  it("stores only the three layers and never an original", () => {
    const user = makeUser();
    const asset = createMediaAsset(user, PERMS, {
      companyId: "co_a",
      category: "work_order",
      entityType: "work_order",
      entityId: "wo_1",
      processed: makeProcessed(),
    });
    expect(asset).not.toBeNull();
    expect(asset?.microThumbnailUrl).toContain("micro");
    expect(asset?.hoverThumbnailUrl).toContain("hover");
    expect(asset?.previewImageUrl).toContain("preview");
    expect(asset?.width).toBe(4000);
    expect(asset?.fileSize).toBe(30_000);
    expect(asset?.uploadedByRole).toBe("company_admin");
    expect(Object.keys(asset ?? {})).not.toContain("originalUrl");
  });

  it("rejects when the uploader lacks the manage permission", () => {
    const asset = createMediaAsset(makeUser(), [], {
      companyId: "co_a",
      category: "work_order",
      entityType: "work_order",
      entityId: "wo_1",
      processed: makeProcessed(),
    });
    expect(asset).toBeNull();
  });

  it("rejects cross-company writes for non-super-admins", () => {
    const asset = createMediaAsset(makeUser({ companyId: "co_a" }), PERMS, {
      companyId: "co_b",
      category: "work_order",
      entityType: "work_order",
      entityId: "wo_1",
      processed: makeProcessed(),
    });
    expect(asset).toBeNull();
  });

  it("rejects a category that cannot attach to the entity type", () => {
    const asset = createMediaAsset(makeUser(), PERMS, {
      companyId: "co_a",
      category: "employee",
      entityType: "work_order",
      entityId: "wo_1",
      processed: makeProcessed(),
    });
    expect(asset).toBeNull();
  });
});

describe("listMediaForEntity", () => {
  it("returns only assets for the requested entity, newest-first", () => {
    const user = makeUser();
    createMediaAsset(user, PERMS, {
      companyId: "co_a",
      category: "work_order",
      entityType: "work_order",
      entityId: "wo_1",
      processed: makeProcessed(),
    });
    createMediaAsset(user, PERMS, {
      companyId: "co_a",
      category: "work_order",
      entityType: "work_order",
      entityId: "wo_2",
      processed: makeProcessed(),
    });
    const forWo1 = listMediaForEntity(user, PERMS, "work_order", "wo_1");
    expect(forWo1).toHaveLength(1);
    expect(forWo1[0].entityId).toBe("wo_1");
  });

  it("enforces tenant isolation between companies", () => {
    const adminA = makeUser({ id: "a", companyId: "co_a" });
    const adminB = makeUser({ id: "b", companyId: "co_b" });
    createMediaAsset(adminA, PERMS, {
      companyId: "co_a",
      category: "customer",
      entityType: "customer",
      entityId: "cust_1",
      processed: makeProcessed(),
    });
    expect(listMediaForEntity(adminB, PERMS, "customer", "cust_1")).toHaveLength(0);
    expect(listMediaForEntity(adminA, PERMS, "customer", "cust_1")).toHaveLength(1);
  });

  it("lets a super admin read across companies", () => {
    const adminA = makeUser({ id: "a", companyId: "co_a" });
    const superAdmin = makeUser({ id: "s", role: "super_admin", companyId: null });
    createMediaAsset(adminA, PERMS, {
      companyId: "co_a",
      category: "customer",
      entityType: "customer",
      entityId: "cust_1",
      processed: makeProcessed(),
    });
    expect(listMediaForEntity(superAdmin, PERMS, "customer", "cust_1")).toHaveLength(1);
  });
});

describe("deleteMediaAsset", () => {
  it("removes an asset the requester can read", () => {
    const user = makeUser();
    const asset = createMediaAsset(user, PERMS, {
      companyId: "co_a",
      category: "material",
      entityType: "material",
      entityId: "mat_1",
      processed: makeProcessed(),
    });
    expect(deleteMediaAsset(user, PERMS, asset!.id)).toBe(true);
    expect(listMediaForEntity(user, PERMS, "material", "mat_1")).toHaveLength(0);
  });

  it("refuses deletion across company scope", () => {
    const adminA = makeUser({ id: "a", companyId: "co_a" });
    const adminB = makeUser({ id: "b", companyId: "co_b" });
    const asset = createMediaAsset(adminA, PERMS, {
      companyId: "co_a",
      category: "material",
      entityType: "material",
      entityId: "mat_1",
      processed: makeProcessed(),
    });
    expect(deleteMediaAsset(adminB, PERMS, asset!.id)).toBe(false);
  });
});

describe("usage & visibility model", () => {
  it("applies category defaults for usedIn and visibleFor on upload", () => {
    const user = makeUser();
    const asset = createMediaAsset(user, PERMS, {
      companyId: "co_a",
      category: "alarm",
      entityType: "customer",
      entityId: "cust_1",
      processed: makeProcessed(),
    });
    expect(asset?.usedIn).toEqual([
      "work_order",
      "cleaning_protocol",
      "employee_app",
    ]);
    expect(asset?.visibleFor).toEqual([
      "super_admin",
      "company_admin",
      "scheduler",
      "employee",
    ]);
  });

  it("hides alarm images from the customer by default", () => {
    const user = makeUser();
    const asset = createMediaAsset(user, PERMS, {
      companyId: "co_a",
      category: "alarm",
      entityType: "customer",
      entityId: "cust_1",
      processed: makeProcessed(),
    })!;
    expect(resolveMediaVisibility(asset)).not.toContain("customer");
    expect(isMediaVisibleInModule(asset, "employee_app", "employee")).toBe(true);
    expect(isMediaVisibleInModule(asset, "customer_portal", "customer")).toBe(
      false,
    );
  });

  it("shows cleaning_result images to the customer by default", () => {
    const user = makeUser();
    const asset = createMediaAsset(user, PERMS, {
      companyId: "co_a",
      category: "cleaning_result",
      entityType: "customer",
      entityId: "cust_1",
      processed: makeProcessed(),
    })!;
    expect(resolveMediaVisibility(asset)).toContain("customer");
    expect(isMediaVisibleInModule(asset, "customer_portal", "customer")).toBe(
      true,
    );
  });

  it("honours explicit usedIn / visibleFor overrides", () => {
    const user = makeUser();
    const asset = createMediaAsset(user, PERMS, {
      companyId: "co_a",
      category: "customer",
      entityType: "customer",
      entityId: "cust_1",
      processed: makeProcessed(),
      usedIn: ["work_order"],
      visibleFor: ["customer"],
    })!;
    expect(asset.usedIn).toEqual(["work_order"]);
    expect(asset.visibleFor).toEqual(["customer"]);
  });

  it("filters by usedIn and visibleFor", () => {
    const user = makeUser();
    createMediaAsset(user, PERMS, {
      companyId: "co_a",
      category: "alarm",
      entityType: "customer",
      entityId: "cust_1",
      processed: makeProcessed(),
    });
    createMediaAsset(user, PERMS, {
      companyId: "co_a",
      category: "cleaning_result",
      entityType: "customer",
      entityId: "cust_1",
      processed: makeProcessed(),
    });
    // Only cleaning_result is visible to the customer.
    const customerVisible = listMediaAssets(user, PERMS, {
      entityType: "customer",
      visibleFor: "customer",
    });
    expect(customerVisible).toHaveLength(1);
    expect(customerVisible[0].category).toBe("cleaning_result");
    // Both are used on work orders.
    const onWorkOrder = listMediaAssets(user, PERMS, {
      entityType: "customer",
      usedIn: "work_order",
    });
    expect(onWorkOrder).toHaveLength(2);
  });

  it("gives legacy assets without visibility data safe category defaults", () => {
    // Simulate a pre-model asset: no usedIn / visibleFor fields.
    const legacy = {
      id: "media_legacy",
      companyId: "co_a",
      category: "alarm" as const,
      entityType: "customer" as const,
      entityId: "cust_1",
      uploadedBy: "u_admin",
      uploadedByRole: "company_admin" as const,
      microThumbnailUrl: "data:image/webp;base64,m",
      hoverThumbnailUrl: "data:image/webp;base64,h",
      previewImageUrl: "data:image/webp;base64,p",
      width: 100,
      height: 100,
      fileSize: 1000,
      createdAt: new Date().toISOString(),
    };
    localStorage.setItem("cleanops.mediaAssets", JSON.stringify([legacy]));
    const user = makeUser();
    const [asset] = listMediaForEntity(user, PERMS, "customer", "cust_1");
    expect(asset.usedIn).toBeUndefined();
    expect(resolveMediaUsage(asset)).toContain("employee_app");
    expect(resolveMediaVisibility(asset)).not.toContain("customer");
  });

  it("updates metadata in place without duplicating the asset", () => {
    const user = makeUser();
    const asset = createMediaAsset(user, PERMS, {
      companyId: "co_a",
      category: "alarm",
      entityType: "customer",
      entityId: "cust_1",
      processed: makeProcessed(),
    })!;
    const updated = updateMediaAssetMeta(user, PERMS, asset.id, {
      visibleFor: ["customer"],
    });
    expect(updated?.visibleFor).toEqual(["customer"]);
    // Still a single asset.
    expect(listMediaForEntity(user, PERMS, "customer", "cust_1")).toHaveLength(1);
  });

  it("refuses a category that cannot attach to the entity on update", () => {
    const user = makeUser();
    const asset = createMediaAsset(user, PERMS, {
      companyId: "co_a",
      category: "customer",
      entityType: "customer",
      entityId: "cust_1",
      processed: makeProcessed(),
    })!;
    // `employee` cannot attach to a customer entity.
    expect(
      updateMediaAssetMeta(user, PERMS, asset.id, { category: "employee" }),
    ).toBeNull();
  });

  it("refuses metadata updates across company scope", () => {
    const adminA = makeUser({ id: "a", companyId: "co_a" });
    const adminB = makeUser({ id: "b", companyId: "co_b" });
    const asset = createMediaAsset(adminA, PERMS, {
      companyId: "co_a",
      category: "customer",
      entityType: "customer",
      entityId: "cust_1",
      processed: makeProcessed(),
    })!;
    expect(
      updateMediaAssetMeta(adminB, PERMS, asset.id, { visibleFor: ["customer"] }),
    ).toBeNull();
  });
});

describe("work order images (consumer of customer media)", () => {
  it("upload from a work order creates exactly one customer-owned asset used in work_order", () => {
    const user = makeUser();
    // Upload mirrors the WorkOrderImages binding: owned by the customer.
    const asset = createMediaAsset(user, PERMS, {
      companyId: "co_a",
      category: "work_order",
      entityType: "customer",
      entityId: "cust_1",
      processed: makeProcessed(),
    })!;
    expect(asset.entityType).toBe("customer");
    expect(asset.entityId).toBe("cust_1");
    expect(resolveMediaUsage(asset)).toContain("work_order");
    // Exactly one MediaAsset exists for the customer.
    expect(listMediaForEntity(user, PERMS, "customer", "cust_1")).toHaveLength(1);
  });

  it("attaching an existing image adds work_order without creating a new asset", () => {
    const user = makeUser();
    // A customer-category image is NOT used in work_order by default.
    const general = createMediaAsset(user, PERMS, {
      companyId: "co_a",
      category: "customer",
      entityType: "customer",
      entityId: "cust_1",
      processed: makeProcessed(),
    })!;
    expect(resolveMediaUsage(general)).not.toContain("work_order");
    const updated = attachMediaUsage(user, PERMS, general.id, "work_order")!;
    expect(resolveMediaUsage(updated)).toContain("work_order");
    // No duplicate asset was created — still a single stored asset.
    expect(listMediaForEntity(user, PERMS, "customer", "cust_1")).toHaveLength(1);
  });

  it("attaching is idempotent", () => {
    const user = makeUser();
    const asset = createMediaAsset(user, PERMS, {
      companyId: "co_a",
      category: "customer",
      entityType: "customer",
      entityId: "cust_1",
      processed: makeProcessed(),
    })!;
    attachMediaUsage(user, PERMS, asset.id, "work_order");
    const second = attachMediaUsage(user, PERMS, asset.id, "work_order")!;
    expect(
      resolveMediaUsage(second).filter((u) => u === "work_order"),
    ).toHaveLength(1);
  });

  it("detaching removes the work_order reference but preserves the asset", () => {
    const user = makeUser();
    const asset = createMediaAsset(user, PERMS, {
      companyId: "co_a",
      category: "work_order",
      entityType: "customer",
      entityId: "cust_1",
      processed: makeProcessed(),
    })!;
    const detached = detachMediaUsage(user, PERMS, asset.id, "work_order")!;
    expect(resolveMediaUsage(detached)).not.toContain("work_order");
    // The customer still owns the asset — nothing was deleted.
    const remaining = listMediaForEntity(user, PERMS, "customer", "cust_1");
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(asset.id);
  });

  it("lists only work_order assets visible to the viewer's role", () => {
    const user = makeUser();
    // Visible internally (work_order default has no customer).
    createMediaAsset(user, PERMS, {
      companyId: "co_a",
      category: "work_order",
      entityType: "customer",
      entityId: "cust_1",
      processed: makeProcessed(),
    });
    // Visible to the customer too.
    createMediaAsset(user, PERMS, {
      companyId: "co_a",
      category: "cleaning_result",
      entityType: "customer",
      entityId: "cust_1",
      processed: makeProcessed(),
    });
    // Not attached to work_order at all.
    createMediaAsset(user, PERMS, {
      companyId: "co_a",
      category: "customer",
      entityType: "customer",
      entityId: "cust_1",
      processed: makeProcessed(),
    });
    const adminView = listMediaForModule(user, PERMS, {
      entityType: "customer",
      entityId: "cust_1",
      usage: "work_order",
      viewerRole: "company_admin",
    });
    expect(adminView).toHaveLength(2);
    const customerView = listMediaForModule(user, PERMS, {
      entityType: "customer",
      entityId: "cust_1",
      usage: "work_order",
      viewerRole: "customer",
    });
    // Only the cleaning_result is visible to the customer.
    expect(customerView).toHaveLength(1);
    expect(customerView[0].category).toBe("cleaning_result");
  });

  it("preserves customer ownership across attach and detach", () => {
    const user = makeUser();
    const asset = createMediaAsset(user, PERMS, {
      companyId: "co_a",
      category: "customer",
      entityType: "customer",
      entityId: "cust_1",
      processed: makeProcessed(),
    })!;
    attachMediaUsage(user, PERMS, asset.id, "work_order");
    detachMediaUsage(user, PERMS, asset.id, "work_order");
    const [stored] = listMediaForEntity(user, PERMS, "customer", "cust_1");
    expect(stored.entityType).toBe("customer");
    expect(stored.entityId).toBe("cust_1");
  });

  it("refuses attach/detach across company scope", () => {
    const adminA = makeUser({ id: "a", companyId: "co_a" });
    const adminB = makeUser({ id: "b", companyId: "co_b" });
    const asset = createMediaAsset(adminA, PERMS, {
      companyId: "co_a",
      category: "customer",
      entityType: "customer",
      entityId: "cust_1",
      processed: makeProcessed(),
    })!;
    expect(attachMediaUsage(adminB, PERMS, asset.id, "work_order")).toBeNull();
    expect(detachMediaUsage(adminB, PERMS, asset.id, "work_order")).toBeNull();
  });
});

describe("summarizeCompanyMediaUsage", () => {
  it("aggregates count and stored bytes for a company", () => {
    const user = makeUser();
    createMediaAsset(user, PERMS, {
      companyId: "co_a",
      category: "customer",
      entityType: "customer",
      entityId: "cust_1",
      processed: makeProcessed(20_000),
    });
    createMediaAsset(user, PERMS, {
      companyId: "co_a",
      category: "work_order",
      entityType: "work_order",
      entityId: "wo_1",
      processed: makeProcessed(40_000),
    });
    const summary = summarizeCompanyMediaUsage(user, PERMS, "co_a");
    expect(summary.count).toBe(2);
    expect(summary.storedBytes).toBe(60_000);
  });

  it("breaks usage down by category, largest first", () => {
    const user = makeUser();
    createMediaAsset(user, PERMS, {
      companyId: "co_a",
      category: "customer",
      entityType: "customer",
      entityId: "cust_1",
      processed: makeProcessed(20_000),
    });
    createMediaAsset(user, PERMS, {
      companyId: "co_a",
      category: "work_order",
      entityType: "work_order",
      entityId: "wo_1",
      processed: makeProcessed(40_000),
    });
    createMediaAsset(user, PERMS, {
      companyId: "co_a",
      category: "work_order",
      entityType: "work_order",
      entityId: "wo_2",
      processed: makeProcessed(10_000),
    });
    const summary = summarizeCompanyMediaUsage(user, PERMS, "co_a");
    expect(summary.byCategory).toHaveLength(2);
    // work_order (50k across 2) sorts ahead of customer (20k across 1).
    expect(summary.byCategory[0]).toEqual({
      category: "work_order",
      count: 2,
      storedBytes: 50_000,
    });
    expect(summary.byCategory[1]).toEqual({
      category: "customer",
      count: 1,
      storedBytes: 20_000,
    });
  });
});
