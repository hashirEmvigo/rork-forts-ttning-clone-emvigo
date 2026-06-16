/**
 * Agreement Versioning persistence layer — end-to-end harness validation.
 *
 * Exercises the production WRITE path (`persistAgreementVersion` /
 * `persistNewAgreementVersion`) against the in-memory Supabase stand-in + seeded
 * fixtures from `customerAgreementHarness`, with NO browser localStorage, NO
 * signed-in Supabase session and NO network. Proves the full lifecycle:
 *
 *   create version → persist → read → resolve current → resolve historical
 *   → resolve version chain
 *
 * across v1 → v2, v1 → v2 → v3, superseded chains, immutable historical
 * snapshots and stable agreementGroupId continuity — plus the write-failure,
 * dry-run and company-scoping paths.
 *
 * SAFETY — identical guarantees to the Phase-1/2 harnesses: no network, no env,
 * no localStorage, no real Supabase, no activation, no production-authoritative
 * flip. Pure validation.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createNewAgreementVersion,
  resolveCurrentVersion,
  resolveCurrentVersionForGroup,
  resolveVersionActiveOn,
  validateVersionChain,
} from "./agreementVersioning";
import {
  persistAgreementVersion,
  persistNewAgreementVersion,
} from "./agreementVersionPersistence";
import { harnessSupabase, resetHarness } from "./customerAgreementHarness";
import { supabaseCustomerAgreementRepository } from "./customerAgreementRepository";
import type { CustomerAgreement, CustomerAgreementLine } from "@/types";

vi.mock("@/lib/supabase", async () => {
  const { harnessSupabase: hs } = await import("./customerAgreementHarness");
  return {
    isSupabaseConfigured: true,
    supabase: hs.client,
    requireSupabase: () => hs.client,
  };
});

// The persistence layer resolves the tenant UUID via loadCompanyUuidMap, which
// reads getCustomers/getServices indirectly only through the migration module;
// here it just needs the companies table — but the store mock keeps imports
// clean and matches the other harness suites.
vi.mock("@/lib/store", async () => {
  const { harnessStore: store } = await import("./customerAgreementHarness");
  return {
    getCustomers: () => store.customers,
    getWorkOrders: () => store.workOrders,
    getServices: () => store.services,
  };
});

const COMPANY = "cmp_1";
const COMPANY_UUID = "00000000-0000-4000-8000-000000000001";
const GROUP = "grp_1";
const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-04-01T00:00:00.000Z";
const T3 = "2026-07-01T00:00:00.000Z";

function makeAgreement(over: Partial<CustomerAgreement> = {}): CustomerAgreement {
  return {
    id: "grp1_v1",
    agreementGroupId: GROUP,
    companyId: COMPANY,
    customerId: "cust_1",
    version: 1,
    status: "active",
    billingModel: "per_visit",
    invoiceInterval: "monthly",
    name: "Standard agreement",
    sourceType: "manual",
    sourceReferenceId: null,
    supersedesVersionId: null,
    supersededById: null,
    validFrom: "2026-01-01",
    validTo: null,
    notes: "original",
    createdBy: "user_1",
    createdAt: T1,
    updatedAt: T1,
    ...over,
  };
}

function makeLine(over: Partial<CustomerAgreementLine> = {}): CustomerAgreementLine {
  return {
    id: "grp1_v1-line-0",
    agreementId: "grp1_v1",
    agreementGroupId: GROUP,
    companyId: COMPANY,
    sortOrder: 0,
    pricingModel: "fixed",
    agreedPrice: 1000,
    quantity: 1,
    unit: "st",
    vat: 25,
    sourceServiceId: "svc_home",
    serviceNameSnapshot: "Home cleaning",
    categoryNameSnapshot: "Recurring",
    categoryTypeSnapshot: "recurring_service",
    serviceBasisTypeSnapshot: "billable",
    createdAt: T1,
    updatedAt: T1,
    ...over,
  };
}

beforeEach(() => {
  resetHarness();
  vi.clearAllMocks();
  harnessSupabase.seedCompany(COMPANY, COMPANY_UUID);
});

// ── Full lifecycle: create → persist → read → resolve ────────
describe("persistence — full version lifecycle", () => {
  it("persists v1, then a v2 supersede, and reads everything back through the repository", async () => {
    const v1 = makeAgreement();
    const v1Lines = [makeLine()];

    // 1. Persist v1.
    const r1 = await persistAgreementVersion(v1, v1Lines, { companyId: COMPANY });
    expect(r1.ok).toBe(true);
    expect(r1.writtenVersionCount).toBe(1);
    expect(r1.writtenLineCount).toBe(1);
    expect(r1.supersededVersionId).toBeNull();

    // 2. Read it back.
    const v1Back = await supabaseCustomerAgreementRepository.getDetail("grp1_v1", {
      companyId: COMPANY,
    });
    expect(v1Back?.version).toBe(1);
    expect(v1Back?.status).toBe("active");

    // 3. Create + persist v2 (price + billing change).
    const r2 = await persistNewAgreementVersion(v1, v1Lines, {
      newAgreementId: "grp1_v2",
      now: T2,
      companyId: COMPANY,
      changes: { billingModel: "monthly_fixed", validFrom: "2026-04-01" },
    });
    expect(r2.report.ok).toBe(true);
    expect(r2.report.supersededVersionId).toBe("grp1_v1");
    expect(r2.report.liveVersionId).toBe("grp1_v2");
    expect(r2.report.writtenVersionCount).toBe(2); // superseded prior + new live
    expect(r2.report.writtenLineCount).toBe(1);

    // 4. Resolve current version (group → live head).
    const live = await resolveCurrentVersionForGroup(GROUP, { companyId: COMPANY });
    expect(live?.id).toBe("grp1_v2");
    expect(live?.billingModel).toBe("monthly_fixed");

    // 5. Resolve historical version active on a v1-era date.
    const chain = await supabaseCustomerAgreementRepository.listVersionChain(GROUP, {
      companyId: COMPANY,
    });
    expect(resolveVersionActiveOn(chain, "2026-02-15")?.id).toBe("grp1_v1");
    expect(resolveVersionActiveOn(chain, "2026-05-15")?.id).toBe("grp1_v2");

    // 6. Resolve the full version chain + integrity.
    expect(chain.map((c) => c.version)).toEqual([1, 2]);
    const integrity = validateVersionChain(chain);
    expect(integrity.ok).toBe(true);
    expect(integrity.liveCount).toBe(1);
    expect(integrity.liveVersionId).toBe("grp1_v2");
  });

  it("persists a v1 → v2 → v3 chain with valid supersede links and a single live head", async () => {
    const v1 = makeAgreement();
    await persistAgreementVersion(v1, [makeLine()], { companyId: COMPANY });

    const r2 = await persistNewAgreementVersion(v1, [makeLine()], {
      newAgreementId: "grp1_v2",
      now: T2,
      companyId: COMPANY,
      changes: { invoiceInterval: "quarterly", validFrom: "2026-04-01" },
    });
    const r3 = await persistNewAgreementVersion(r2.next, r2.lines, {
      newAgreementId: "grp1_v3",
      now: T3,
      companyId: COMPANY,
      changes: { billingModel: "monthly_fixed", validFrom: "2026-07-01" },
    });
    expect(r3.report.ok).toBe(true);

    const chain = await supabaseCustomerAgreementRepository.listVersionChain(GROUP, {
      companyId: COMPANY,
    });
    expect(chain.map((c) => c.version)).toEqual([1, 2, 3]);
    expect(chain[0].status).toBe("superseded");
    expect(chain[1].status).toBe("superseded");
    expect(chain[2].status).toBe("active");

    // Supersede links are valid + bidirectional across the persisted chain.
    expect(chain[0].supersededById).toBe(chain[1].id);
    expect(chain[1].supersedesVersionId).toBe(chain[0].id);
    expect(chain[1].supersededById).toBe(chain[2].id);
    expect(chain[2].supersedesVersionId).toBe(chain[1].id);
    expect(chain[2].supersededById).toBeNull();

    expect(validateVersionChain(chain).ok).toBe(true);
    expect(resolveCurrentVersion(chain)?.id).toBe("grp1_v3");
  });
});

// ── Historical immutability through the write path ───────────
describe("persistence — historical integrity", () => {
  it("never mutates a prior version's stored row or lines beyond the supersede flip", async () => {
    const v1 = makeAgreement();
    const v1Lines = [makeLine({ agreedPrice: 1000 })];
    await persistAgreementVersion(v1, v1Lines, { companyId: COMPANY });

    // Persist v2 with a higher price — default lineIdFor mints fresh line ids.
    const r2 = await persistNewAgreementVersion(v1, v1Lines, {
      newAgreementId: "grp1_v2",
      now: T2,
      companyId: COMPANY,
      changes: { billingModel: "monthly_fixed" },
    });
    // Adjust the new version's lines' price and re-persist (idempotent).
    const bumped = r2.lines.map((l) => ({ ...l, agreedPrice: 1500 }));
    await supabaseCustomerAgreementRepository.upsertLines(bumped, COMPANY_UUID);

    // v1 line price stays 1000; v1 header keeps its billing model.
    const v1Back = await supabaseCustomerAgreementRepository.listLines("grp1_v1");
    expect(v1Back).toHaveLength(1);
    expect(v1Back[0].agreedPrice).toBe(1000);
    const v1Header = await supabaseCustomerAgreementRepository.getDetail("grp1_v1", {
      companyId: COMPANY,
    });
    expect(v1Header?.billingModel).toBe("per_visit");
    expect(v1Header?.status).toBe("superseded"); // only the supersede flip
    expect(v1Header?.supersededById).toBe("grp1_v2");

    // v2 carries the new terms with independent line ids.
    const v2Back = await supabaseCustomerAgreementRepository.listLines("grp1_v2");
    expect(v2Back[0].agreedPrice).toBe(1500);
    expect(v2Back[0].id).not.toBe(v1Back[0].id);
  });

  it("keeps agreementGroupId constant while version ids change across persisted versions", async () => {
    const v1 = makeAgreement();
    await persistAgreementVersion(v1, [makeLine()], { companyId: COMPANY });
    const r2 = await persistNewAgreementVersion(v1, [makeLine()], {
      newAgreementId: "grp1_v2",
      now: T2,
      companyId: COMPANY,
    });
    await persistNewAgreementVersion(r2.next, r2.lines, {
      newAgreementId: "grp1_v3",
      now: T3,
      companyId: COMPANY,
    });

    const chain = await supabaseCustomerAgreementRepository.listVersionChain(GROUP, {
      companyId: COMPANY,
    });
    expect(new Set(chain.map((c) => c.agreementGroupId))).toEqual(new Set([GROUP]));
    expect(new Set(chain.map((c) => c.id)).size).toBe(3);
  });
});

// ── Idempotency / self-healing through re-persist ────────────
describe("persistence — idempotency and self-healing", () => {
  it("re-persisting the same version overwrites rather than duplicating, healing drift", async () => {
    const v1 = makeAgreement();
    await persistAgreementVersion(v1, [makeLine()], { companyId: COMPANY });

    // Drift the stored row out of band (clone the data so the source object
    // stays clean — the DB row drifts independently, like a real edit would).
    const stored = harnessSupabase.db.get("customer_agreements") ?? [];
    stored[0].data = { ...(stored[0].data as CustomerAgreement), billingModel: "time_bank" };
    stored[0].billing_model = "time_bank";

    const drifted = await supabaseCustomerAgreementRepository.getDetail("grp1_v1", {
      companyId: COMPANY,
    });
    expect(drifted?.billingModel).toBe("time_bank");

    // Re-persist the correct version — no duplicate row, drift healed.
    await persistAgreementVersion(v1, [makeLine()], { companyId: COMPANY });
    const rows = harnessSupabase.db.get("customer_agreements") ?? [];
    expect(rows.filter((r) => r.legacy_id === "grp1_v1")).toHaveLength(1);
    const healed = await supabaseCustomerAgreementRepository.getDetail("grp1_v1", {
      companyId: COMPANY,
    });
    expect(healed?.billingModel).toBe("per_visit");
  });
});

// ── Failure + guard paths ────────────────────────────────────
describe("persistence — failure and guard paths", () => {
  it("returns ok=false with an error when the version upsert fails", async () => {
    harnessSupabase.failTable("customer_agreements");
    const r = await persistAgreementVersion(makeAgreement(), [makeLine()], {
      companyId: COMPANY,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
    expect(r.writtenVersionCount).toBe(0);
  });

  it("aborts the supersede flow with ok=false when the company has no Supabase tenant", async () => {
    const r = await persistNewAgreementVersion(makeAgreement(), [makeLine()], {
      newAgreementId: "grp1_v2",
      now: T2,
      companyId: "unknown_company",
    });
    expect(r.report.ok).toBe(false);
    expect(r.report.error).toContain("No Supabase company found");
    // Nothing was written.
    expect(harnessSupabase.db.get("customer_agreements") ?? []).toHaveLength(0);
  });

  it("throws when superseding a non-active/paused version (state-machine boundary)", async () => {
    const draft = makeAgreement({ status: "draft" });
    await expect(
      persistNewAgreementVersion(draft, [makeLine()], {
        newAgreementId: "grp1_v2",
        now: T2,
        companyId: COMPANY,
      }),
    ).rejects.toThrow();
  });
});

// ── Dry-run ──────────────────────────────────────────────────
describe("persistence — dry-run", () => {
  it("writes nothing on dryRun yet reports ok=true with the planned ids", async () => {
    const v1 = makeAgreement();
    const r = await persistNewAgreementVersion(v1, [makeLine()], {
      newAgreementId: "grp1_v2",
      now: T2,
      companyId: COMPANY,
      dryRun: true,
    });
    expect(r.report.ok).toBe(true);
    expect(r.report.dryRun).toBe(true);
    expect(r.report.writtenVersionCount).toBe(0);
    expect(r.report.writtenLineCount).toBe(0);
    expect(r.report.liveVersionId).toBe("grp1_v2");
    expect(r.report.supersededVersionId).toBe("grp1_v1");
    // No rows hit the store.
    expect(harnessSupabase.db.get("customer_agreements") ?? []).toHaveLength(0);
    expect(harnessSupabase.db.get("customer_agreement_lines") ?? []).toHaveLength(0);
  });
});

// ── Company scoping ──────────────────────────────────────────
describe("persistence — company scoping", () => {
  it("persisted rows are only readable within their company scope", async () => {
    await persistAgreementVersion(makeAgreement(), [makeLine()], { companyId: COMPANY });

    // Correct scope resolves; a different scope returns null (getDetail scope guard).
    const inScope = await supabaseCustomerAgreementRepository.getDetail("grp1_v1", {
      companyId: COMPANY,
    });
    expect(inScope?.id).toBe("grp1_v1");
    const outOfScope = await supabaseCustomerAgreementRepository.getDetail("grp1_v1", {
      companyId: "other_company",
    });
    expect(outOfScope).toBeNull();
  });

  it("uses the agreement's own companyId when no explicit scope is given", async () => {
    const r = await persistAgreementVersion(makeAgreement(), [makeLine()], {});
    expect(r.ok).toBe(true);
    expect(r.writtenVersionCount).toBe(1);
  });
});
