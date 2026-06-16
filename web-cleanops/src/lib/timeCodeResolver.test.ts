import { describe, expect, it } from "vitest";

import {
  availableTimeCodes,
  buildTimeCodeIndex,
  canDeleteTimeCode,
  linkedServices,
  resolveTimeCode,
  sortTimeCodes,
  timeCodeUsageMap,
} from "./timeCodeResolver";
import type { Service, TimeCode } from "@/types";

function code(partial: Partial<TimeCode> & Pick<TimeCode, "id" | "code">): TimeCode {
  return {
    companyId: null,
    name: partial.name ?? partial.code,
    type: partial.type ?? "attendance",
    active: partial.active ?? true,
    systemManaged: partial.systemManaged ?? false,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...partial,
  };
}

function service(id: string, timeCodeId: string | null): Service {
  return {
    id,
    companyId: "cmp",
    categoryId: null,
    name: id,
    timeCodeId,
    billingType: "fixed",
    serviceBasisType: "billable",
    deductionEligible: false,
    deductionType: "none",
    smsEnabled: false,
    status: "active",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  };
}

describe("timeCodeResolver — index & lookup", () => {
  it("resolves by id in O(1) and returns undefined for unknown/empty", () => {
    const index = buildTimeCodeIndex([code({ id: "a", code: "10" }), code({ id: "b", code: "355" })]);
    expect(resolveTimeCode(index, "a")?.code).toBe("10");
    expect(resolveTimeCode(index, "missing")).toBeUndefined();
    expect(resolveTimeCode(index, null)).toBeUndefined();
    expect(resolveTimeCode(index, undefined)).toBeUndefined();
  });
});

describe("availableTimeCodes", () => {
  it("returns active global codes plus the company's own active codes", () => {
    const codes = [
      code({ id: "g1", code: "10" }),
      code({ id: "g2", code: "20", active: false }),
      code({ id: "c1", code: "900", companyId: "cmp" }),
      code({ id: "c2", code: "901", companyId: "other" }),
    ];
    const ids = availableTimeCodes(codes, "cmp").map((c) => c.id);
    expect(ids).toContain("g1");
    expect(ids).not.toContain("g2"); // inactive
    expect(ids).toContain("c1");
    expect(ids).not.toContain("c2"); // other company
  });

  it("excludes company codes when scope is global (null)", () => {
    const codes = [code({ id: "g1", code: "10" }), code({ id: "c1", code: "900", companyId: "cmp" })];
    expect(availableTimeCodes(codes, null).map((c) => c.id)).toEqual(["g1"]);
  });
});

describe("sortTimeCodes", () => {
  it("orders attendance before absence, then by numeric code", () => {
    const codes = [
      code({ id: "1", code: "360", type: "absence" }),
      code({ id: "2", code: "385", type: "attendance" }),
      code({ id: "3", code: "10", type: "attendance" }),
    ];
    expect([...codes].sort(sortTimeCodes).map((c) => c.code)).toEqual(["10", "385", "360"]);
  });
});

describe("usage counting", () => {
  it("counts service references in a single pass", () => {
    const services = [service("s1", "a"), service("s2", "a"), service("s3", "b"), service("s4", null)];
    const usage = timeCodeUsageMap(services);
    expect(usage.get("a")).toBe(2);
    expect(usage.get("b")).toBe(1);
    expect(usage.get("c")).toBeUndefined();
  });

  it("lists linked services for a code", () => {
    const services = [service("s1", "a"), service("s2", "b"), service("s3", "a")];
    expect(linkedServices("a", services).map((s) => s.id)).toEqual(["s1", "s3"]);
  });
});

describe("canDeleteTimeCode", () => {
  it("blocks system-managed codes", () => {
    const usage = new Map<string, number>();
    expect(canDeleteTimeCode(code({ id: "a", code: "10", systemManaged: true }), usage)).toBe(false);
  });

  it("blocks codes referenced by services", () => {
    const usage = new Map<string, number>([["a", 1]]);
    expect(canDeleteTimeCode(code({ id: "a", code: "10" }), usage)).toBe(false);
  });

  it("allows deleting an unused custom code", () => {
    const usage = new Map<string, number>();
    expect(canDeleteTimeCode(code({ id: "a", code: "900" }), usage)).toBe(true);
  });
});
