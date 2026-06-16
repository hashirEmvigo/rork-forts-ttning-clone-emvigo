import { describe, expect, it } from "vitest";

import {
  buildSyntheticAgreement,
  compareCustomerAgreementLines,
  compareCustomerAgreementRows,
  syntheticAgreementGroupId,
  syntheticAgreementId,
  syntheticLineId,
} from "./customerAgreementMigration";
import type {
  Customer,
  CustomerAgreement,
  CustomerAgreementLine,
  Service,
  WorkOrder,
  WorkOrderServiceRow,
} from "@/types";

const NOW = "2026-01-01T00:00:00.000Z";

function makeCustomer(over: Partial<Customer> = {}): Customer {
  return {
    id: "cust_1",
    companyId: "cmp_1",
    name: "Acme AB",
    customerNumber: "C-1001",
    email: "ops@acme.test",
    status: "active",
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  } as Customer;
}

function makeRow(over: Partial<WorkOrderServiceRow> = {}): WorkOrderServiceRow {
  return {
    id: "row_1",
    serviceName: "Home cleaning",
    quantity: 2,
    unit: "h",
    price: 199.5,
    vat: 25,
    status: "planned",
    serviceDate: "2026-01-10",
    assignedEmployeeIds: [],
    unassignedEmployeeSlots: 0,
    sortOrder: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  } as WorkOrderServiceRow;
}

function makeWorkOrder(rows: WorkOrderServiceRow[], over: Partial<WorkOrder> = {}): WorkOrder {
  return {
    id: "wo_1",
    companyId: "cmp_1",
    customerId: "cust_1",
    number: "WO-1001",
    status: "planned",
    serviceRows: rows,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  } as WorkOrder;
}

function makeService(over: Partial<Service> = {}): Service {
  return {
    id: "svc_home",
    companyId: "cmp_1",
    categoryId: "cat_1",
    name: "Home cleaning",
    billingType: "fixed",
    serviceBasisType: "billable",
    deductionEligible: false,
    deductionType: "none",
    smsEnabled: false,
    status: "active",
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  } as Service;
}

describe("buildSyntheticAgreement", () => {
  it("derives a draft, imported agreement with deterministic ids + a synthetic warning", () => {
    const customer = makeCustomer();
    const row = makeRow({ sourceServiceId: "svc_home" });
    const result = buildSyntheticAgreement(customer, [makeWorkOrder([row])], new Map());

    expect("skip" in result).toBe(false);
    if ("skip" in result) return;

    expect(result.agreement.id).toBe(syntheticAgreementId("cust_1"));
    expect(result.agreement.agreementGroupId).toBe(syntheticAgreementGroupId("cust_1"));
    expect(result.agreement.status).toBe("draft");
    expect(result.agreement.sourceType).toBe("imported");
    expect(result.agreement.billingModel).toBe("per_visit");
    expect(result.agreement.version).toBe(1);
    // The synthetic billing default is always surfaced — never applied silently.
    expect(result.warnings.some((w) => w.includes("synthetic billingModel"))).toBe(true);

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].id).toBe(syntheticLineId("row_1"));
    expect(result.lines[0].agreedPrice).toBe(199.5);
    expect(result.lines[0].serviceNameSnapshot).toBe("Home cleaning");
  });

  it("skips safely when the customer has no service rows", () => {
    const result = buildSyntheticAgreement(makeCustomer(), [], new Map());
    expect("skip" in result).toBe(true);
    if ("skip" in result) expect(result.skip).toMatch(/no work-order service rows/);
  });

  it("snapshots serviceBasisType from the catalog when the source service resolves", () => {
    const service = makeService({ serviceBasisType: "non_billable" });
    const row = makeRow({ sourceServiceId: "svc_home" });
    const result = buildSyntheticAgreement(
      makeCustomer(),
      [makeWorkOrder([row])],
      new Map([[service.id, service]]),
    );
    if ("skip" in result) throw new Error("expected a build");
    expect(result.lines[0].serviceBasisTypeSnapshot).toBe("non_billable");
    expect(result.missingServiceCount).toBe(0);
  });

  it("warns and counts when a source service id cannot be resolved", () => {
    const row = makeRow({ sourceServiceId: "svc_missing" });
    const result = buildSyntheticAgreement(makeCustomer(), [makeWorkOrder([row])], new Map());
    if ("skip" in result) throw new Error("expected a build");
    expect(result.missingServiceCount).toBe(1);
    expect(result.warnings.some((w) => w.includes("not found in catalog"))).toBe(true);
    expect(result.lines[0].serviceBasisTypeSnapshot).toBeNull();
  });

  it("warns when a source row has no price (never invents one)", () => {
    const row = makeRow({ price: undefined });
    const result = buildSyntheticAgreement(makeCustomer(), [makeWorkOrder([row])], new Map());
    if ("skip" in result) throw new Error("expected a build");
    expect(result.lines[0].agreedPrice).toBeNull();
    expect(result.warnings.some((w) => w.includes("no price"))).toBe(true);
  });

  it("ignores archived rows and orders lines deterministically", () => {
    const rows = [
      makeRow({ id: "row_b", sortOrder: 2, serviceName: "B" }),
      makeRow({ id: "row_archived", sortOrder: 1, archived: true, serviceName: "Z" }),
      makeRow({ id: "row_a", sortOrder: 0, serviceName: "A" }),
    ];
    const result = buildSyntheticAgreement(makeCustomer(), [makeWorkOrder(rows)], new Map());
    if ("skip" in result) throw new Error("expected a build");
    expect(result.lines.map((l) => l.serviceNameSnapshot)).toEqual(["A", "B"]);
    expect(result.lines.map((l) => l.sortOrder)).toEqual([0, 1]);
  });
});

