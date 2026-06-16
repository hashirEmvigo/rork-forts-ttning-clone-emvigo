import { describe, expect, it } from "vitest";

import { removeGlobalCatalogService } from "@/lib/catalogHardDelete";
import type { Service } from "@/types";

/**
 * SVCCAT global-catalog hard delete — isolation guarantees.
 *
 * Proves that permanently removing a GLOBAL template service never affects
 * company-owned copies (independent rows, even when they share a name) and that
 * the destructive path refuses non-global rows entirely.
 */

function service(overrides: Partial<Service> & Pick<Service, "id" | "companyId">): Service {
  return {
    categoryId: null,
    name: "Window cleaning",
    billingType: "fixed",
    serviceBasisType: "billable",
    deductionEligible: false,
    deductionType: "none",
    smsEnabled: false,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("removeGlobalCatalogService", () => {
  it("removes only the targeted global service row", () => {
    const services = [
      service({ id: "svc_global_a", companyId: null }),
      service({ id: "svc_global_b", companyId: null, name: "Floor care" }),
    ];

    const result = removeGlobalCatalogService(services, "svc_global_a");

    expect(result.ok).toBe(true);
    expect(result.next?.map((s) => s.id)).toEqual(["svc_global_b"]);
    // Input array is never mutated.
    expect(services).toHaveLength(2);
  });

  it("keeps a company-owned copy that shares the same name after the global is deleted", () => {
    const services = [
      service({ id: "svc_global", companyId: null, name: "Window cleaning" }),
      // A company copied the global template — independent row, same name.
      service({ id: "svc_company_copy", companyId: "cmp_nordlys", name: "Window cleaning" }),
    ];

    const result = removeGlobalCatalogService(services, "svc_global");

    expect(result.ok).toBe(true);
    expect(result.next).toHaveLength(1);
    const survivor = result.next?.[0];
    expect(survivor?.id).toBe("svc_company_copy");
    expect(survivor?.companyId).toBe("cmp_nordlys");
    expect(survivor?.name).toBe("Window cleaning");
  });

  it("leaves every other company's copies untouched", () => {
    const services = [
      service({ id: "svc_global", companyId: null }),
      service({ id: "svc_copy_a", companyId: "cmp_a" }),
      service({ id: "svc_copy_b", companyId: "cmp_b" }),
    ];

    const result = removeGlobalCatalogService(services, "svc_global");

    expect(result.ok).toBe(true);
    expect(result.next?.map((s) => s.id).sort()).toEqual(["svc_copy_a", "svc_copy_b"]);
  });

  it("refuses to hard-delete a company-owned service", () => {
    const services = [service({ id: "svc_company", companyId: "cmp_nordlys" })];

    const result = removeGlobalCatalogService(services, "svc_company");

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/only global catalog services/i);
    expect(result.next).toBeUndefined();
  });

  it("returns an error when the service id is unknown", () => {
    const result = removeGlobalCatalogService([service({ id: "svc_global", companyId: null })], "missing");

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not found/i);
    expect(result.next).toBeUndefined();
  });
});
