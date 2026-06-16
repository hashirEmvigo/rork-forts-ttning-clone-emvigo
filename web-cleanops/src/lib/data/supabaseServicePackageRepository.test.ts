import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * SVCCAT — authoritative Service Package write path.
 *
 * Drives the real `upsertServicePackageToSupabase` against an in-memory Supabase
 * fake. Packages are global master data (company_id always null). Proves the row
 * shape, idempotency on `legacy_id`, the reversible archive status flip, and that
 * Supabase errors propagate so the caller never commits an optimistic UI change
 * that did not reach the server.
 */

type Row = Record<string, unknown>;

const mocks = vi.hoisted(() => {
  let failTable: string | null = null;

  class FakeClient {
    tables = new Map<string, Row[]>();
    private table(name: string): Row[] {
      if (!this.tables.has(name)) this.tables.set(name, []);
      return this.tables.get(name) as Row[];
    }
    from(name: string) {
      const rows = this.table(name);
      return {
        upsert: (incoming: Row | Row[], opts: { onConflict: string }) => {
          if (failTable === name) {
            return Promise.resolve({ error: { message: `simulated ${name} failure` } });
          }
          const list = Array.isArray(incoming) ? incoming : [incoming];
          const key = opts.onConflict;
          for (const row of list) {
            const idx = rows.findIndex((r) => r[key] === row[key]);
            if (idx >= 0) rows[idx] = { ...rows[idx], ...row };
            else rows.push({ ...row });
          }
          return Promise.resolve({ error: null });
        },
        select: (_columns: string) => {
          if (failTable === name) {
            return Promise.resolve({
              data: null,
              error: { message: `simulated ${name} failure` },
            });
          }
          // The real client projects columns; the fake returns full row clones
          // and lets the repository mappers pick the fields they need.
          return Promise.resolve({ data: rows.map((r) => ({ ...r })), error: null });
        },
      };
    }
    reset(): void {
      this.tables.clear();
      failTable = null;
    }
    failOn(table: string | null): void {
      failTable = table;
    }
  }

  return { client: new FakeClient() };
});

vi.mock("@/lib/supabase", () => ({
  supabase: mocks.client,
  isSupabaseConfigured: true,
}));

import { buildServicePackageItemFromService } from "@/lib/servicePackageItems";
import type { PayrollGroup, Service, ServiceCategory, ServicePackage } from "@/types";
import {
  listFullServicePackagesFromSupabase,
  removeServiceFromGlobalPackagesInSupabase,
  upsertServicePackageToSupabase,
} from "./supabaseServicePackageRepository";