describe("compareCustomerAgreementRows", () => {
  const base: CustomerAgreement = {
    id: "agr",
    agreementGroupId: "grp",
    companyId: "cmp_1",
    customerId: "cust_1",
    version: 1,
    status: "draft",
    billingModel: "per_visit",
    invoiceInterval: "per_visit",
    sourceType: "imported",
    createdAt: NOW,
    updatedAt: NOW,
  };

  it("returns no mismatches for equal headers", () => {
    expect(compareCustomerAgreementRows(base, { ...base })).toEqual([]);
  });

  it("surfaces a differing field", () => {
    const diffs = compareCustomerAgreementRows(base, { ...base, status: "active" });
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({ field: "status", local: "draft", remote: "active" });
  });

  it("treats null and undefined validTo as equal", () => {
    const diffs = compareCustomerAgreementRows(
      { ...base, validTo: null },
      { ...base, validTo: undefined },
    );
    expect(diffs).toEqual([]);
  });
});

describe("compareCustomerAgreementLines", () => {
  const line: CustomerAgreementLine = {
    id: "line_1",
    agreementId: "agr",
    agreementGroupId: "grp",
    companyId: "cmp_1",
    sortOrder: 0,
    pricingModel: "fixed",
    agreedPrice: 100,
    quantity: 1,
    unit: "h",
    vat: 25,
    sourceServiceId: "svc_home",
    serviceNameSnapshot: "Home cleaning",
    categoryNameSnapshot: null,
    serviceBasisTypeSnapshot: "billable",
    createdAt: NOW,
    updatedAt: NOW,
  };

  it("returns no mismatches for equal line sets", () => {
    expect(compareCustomerAgreementLines([line], [{ ...line }])).toEqual([]);
  });

  it("reports a line count difference", () => {
    const diffs = compareCustomerAgreementLines([line], []);
    expect(diffs.some((d) => d.field === "lineCount")).toBe(true);
  });

  it("reports a field-level price drift", () => {
    const diffs = compareCustomerAgreementLines([line], [{ ...line, agreedPrice: 200 }]);
    expect(diffs.some((d) => d.field === "line line_1.agreedPrice")).toBe(true);
  });

  it("flags a remote line with no local counterpart", () => {
    const extra: CustomerAgreementLine = { ...line, id: "line_extra" };
    const diffs = compareCustomerAgreementLines([line], [line, extra]);
    expect(diffs.some((d) => d.field === "line line_extra" && d.remote === "present")).toBe(true);
  });
});
