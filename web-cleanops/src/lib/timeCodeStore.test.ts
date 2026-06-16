import { beforeEach, describe, expect, it } from "vitest";

import {
  defaultTimeCodes,
  getTimeCodes,
  normalizeTimeCode,
  saveTimeCodes,
} from "./timeCodeStore";

beforeEach(() => {
  localStorage.clear();
});

describe("timeCodeStore — seeding", () => {
  it("lazily seeds the global master library on first read", () => {
    const codes = getTimeCodes();
    expect(codes.length).toBeGreaterThan(0);
    expect(codes.every((c) => c.companyId === null)).toBe(true);
    expect(codes.every((c) => c.systemManaged)).toBe(true);
    // The agreed payroll codes are present.
    const byCode = new Map(codes.map((c) => [c.code, c]));
    expect(byCode.get("10")?.type).toBe("attendance");
    expect(byCode.get("355")?.type).toBe("absence");
    expect(byCode.get("385")?.type).toBe("attendance");
  });

  it("does not re-seed when global codes already exist", () => {
    const first = getTimeCodes();
    const second = getTimeCodes();
    expect(second.map((c) => c.id)).toEqual(first.map((c) => c.id));
  });

  it("seeds active codes with unique ids", () => {
    const seeded = defaultTimeCodes();
    const ids = new Set(seeded.map((c) => c.id));
    expect(ids.size).toBe(seeded.length);
    expect(seeded.every((c) => c.active)).toBe(true);
  });

  it("seeds EXACTLY the 6 agreed master codes with stable ids (matches migration 0052)", () => {
    const seeded = defaultTimeCodes();
    // The localStorage backout copy must mirror the Supabase seed in
    // 0052_time_codes_live_schema_align_and_seed.sql byte-for-byte: same codes,
    // names, types, and STABLE ids (`tc_master_<code>`) so the cut-over shadow
    // comparison stays drift-free.
    const expected = [
      { id: "tc_master_10", code: "10", name: "Worked Time", type: "attendance" },
      { id: "tc_master_385", code: "385", name: "Travel Time", type: "attendance" },
      { id: "tc_master_355", code: "355", name: "Vacation", type: "absence" },
      { id: "tc_master_360", code: "360", name: "Sick Leave", type: "absence" },
      { id: "tc_master_374", code: "374", name: "VAB / Child Care Leave", type: "absence" },
      { id: "tc_master_380", code: "380", name: "Parental Leave", type: "absence" },
    ];
    expect(seeded).toHaveLength(expected.length);
    expect(
      seeded.map((c) => ({ id: c.id, code: c.code, name: c.name, type: c.type })),
    ).toEqual(expected);
    expect(seeded.every((c) => c.companyId === null && c.systemManaged)).toBe(true);
  });

  it("persists writes and reads them back", () => {
    const codes = getTimeCodes();
    const next = codes.map((c) => (c.code === "10" ? { ...c, active: false } : c));
    saveTimeCodes(next);
    const reloaded = getTimeCodes();
    expect(reloaded.find((c) => c.code === "10")?.active).toBe(false);
  });
});

describe("normalizeTimeCode", () => {
  it("trims and lowercases for case-insensitive comparison", () => {
    expect(normalizeTimeCode("  T-100 ")).toBe("t-100");
    expect(normalizeTimeCode(null)).toBe("");
    expect(normalizeTimeCode(undefined)).toBe("");
  });
});
