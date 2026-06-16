import { describe, expect, it } from "vitest";

import {
  toCustomerAgreementLineUpsertRow,
  toCustomerAgreementUpsertRow,
} from "./customerAgreementRepository";
import type { CustomerAgreement, CustomerAgreementLine } from "@/types";

const NOW = "2026-01-01T00:00:00.000Z";

function makeAgreement(over: Partial<CustomerAgreement> = {}): CustomerAgreement {
  return {
    id: "agr_v1",
    agreementGroupId: "grp_1",
    companyId: "cmp_nordlys",
    customerId: "cust_001",
    version: 1,
    status: "active",
    billingModel: "hybrid",
    invoiceInterval: "monthly",
    sourceType: "manual",
    sourceReferenceId: null,
    supersedesVersionId: null,
    supersededById: null,
    validFrom: "2026-01-01",
    validTo: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function makeLine(over: Partial<CustomerAgreementLine> = {}): CustomerAgreementLine {
  return {
    id: "line_1",
    agreementId: "agr_v1",
    agreementGroupId: "grp_1",
    companyId: "cmp_nordlys",
    sortOrder: 0,
    pricingModel: "per_unit",
    agreedPrice: 199.5,
    quantity: 2,
    unit: "h",
    vat: 25,
    sourceServiceId: "svc_home",
    serviceNameSnapshot: "Home cleaning",
    categoryNameSnapshot: "Recurring",
    categoryTypeSnapshot: "recurring_service",
    serviceBasisTypeSnapshot: "billable",
    createdAt: "2026-02-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
    ...over,
  };
}

describe("toCustomerAgreementUpsertRow", () => {
  it("maps flat columns and keeps the full record in data", () => {
    const agreement = makeAgreement();
    const row = toCustomerAgreementUpsertRow(agreement, "uuid-company");
    expect(row).toMatchObject({
      legacy_id: "agr_v1",
      agreement_group_id: "grp_1",
      company_id: "uuid-company",
      company_legacy_id: "cmp_nordlys",
      customer_legacy_id: "cust_001",
      version: 1,
      status: "active",
      billing_model: "hybrid",
      invoice_interval: "monthly",
      source_type: "manual",
      source_reference_id: null,
      supersedes_version_id: null,
      superseded_by_id: null,
      valid_from: "2026-01-01",
      valid_to: null,
    });
    expect(row.data).toBe(agreement);
  });

  it("preserves the version chain links", () => {
    const v2 = makeAgreement({
      id: "agr_v2",
      version: 2,
      supersedesVersionId: "agr_v1",
      supersededById: null,
    });
    const row = toCustomerAgreementUpsertRow(v2, null);
    expect(row.company_id).toBeNull();
    expect(row.version).toBe(2);
    expect(row.supersedes_version_id).toBe("agr_v1");
  });
});

describe("toCustomerAgreementLineUpsertRow", () => {
  it("maps flat columns, snapshots and money fields", () => {
    const line = makeLine();
    const row = toCustomerAgreementLineUpsertRow(line, "uuid-company");
    expect(row).toMatchObject({
      legacy_id: "line_1",
      agreement_legacy_id: "agr_v1",
      agreement_group_id: "grp_1",
      company_id: "uuid-company",
      company_legacy_id: "cmp_nordlys",
      sort_order: 0,
      billing_model_override: null,
      pricing_model: "per_unit",
      agreed_price: 199.5,
      quantity: 2,
      unit: "h",
      vat: 25,
      source_service_id: "svc_home",
      service_name_snapshot: "Home cleaning",
      category_name_snapshot: "Recurring",
      category_type_snapshot: "recurring_service",
      service_basis_type_snapshot: "billable",
    });
    expect(row.data).toBe(line);
  });

  it("serialises an explicit billing override", () => {
    const row = toCustomerAgreementLineUpsertRow(
      makeLine({ billingModelOverride: "time_bank" }),
      null,
    );
    expect(row.billing_model_override).toBe("time_bank");
    expect(row.company_id).toBeNull();
  });

  it("nulls optional fields when absent", () => {
    const sparse = makeLine({
      agreedPrice: null,
      quantity: null,
      unit: undefined,
      vat: null,
      sourceServiceId: null,
      categoryNameSnapshot: null,
      categoryTypeSnapshot: null,
      serviceBasisTypeSnapshot: null,
    });
    const row = toCustomerAgreementLineUpsertRow(sparse, "uuid-company");
    expect(row.agreed_price).toBeNull();
    expect(row.quantity).toBeNull();
    expect(row.unit).toBeNull();
    expect(row.vat).toBeNull();
    expect(row.source_service_id).toBeNull();
    expect(row.category_name_snapshot).toBeNull();
    expect(row.category_type_snapshot).toBeNull();
    expect(row.service_basis_type_snapshot).toBeNull();
  });
});
