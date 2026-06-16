import { describe, expect, it } from "vitest";

import type {
  PayrollBasis,
  PayrollExportProfile,
  TimeCode,
} from "@/types";

import { csvAdapter } from "./csvAdapter";
import { createNotImplementedAdapter } from "./adapter";
import type { PayrollExportContext } from "./adapter";

const NOW = new Date("2025-06-01T12:00:00.000Z");

function timeCode(id: string, code: string, name: string): TimeCode {
  return {
    id,
    companyId: null,
    code,
    name,
    type: "attendance",
    active: true,
    systemManaged: true,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
}

function makeContext(over?: {
  profile?: Partial<PayrollExportProfile>;
  basis?: Partial<PayrollBasis>;
}): PayrollExportContext {
  const profile: PayrollExportProfile = {
    id: "pep_1",
    companyId: "c1",
    name: "Monthly CSV",
    target: "csv",
    active: true,
    config: {},
    credentialsRef: null,
    createdBy: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...over?.profile,
  };
  const basis: PayrollBasis = {
    id: "pb_1",
    companyId: "c1",
    periodStart: "2025-05-01",
    periodEnd: "2025-05-31",
    status: "approved",
    rows: [
      {
        id: "r1",
        employeeId: "e1",
        employeeName: "Alice",
        timeCodeId: "tc_10",
        date: "2025-05-02",
        quantity: 8,
        unit: "hours",
      },
    ],
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...over?.basis,
  };
  return {
    profile,
    basis,
    timeCodes: new Map([["tc_10", timeCode("tc_10", "10", "Worked Time")]]),
    now: NOW,
  };
}

describe("csvAdapter", () => {
  it("transforms an approved basis into CSV with a header and one row per line", () => {
    const result = csvAdapter.transform(makeContext());
    expect(result.ok).toBe(true);
    expect(result.rowsIncluded).toBe(1);
    expect(result.output.kind).toBe("file");
    if (result.output.kind !== "file") throw new Error("expected file output");
    const lines = result.output.content.split("\r\n");
    expect(lines[0]).toContain("time_code");
    expect(lines[1]).toContain("10");
    expect(lines[1]).toContain("Alice");
    expect(result.output.mimeType).toBe("text/csv");
  });

  it("resolves the time code label by id", () => {
    const result = csvAdapter.transform(makeContext());
    if (result.output.kind !== "file") throw new Error("expected file output");
    expect(result.output.content).toContain("Worked Time");
    expect(result.output.content).toContain("attendance");
  });

  it("honours a custom delimiter from profile config", () => {
    const result = csvAdapter.transform(
      makeContext({ profile: { config: { delimiter: ";" } } }),
    );
    if (result.output.kind !== "file") throw new Error("expected file output");
    expect(result.output.content.split("\r\n")[0]).toContain("date;employee_id");
  });

  it("escapes fields containing the delimiter", () => {
    const ctx = makeContext();
    ctx.basis.rows[0].employeeName = "Doe, Jane";
    const result = csvAdapter.transform(ctx);
    if (result.output.kind !== "file") throw new Error("expected file output");
    expect(result.output.content).toContain('"Doe, Jane"');
  });

  it("fails validation when the basis is not approved", () => {
    const result = csvAdapter.transform(makeContext({ basis: { status: "draft" } }));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /approved/i.test(e))).toBe(true);
    expect(result.output.kind).toBe("none");
  });

  it("errors when a row references an unknown time code", () => {
    const ctx = makeContext();
    ctx.basis.rows[0].timeCodeId = "tc_missing";
    const issues = csvAdapter.validate(ctx);
    expect(issues.some((i) => i.level === "error" && i.rowId === "r1")).toBe(true);
  });
});

describe("createNotImplementedAdapter", () => {
  it("validates with the shared baseline but never produces output", () => {
    const adapter = createNotImplementedAdapter("fortnox", "Fortnox Payroll");
    expect(adapter.implemented).toBe(false);
    const ctx = makeContext({ profile: { target: "fortnox" } });
    const result = adapter.transform(ctx);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("not implemented");
    expect(result.output.kind).toBe("none");
  });
});
