import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  or: vi.fn(),
  eq: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    rpc: mocks.rpc,
    from: mocks.from,
  },
}));

import {
  configureArticleNumberSeries,
  generateArticleNumber,
  listArticleNumberSeriesFromSupabase,
  validateManualArticleNumber,
} from "./supabaseArticleNumberSeriesRepository";

const SERIES_ROW = {
  scope_kind: "global" as const,
  company_legacy_id: null,
  category_legacy_id: "cat_recurring",
  range_start: 1001,
  range_end: 1999,
  next_value: 1003,
  is_active: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  // from(...).select(...).or(...) / .eq(...) read chain.
  mocks.from.mockReturnValue({ select: mocks.select });
  mocks.select.mockReturnValue({ or: mocks.or, eq: mocks.eq });
  mocks.or.mockResolvedValue({ data: [SERIES_ROW], error: null });
  mocks.eq.mockResolvedValue({ data: [SERIES_ROW], error: null });
});

describe("supabaseArticleNumberSeriesRepository", () => {
  it("generate_article_number calls the RPC with the scope and returns the issued text", async () => {
    mocks.rpc.mockResolvedValue({ data: "1003", error: null });

    const issued = await generateArticleNumber({
      scopeKind: "company",
      companyLegacyId: "cmp_stad",
      categoryId: "cat_recurring",
    });

    expect(issued).toBe("1003");
    expect(mocks.rpc).toHaveBeenCalledWith("generate_article_number", {
      p_scope_kind: "company",
      p_company_legacy_id: "cmp_stad",
      p_category_legacy_id: "cat_recurring",
    });
  });

  it("generate_article_number surfaces RPC errors (e.g. range exhausted)", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "range exhausted" } });
    await expect(
      generateArticleNumber({ scopeKind: "global", companyLegacyId: null, categoryId: "cat_x" }),
    ).rejects.toThrow("range exhausted");
  });

  it("validate_manual_article_number forwards inputs and parses the structured result", async () => {
    mocks.rpc.mockResolvedValue({
      data: { ok: false, code: "out_of_range", message: "Article number must be within 1001–1999." },
      error: null,
    });

    const result = await validateManualArticleNumber({
      scope: { scopeKind: "global", companyLegacyId: null, categoryId: "cat_recurring" },
      articleNumber: "5000",
      excludeServiceId: "svc_1",
    });

    expect(result).toEqual({
      ok: false,
      code: "out_of_range",
      message: "Article number must be within 1001–1999.",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("validate_manual_article_number", {
      p_scope_kind: "global",
      p_company_legacy_id: null,
      p_category_legacy_id: "cat_recurring",
      p_article_number: "5000",
      p_exclude_service_legacy_id: "svc_1",
    });
  });

  it("configure_article_number_series posts the range and returns the saved series", async () => {
    mocks.rpc.mockResolvedValue({ data: SERIES_ROW, error: null });

    const saved = await configureArticleNumberSeries({
      scope: { scopeKind: "global", companyLegacyId: null, categoryId: "cat_recurring" },
      rangeStart: 1001,
      rangeEnd: 1999,
      isActive: true,
    });

    expect(saved.rangeStart).toBe(1001);
    expect(saved.rangeEnd).toBe(1999);
    // next_value (1003) > range_start (1001) => the start is locked.
    expect(saved.isLocked).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith("configure_article_number_series", {
      p_scope_kind: "global",
      p_company_legacy_id: null,
      p_category_legacy_id: "cat_recurring",
      p_range_start: 1001,
      p_range_end: 1999,
      p_is_active: true,
    });
  });

  it("lists company series with own + global scope and maps rows", async () => {
    const series = await listArticleNumberSeriesFromSupabase("cmp_stad");
    expect(mocks.or).toHaveBeenCalledWith("company_legacy_id.eq.cmp_stad,scope_kind.eq.global");
    expect(series).toHaveLength(1);
    expect(series[0]?.categoryId).toBe("cat_recurring");
    expect(series[0]?.isLocked).toBe(true);
  });

  it("lists only global series for the global catalog scope", async () => {
    await listArticleNumberSeriesFromSupabase(null);
    expect(mocks.eq).toHaveBeenCalledWith("scope_kind", "global");
  });
});
