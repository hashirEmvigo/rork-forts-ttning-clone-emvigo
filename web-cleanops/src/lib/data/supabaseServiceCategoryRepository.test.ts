import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
  loadCompanyUuidMap: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: vi.fn((table: string) => {
      if (table !== "service_categories") throw new Error(`Unexpected table ${table}`);
      return {
        upsert: mocks.upsert,
        select: mocks.select,
      };
    }),
  },
}));

vi.mock("./customerMigration", () => ({
  loadCompanyUuidMap: mocks.loadCompanyUuidMap,
}));

import {
  createServiceCategoryInSupabase,
  updateServiceCategoryInSupabase,
} from "./supabaseServiceCategoryRepository";

const COMPANY = "cmp_stad";
const COMPANY_UUID = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadCompanyUuidMap.mockResolvedValue(new Map([[COMPANY, COMPANY_UUID]]));
  mocks.upsert.mockResolvedValue({ error: null });
  mocks.select.mockReturnValue({ eq: mocks.eq });
  mocks.eq.mockReturnValue({ maybeSingle: mocks.maybeSingle });
});

describe("supabaseServiceCategoryRepository CORE-WRITES-A1", () => {
  it("creates company-scoped categories through Supabase only", async () => {
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem");
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const sessionGetSpy = vi.spyOn(sessionStorage, "getItem");
    const sessionSetSpy = vi.spyOn(sessionStorage, "setItem");

    const saved = await createServiceCategoryInSupabase({
      companyId: COMPANY,
      name: "Smoke Category",
      description: "Smoke description",
      categoryType: "recurring_service",
      sortOrder: 4,
      createdBy: "usr_admin",
    });

    expect(saved.companyId).toBe(COMPANY);
    expect(saved.name).toBe("Smoke Category");
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    const rows = mocks.upsert.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({
      company_id: COMPANY_UUID,
      company_legacy_id: COMPANY,
      name: "Smoke Category",
      status: "active",
      deleted_at: null,
    });
    expect(rows[0].data).toMatchObject({
      companyId: COMPANY,
      name: "Smoke Category",
      categoryType: "recurring_service",
      sortOrder: 4,
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

  it("creates Super Admin global categories with null company scope", async () => {
    await createServiceCategoryInSupabase({
      companyId: null,
      name: "Global Category",
    });

    const rows = mocks.upsert.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({
      company_id: null,
      company_legacy_id: null,
      name: "Global Category",
    });
  });

  it("fails closed when a company-scoped category has no Supabase company UUID", async () => {
    mocks.loadCompanyUuidMap.mockResolvedValueOnce(new Map());

    await expect(
      createServiceCategoryInSupabase({ companyId: COMPANY, name: "Blocked Category" }),
    ).rejects.toThrow(/No Supabase company found/);

    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("updates categories only after reading the existing row in the exact scope", async () => {
    mocks.maybeSingle.mockResolvedValueOnce({
      error: null,
      data: {
        company_legacy_id: COMPANY,
        deleted_at: null,
        data: {
          id: "svc_cat_1",
          companyId: COMPANY,
          name: "Old Category",
          sortOrder: 0,
          status: "active",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    });

    const updated = await updateServiceCategoryInSupabase(COMPANY, "svc_cat_1", {
      name: "Updated Category",
      description: "Updated",
    });

    expect(updated.name).toBe("Updated Category");
    const rows = mocks.upsert.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({
      legacy_id: "svc_cat_1",
      company_id: COMPANY_UUID,
      company_legacy_id: COMPANY,
      name: "Updated Category",
    });
  });
});