function pkg(id: string, name = id, archived = false): ServicePackage {
  return {
    id,
    name,
    archived,
    items: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function rows(): Row[] {
  return mocks.client.tables.get("service_packages") ?? [];
}

/** A fully-specified GLOBAL catalog Service fixture; overrides win. */
function makeService(overrides: Partial<Service> = {}): Service {
  return {
    id: "svc_window",
    companyId: null,
    categoryId: "cat_cleaning",
    name: "Window cleaning",
    description: "Exterior + interior glass",
    articleNumber: "ART-100",
    serviceType: "cleaning",
    timeCodeId: "tc_1",
    timeCode: "T-100",
    unit: "hour",
    billingType: "hourly",
    serviceBasisType: "billable",
    payrollGroupId: "pg_working",
    deductionEligible: true,
    deductionType: "rut",
    price: 450,
    vat: 25,
    minimumPrice: 200,
    salesAccount: "3001",
    smsEnabled: true,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

function makeCategory(overrides: Partial<ServiceCategory> = {}): ServiceCategory {
  return {
    id: "cat_cleaning",
    companyId: null,
    name: "Cleaning",
    sortOrder: 0,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const payrollGroups: PayrollGroup[] = [
  {
    id: "pg_working",
    companyId: null,
    name: "Working time",
    groupType: "working_time",
    sortOrder: 0,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

beforeEach(() => {
  mocks.client.reset();
});

describe("SVCCAT · authoritative service package write", () => {
  it("writes a global, active row on create", async () => {
    await upsertServicePackageToSupabase(pkg("svc_pkg_a", "Alpha"));
    expect(rows()).toHaveLength(1);
    const row = rows()[0];
    expect(row.legacy_id).toBe("svc_pkg_a");
    expect(row.company_id).toBeNull();
    expect(row.company_legacy_id).toBeNull();
    expect(row.name).toBe("Alpha");
    expect(row.status).toBe("active");
    expect(row.deleted_at).toBeNull();
    expect((row.data as ServicePackage).id).toBe("svc_pkg_a");
  });

  it("is idempotent on legacy_id (edit updates the same row, no duplicate)", async () => {
    await upsertServicePackageToSupabase(pkg("svc_pkg_a", "Alpha"));
    await upsertServicePackageToSupabase(pkg("svc_pkg_a", "Alpha renamed"));
    expect(rows()).toHaveLength(1);
    expect(rows()[0].name).toBe("Alpha renamed");
  });

  it("derives status=archived from the archived flag and is reversible", async () => {
    await upsertServicePackageToSupabase(pkg("svc_pkg_a", "Alpha", true));
    expect(rows()[0].status).toBe("archived");
    expect(rows()[0].deleted_at).toBeNull();

    await upsertServicePackageToSupabase(pkg("svc_pkg_a", "Alpha", false));
    expect(rows()).toHaveLength(1);
    expect(rows()[0].status).toBe("active");
  });

  it("throws when Supabase returns an error so the caller can surface it", async () => {
    mocks.client.failOn("service_packages");
    await expect(
      upsertServicePackageToSupabase(pkg("svc_pkg_a")),
    ).rejects.toThrow(/Supabase write failed/);
    expect(rows()).toHaveLength(0);
  });
});

describe("SVCCAT · service package item round-trip (write → read)", () => {
  it("preserves a catalog-built item (snapshot name/category + source ids) across upsert and read-back", async () => {
    const item = buildServicePackageItemFromService(makeService(), makeCategory(), payrollGroups);
    const withItem: ServicePackage = {
      id: "svc_pkg_round",
      name: "Round Trip",
      description: "one catalog item",
      archived: false,
      items: [item],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    await upsertServicePackageToSupabase(withItem);
    const readBack = await listFullServicePackagesFromSupabase();

    expect(readBack).toHaveLength(1);
    expect(readBack[0].id).toBe("svc_pkg_round");
    expect(readBack[0].items).toHaveLength(1);

    const readItem = readBack[0].items[0];
    // Snapshot name + category survive the jsonb round-trip.
    expect(readItem.name).toBe("Window cleaning");
    expect(readItem.categoryName).toBe("Cleaning");
    // Source ids survive for traceability.
    expect(readItem.sourceServiceId).toBe("svc_window");
    expect(readItem.sourceCategoryId).toBe("cat_cleaning");
    // A representative selection of the full snapshot survives too.
    expect(readItem.price).toBe(450);
    expect(readItem.serviceBasisType).toBe("billable");
    expect(readItem.billingType).toBe("hourly");
  });

  it("keeps items when an existing package is edited (idempotent upsert) and read back", async () => {
    // Create empty, then edit to add a catalog item — the create → edit → reopen path.
    await upsertServicePackageToSupabase(pkg("svc_pkg_edit", "Editable"));
    const item = buildServicePackageItemFromService(makeService(), makeCategory(), payrollGroups);
    await upsertServicePackageToSupabase({
      ...pkg("svc_pkg_edit", "Editable"),
      items: [item],
      updatedAt: "2026-02-01T00:00:00.000Z",
    });

    const readBack = await listFullServicePackagesFromSupabase();
    expect(readBack).toHaveLength(1);
    expect(readBack[0].items).toHaveLength(1);
    expect(readBack[0].items[0].sourceServiceId).toBe("svc_window");
    expect(readBack[0].items[0].name).toBe("Window cleaning");
  });
});

describe("SVCCAT · removeServiceFromGlobalPackagesInSupabase (catalog hard-delete cleanup)", () => {
  /** Builds a controlled catalog snapshot item for a given source service. */
  function snapshot(sourceServiceId: string, name: string): ReturnType<typeof buildServicePackageItemFromService> {
    return buildServicePackageItemFromService(
      makeService({ id: sourceServiceId, name }),
      makeCategory(),
      payrollGroups,
    );
  }

  it("removes the deleted service from every global package and persists it (survives a re-read)", async () => {
    // pkg_multi: the deleted service + another service → keeps the other item.
    await upsertServicePackageToSupabase({
      ...pkg("pkg_multi", "Multi"),
      items: [snapshot("svc_window", "Window cleaning"), snapshot("svc_floor", "Floor care")],
    });
    // pkg_only: only the deleted service → kept, but emptied.
    await upsertServicePackageToSupabase({
      ...pkg("pkg_only", "Only"),
      items: [snapshot("svc_window", "Window cleaning")],
    });
    // pkg_other: unrelated service → untouched.
    await upsertServicePackageToSupabase({
      ...pkg("pkg_other", "Other"),
      items: [snapshot("svc_floor", "Floor care")],
    });

    const changed = await removeServiceFromGlobalPackagesInSupabase("svc_window");
    expect(changed.map((p) => p.id).sort()).toEqual(["pkg_multi", "pkg_only"]);

    // Re-read simulates a hard refresh reading the canonical Supabase rows.
    const readBack = await listFullServicePackagesFromSupabase();
    const byId = new Map(readBack.map((p) => [p.id, p]));

    // Deleted service is gone everywhere; other items survive.
    expect(byId.get("pkg_multi")?.items.map((it) => it.sourceServiceId)).toEqual(["svc_floor"]);
    // Emptied package is kept (never deleted), now with zero items.
    expect(byId.get("pkg_only")).toBeDefined();
    expect(byId.get("pkg_only")?.items).toHaveLength(0);
    // Unrelated package is untouched.
    expect(byId.get("pkg_other")?.items.map((it) => it.sourceServiceId)).toEqual(["svc_floor"]);
    // No package row was ever deleted.
    expect(readBack).toHaveLength(3);
  });

  it("preserves legacy free-text items while removing the controlled orphan", async () => {
    const legacyItem = {
      ...snapshot("svc_window", "Window cleaning"),
      id: "it_legacy",
      name: "Old free-text line",
      sourceServiceId: undefined,
      sourceCategoryId: undefined,
    };
    await upsertServicePackageToSupabase({
      ...pkg("pkg_mixed", "Mixed"),
      items: [snapshot("svc_window", "Window cleaning"), legacyItem],
    });

    await removeServiceFromGlobalPackagesInSupabase("svc_window");

    const readBack = await listFullServicePackagesFromSupabase();
    expect(readBack[0].items.map((it) => it.id)).toEqual(["it_legacy"]);
  });

  it("never touches the company services table (company copies are independent)", async () => {
    // A company-owned copied service lives in a SEPARATE table; the cleanup must
    // only ever read/write `service_packages`.
    const companyServices = mocks.client.tables.get("services") ?? [];
    companyServices.push({ legacy_id: "svc_company_copy", company_legacy_id: "cmp_nordlys", name: "Window cleaning" });
    mocks.client.tables.set("services", companyServices);

    await upsertServicePackageToSupabase({
      ...pkg("pkg_a", "Alpha"),
      items: [snapshot("svc_window", "Window cleaning")],
    });

    await removeServiceFromGlobalPackagesInSupabase("svc_window");

    expect(mocks.client.tables.get("services")).toEqual([
      { legacy_id: "svc_company_copy", company_legacy_id: "cmp_nordlys", name: "Window cleaning" },
    ]);
  });

  it("is a no-op for an empty service id", async () => {
    await upsertServicePackageToSupabase({
      ...pkg("pkg_a", "Alpha"),
      items: [snapshot("svc_window", "Window cleaning")],
    });
    const changed = await removeServiceFromGlobalPackagesInSupabase("   ");
    expect(changed).toEqual([]);
    const readBack = await listFullServicePackagesFromSupabase();
    expect(readBack[0].items).toHaveLength(1);
  });
});
