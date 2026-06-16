/**
 * Tests for useCustomerAgreementDetailSource (Phase 14 · agreement detail host).
 *
 * Exercises the read seam against the in-memory Supabase stand-in from
 * `customerAgreementHarness` — NO browser localStorage, NO signed-in session,
 * NO network. Validates loading the agreement + lines + version chain, the
 * not-found path, company scope isolation, and load-error surfacing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import { useCustomerAgreementDetailSource } from "./use-customer-agreement-detail-source";
import { supabaseCustomerAgreementRepository } from "@/lib/data/customerAgreementRepository";
import { harnessSupabase, resetHarness } from "@/lib/data/customerAgreementHarness";
import type { CustomerAgreement, CustomerAgreementLine } from "@/types";

vi.mock("@/lib/supabase", async () => {
  const { harnessSupabase: hs } = await import("@/lib/data/customerAgreementHarness");
  return {
    isSupabaseConfigured: true,
    supabase: hs.client,
    requireSupabase: () => hs.client,
  };
});

const COMPANY = "cmp_1";
const COMPANY_UUID = "00000000-0000-4000-8000-000000000001";
const GROUP = "grp_1";
const T1 = "2026-01-01T00:00:00.000Z";

function agreement(over: Partial<CustomerAgreement> = {}): CustomerAgreement {
  return {
    id: "grp1_v1",
    agreementGroupId: GROUP,
    companyId: COMPANY,
    customerId: "cust_1",
    version: 1,
    status: "active",
    billingModel: "monthly_fixed",
    invoiceInterval: "monthly",
    name: "Office cleaning",
    sourceType: "manual",
    sourceReferenceId: null,
    supersedesVersionId: null,
    supersededById: null,
    validFrom: "2026-01-01",
    validTo: null,
    notes: null,
    createdBy: "user_1",
    createdAt: T1,
    updatedAt: T1,
    ...over,
  } as CustomerAgreement;
}

function line(over: Partial<CustomerAgreementLine> = {}): CustomerAgreementLine {
  return {
    id: "line_1",
    agreementId: "grp1_v1",
    agreementGroupId: GROUP,
    companyId: COMPANY,
    sortOrder: 0,
    pricingModel: "custom",
    agreedPrice: 1200,
    quantity: 1,
    unit: "month",
    vat: 25,
    sourceServiceId: "svc_1",
    serviceNameSnapshot: "Office cleaning",
    categoryNameSnapshot: "Recurring",
    createdAt: T1,
    updatedAt: T1,
    ...over,
  } as CustomerAgreementLine;
}

async function seed(): Promise<void> {
  await supabaseCustomerAgreementRepository.upsertVersions([agreement()], COMPANY_UUID);
  await supabaseCustomerAgreementRepository.upsertLines([line()], COMPANY_UUID);
}

beforeEach(() => {
  resetHarness();
  vi.clearAllMocks();
  harnessSupabase.seedCompany(COMPANY, COMPANY_UUID);
});

describe("useCustomerAgreementDetailSource", () => {
  it("loads the agreement, lines and version chain", async () => {
    await seed();
    const { result } = renderHook(() =>
      useCustomerAgreementDetailSource("grp1_v1", COMPANY),
    );

    await waitFor(() => expect(result.current.agreement).not.toBeNull());
    expect(result.current.agreement?.id).toBe("grp1_v1");
    expect(result.current.lines).toHaveLength(1);
    expect(result.current.versionChain).toHaveLength(1);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("resolves to a null agreement (no error) when not found", async () => {
    const { result } = renderHook(() =>
      useCustomerAgreementDetailSource("missing", COMPANY),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.agreement).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("does not return an agreement out of company scope", async () => {
    await seed();
    const { result } = renderHook(() =>
      useCustomerAgreementDetailSource("grp1_v1", "other_company"),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.agreement).toBeNull();
  });

  it("surfaces a load error when the read fails", async () => {
    await seed();
    harnessSupabase.failTable("customer_agreements");
    const { result } = renderHook(() =>
      useCustomerAgreementDetailSource("grp1_v1", COMPANY),
    );
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.agreement).toBeNull();
  });
});
