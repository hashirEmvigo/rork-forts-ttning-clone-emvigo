import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
  loadCompanyUuidMap: vi.fn(),
  // delete().eq().is().is().select() chain for the global hard-delete path.
  del: vi.fn(),
  delEq: vi.fn(),
  delIs: vi.fn(),
  delSelect: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: vi.fn((table: string) => {
      if (table !== "services") throw new Error(`Unexpected table ${table}`);
      return {
        upsert: mocks.upsert,
        select: mocks.select,
        delete: mocks.del,
      };
    }),
  },
}));

vi.mock("./customerMigration", () => ({
  loadCompanyUuidMap: mocks.loadCompanyUuidMap,
}));

import {
  createServiceInSupabase,
  hardDeleteGlobalServiceInSupabase,
  updateServiceInSupabase,
} from "./supabaseServiceRepository";

const COMPANY = "cmp_stad";
const COMPANY_UUID = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadCompanyUuidMap.mockResolvedValue(new Map([[COMPANY, COMPANY_UUID]]));
  mocks.upsert.mockResolvedValue({ error: null });
  mocks.select.mockReturnValue({ eq: mocks.eq });
  mocks.eq.mockReturnValue({ maybeSingle: mocks.maybeSingle });
  mocks.del.mockReturnValue({ eq: mocks.delEq });
  mocks.delEq.mockReturnValue({ is: mocks.delIs });
  mocks.delIs.mockReturnValue({ is: mocks.delIs, select: mocks.delSelect });
  mocks.delSelect.mockResolvedValue({ data: [{ legacy_id: "svc_global" }], error: null });
});

describe("supabaseServiceRepository CORE-WRITES-A1", () => {
  it("creates company-scoped services with category_legacy_id and no browser storage", async () => {
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem");
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const sessionGetSpy = vi.spyOn(sessionStorage, "getItem");
    const sessionSetSpy = vi.spyOn(sessionStorage, "setItem");

    const saved = await createServiceInSupabase({
      companyId: COMPANY,
      categoryId: "svc_cat_1",
      name: "Smoke Service",
      billingType: "fixed",
      serviceBasisType: "billable",
      deductionEligible: false,
      deductionType: "none",
      smsEnabled: false,
      createdBy: "usr_admin",
    });

    expect(saved.companyId).toBe(COMPANY);
    expect(saved.categoryId).toBe("svc_cat_1");
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    const rows = mocks.upsert.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({
      company_id: COMPANY_UUID,
      company_legacy_id: COMPANY,
      category_legacy_id: "svc_cat_1",
      name: "Smoke Service",
      status: "active",
      deleted_at: null,
    });
    expect(rows[0].data).toMatchObject({
      companyId: COMPANY,
      categoryId: "svc_cat_1",
      name: "Smoke Service",
      createdBy: "usr_admin",
    });
    expect(mocks.upsert.mock.calls[0][1]).toEqual({ onConflict: "legacy_id" });
    expect(getItemSpy).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(sessionGetSpy).not.toHaveBeenCalled();
    expect(sessionSetSpy).not.toHaveBeenCalled();

    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
    sessionGetSpy.mockRestore();
    sessionSetSpy.mockRestore();
  });

  it("creates Super Admin global services with null company scope", async () => {
    await createServiceInSupabase({
      companyId: null,
      categoryId: null,
      name: "Global Service",
      billingType: "fixed",
      serviceBasisType: "billable",
      deductionEligible: false,
      deductionType: "none",
      smsEnabled: false,
    });

    const rows = mocks.upsert.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({
      company_id: null,
      company_legacy_id: null,
      category_legacy_id: null,
      name: "Global Service",
    });
  });

  it("fails closed when a company-scoped service has no Supabase company UUID", async () => {
    mocks.loadCompanyUuidMap.mockResolvedValueOnce(new Map());

    await expect(
      createServiceInSupabase({
        companyId: COMPANY,
        categoryId: null,
        name: "Blocked Service",
        billingType: "fixed",
        serviceBasisType: "billable",
        deductionEligible: false,
        deductionType: "none",
        smsEnabled: false,
      }),
    ).rejects.toThrow(/No Supabase company found/);

    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("updates services only after reading the existing row in the exact scope", async () => {
    mocks.maybeSingle.mockResolvedValueOnce({
      error: null,
      data: {
        company_legacy_id: COMPANY,
        deleted_at: null,
        data: {
          id: "svc_1",
          companyId: COMPANY,
          categoryId: "svc_cat_old",
          name: "Old Service",
          billingType: "fixed",
          serviceBasisType: "billable",
          deductionEligible: false,
          deductionType: "none",
          smsEnabled: false,
          status: "active",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    });

    const updated = await updateServiceInSupabase(COMPANY, "svc_1", {
      name: "Updated Service",
      categoryId: "svc_cat_new",
    });

    expect(updated.name).toBe("Updated Service");
    expect(updated.categoryId).toBe("svc_cat_new");
    const rows = mocks.upsert.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({
      legacy_id: "svc_1",
      company_id: COMPANY_UUID,
      company_legacy_id: COMPANY,
      category_legacy_id: "svc_cat_new",
      name: "Updated Service",
    });
  });
});

describe("hardDeleteGlobalServiceInSupabase (SVCCAT global hard delete)", () => {
  it("permanently DELETEs a global service scoped to a null company and returns the row count", async () => {
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem");
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

    const removed = await hardDeleteGlobalServiceInSupabase("svc_global");

    expect(removed).toBe(1);
    expect(mocks.del).toHaveBeenCalledTimes(1);
    expect(mocks.delEq).toHaveBeenCalledWith("legacy_id", "svc_global");
    // Pinned to GLOBAL rows only: BOTH company scopes must be null so a
    // company-owned copy (which carries both) can never be reached.
    expect(mocks.delIs).toHaveBeenCalledWith("company_id", null);
    expect(mocks.delIs).toHaveBeenCalledWith("company_legacy_id", null);
    expect(mocks.delSelect).toHaveBeenCalledWith("legacy_id");
    // Never upserts (an upsert would write deleted_at = null and "undelete").
    expect(mocks.upsert).not.toHaveBeenCalled();
    // Authoritative path performs no browser storage I/O.
    expect(getItemSpy).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();

    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
  });

  it("returns 0 when the delete affects no rows (RLS block / already gone)", async () => {
    mocks.delSelect.mockResolvedValueOnce({ data: [], error: null });

    const removed = await hardDeleteGlobalServiceInSupabase("svc_global");

    expect(removed).toBe(0);
    expect(mocks.del).toHaveBeenCalledTimes(1);
  });

  it("throws when Supabase returns an error (caller keeps the row)", async () => {
    mocks.delSelect.mockResolvedValueOnce({
      data: null,
      error: { message: "permission denied for table services" },
    });

    await expect(hardDeleteGlobalServiceInSupabase("svc_global")).rejects.toThrow(
      /permission denied/,
    );
  });

  it("rejects an empty service id without calling Supabase", async () => {
    await expect(hardDeleteGlobalServiceInSupabase("   ")).rejects.toThrow(/requires a service id/);
    expect(mocks.del).not.toHaveBeenCalled();
  });
});
