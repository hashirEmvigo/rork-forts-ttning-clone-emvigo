/**
 * Guarded Node/CI harness test for the Customer Agreement validation bridge.
 *
 * Runs the full `migrateCustomerAgreements()` → `shadowReadCustomerAgreements()`
 * round-trip with NO browser localStorage and NO signed-in Supabase session.
 * `@/lib/supabase` and `@/lib/store` are replaced (via async `vi.mock` factories
 * that resolve the shared harness module) with an in-memory Supabase stand-in
 * and seeded fixtures. No network, no env, no real Supabase writes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  harnessStore,
  harnessSupabase,
  makeCustomer,
  makeRow,
  makeService,
  makeWorkOrder,
  resetHarness,
} from "./customerAgreementHarness";
import {
  migrateCustomerAgreements,
  shadowReadCustomerAgreements,
  syntheticAgreementId,
} from "./customerAgreementMigration";
import { supabaseCustomerAgreementRepository } from "./customerAgreementRepository";
import type { CustomerAgreement } from "@/types";

// Replace the Supabase client with the in-memory harness. Async factory +
// dynamic import avoids vi.mock hoisting issues while sharing one singleton.
vi.mock("@/lib/supabase", async () => {
  const { harnessSupabase: hs } = await import("./customerAgreementHarness");
  return {
    isSupabaseConfigured: true,
    supabase: hs.client,
    requireSupabase: () => hs.client,
  };
});

// Replace the localStorage-backed store getters with seeded fixtures.
vi.mock("@/lib/store", async () => {
  const { harnessStore: store } = await import("./customerAgreementHarness");
  return {
    getCustomers: () => store.customers,
    getWorkOrders: () => store.workOrders,
    getServices: () => store.services,
  };
});

const COMPANY_UUID = "00000000-0000-4000-8000-000000000001";
const COMPANY_UUID_2 = "00000000-0000-4000-8000-000000000002";

/** Seeds one clean, fully-resolvable customer + work order + service. */
function seedHealthyFixtures(): void {
  harnessSupabase.seedCompany("cmp_1", COMPANY_UUID);
  harnessStore.customers = [makeCustomer()];
  harnessStore.services = [makeService({ id: "svc_home", serviceBasisType: "billable" })];
  harnessStore.workOrders = [makeWorkOrder([makeRow({ sourceServiceId: "svc_home" })])];
}

beforeEach(() => {
  resetHarness();
  vi.clearAllMocks();
});

describe("CI harness — migrate → shadow read round-trip", () => {
  it("can run without browser localStorage data or a signed-in session", async () => {
    // Fixtures come from the mocked store + in-memory Supabase only — nothing is
    // read from real localStorage and no auth session is required.
    seedHealthyFixtures();

    const migrate = await migrateCustomerAgreements({ companyId: "cmp_1" });
    expect(migrate.ok).toBe(true);
    expect(migrate.dryRun).toBe(false);
    expect(migrate.error).toBeUndefined();
  });

  it("derives a synthetic agreement, upserts parent-before-child, and reads back ok=true", async () => {
    seedHealthyFixtures();

    const migrate = await migrateCustomerAgreements({ companyId: "cmp_1" });
    expect(migrate.ok).toBe(true);
    expect(migrate.migratedCount).toBe(1);
    expect(migrate.migratedLineCount).toBe(1);
    expect(migrate.writtenCount).toBe(1);
    expect(migrate.writtenLineCount).toBe(1);

    // Parent agreement must be written before any child line references it.
    const agreements = harnessSupabase.db.get("customer_agreements") ?? [];
    const lines = harnessSupabase.db.get("customer_agreement_lines") ?? [];
    expect(agreements).toHaveLength(1);
    expect(lines).toHaveLength(1);
    expect(lines[0].agreement_legacy_id).toBe(agreements[0].legacy_id);

    const shadow = await shadowReadCustomerAgreements("cmp_1");
    expect(shadow.ok).toBe(true);
    expect(shadow.localAgreementCount).toBe(1);
    expect(shadow.supabaseAgreementCount).toBe(1);
    expect(shadow.matchedCount).toBe(1);
    expect(shadow.mismatchCount).toBe(0);
    expect(shadow.lineMismatchCount).toBe(0);
    expect(shadow.missingInSupabase).toEqual([]);
    expect(shadow.extraInSupabase).toEqual([]);
    expect(shadow.supabaseReadFailures).toBe(0);
  });

  it("is idempotent — a second migrate produces the same single row, still ok=true", async () => {
    seedHealthyFixtures();

    await migrateCustomerAgreements({ companyId: "cmp_1" });
    const second = await migrateCustomerAgreements({ companyId: "cmp_1" });
    expect(second.ok).toBe(true);
    expect((harnessSupabase.db.get("customer_agreements") ?? []).length).toBe(1);
    expect((harnessSupabase.db.get("customer_agreement_lines") ?? []).length).toBe(1);

    const shadow = await shadowReadCustomerAgreements("cmp_1");
    expect(shadow.ok).toBe(true);
  });
});

describe("CI harness — mismatch detection", () => {
  it("detects a header mismatch when the Supabase copy drifts", async () => {
    seedHealthyFixtures();
    await migrateCustomerAgreements({ companyId: "cmp_1" });

    // Drift the stored agreement's status away from the derived "draft".
    const stored = harnessSupabase.db.get("customer_agreements") ?? [];
    (stored[0].data as CustomerAgreement).status = "active";
    stored[0].status = "active";

    const shadow = await shadowReadCustomerAgreements("cmp_1");
    expect(shadow.ok).toBe(false);
    expect(shadow.mismatchCount).toBeGreaterThan(0);
    expect(shadow.notes.some((n) => n.includes("header mismatch"))).toBe(true);
  });

  it("detects a line price mismatch when the Supabase copy drifts", async () => {
    seedHealthyFixtures();
    await migrateCustomerAgreements({ companyId: "cmp_1" });

    const storedLines = harnessSupabase.db.get("customer_agreement_lines") ?? [];
    (storedLines[0].data as { agreedPrice: number }).agreedPrice = 999;

    const shadow = await shadowReadCustomerAgreements("cmp_1");
    expect(shadow.ok).toBe(false);
    expect(shadow.lineMismatchCount).toBeGreaterThan(0);
    expect(shadow.notes.some((n) => n.includes("line mismatch"))).toBe(true);
  });

  it("flags an agreement present locally but missing from Supabase", async () => {
    seedHealthyFixtures();
    // No migrate — Supabase stays empty while a local synthetic agreement exists.
    const shadow = await shadowReadCustomerAgreements("cmp_1");
    expect(shadow.ok).toBe(false);
    expect(shadow.missingInSupabase).toContain(syntheticAgreementId("cust_1"));
  });
});

describe("CI harness — skip behavior", () => {
  it("skips a customer with no service rows and still migrates the healthy one", async () => {
    harnessSupabase.seedCompany("cmp_1", COMPANY_UUID);
    harnessStore.services = [makeService({ id: "svc_home" })];
    harnessStore.customers = [
      makeCustomer({ id: "cust_ok", name: "Has work" }),
      makeCustomer({ id: "cust_empty", name: "No work" }),
    ];
    harnessStore.workOrders = [
      makeWorkOrder([makeRow({ id: "row_ok", sourceServiceId: "svc_home" })], {
        id: "wo_ok",
        customerId: "cust_ok",
      }),
    ];

    const migrate = await migrateCustomerAgreements({ companyId: "cmp_1" });
    expect(migrate.migratedCount).toBe(1);
    expect(migrate.skippedCount).toBe(1);
    expect(migrate.skipped.some((s) => s.customerId === "cust_empty")).toBe(true);

    const shadow = await shadowReadCustomerAgreements("cmp_1");
    expect(shadow.skippedCount).toBe(1);
    expect(shadow.ok).toBe(true);
  });

  it("skips when no Supabase company exists for the legacy_id (RLS would reject)", async () => {
    // Intentionally do NOT seed the company UUID.
    harnessStore.customers = [makeCustomer()];
    harnessStore.services = [makeService({ id: "svc_home" })];
    harnessStore.workOrders = [makeWorkOrder([makeRow({ sourceServiceId: "svc_home" })])];

    const migrate = await migrateCustomerAgreements({ companyId: "cmp_1" });
    expect(migrate.migratedCount).toBe(0);
    expect(migrate.skipped.some((s) => s.reason.includes("No Supabase company"))).toBe(true);
    expect((harnessSupabase.db.get("customer_agreements") ?? []).length).toBe(0);
  });
});

describe("CI harness — missing service handling", () => {
  it("counts and warns when a source service id cannot be resolved", async () => {
    harnessSupabase.seedCompany("cmp_1", COMPANY_UUID);
    harnessStore.customers = [makeCustomer()];
    harnessStore.services = []; // catalog is empty → unresolved source service
    harnessStore.workOrders = [
      makeWorkOrder([makeRow({ id: "row_x", sourceServiceId: "svc_missing" })]),
    ];

    const migrate = await migrateCustomerAgreements({ companyId: "cmp_1" });
    expect(migrate.missingServiceCount).toBe(1);
    expect(migrate.warnings.some((w) => w.includes("not found in catalog"))).toBe(true);

    const shadow = await shadowReadCustomerAgreements("cmp_1");
    expect(shadow.missingServiceCount).toBe(1);
    // A missing catalog service does not by itself break round-trip equality.
    expect(shadow.ok).toBe(true);
  });
});

describe("CI harness — warning counts", () => {
  it("surfaces the synthetic billing default plus a missing-price warning", async () => {
    harnessSupabase.seedCompany("cmp_1", COMPANY_UUID);
    harnessStore.customers = [makeCustomer()];
    harnessStore.services = [makeService({ id: "svc_home" })];
    harnessStore.workOrders = [
      makeWorkOrder([makeRow({ sourceServiceId: "svc_home", price: undefined })]),
    ];

    const migrate = await migrateCustomerAgreements({ companyId: "cmp_1" });
    expect(migrate.warningCount).toBeGreaterThanOrEqual(2);
    expect(migrate.warnings.some((w) => w.includes("synthetic billingModel"))).toBe(true);
    expect(migrate.warnings.some((w) => w.includes("no price"))).toBe(true);
  });
});

describe("CI harness — Supabase read failure injection", () => {
  it("reports a read failure (not a crash) when the agreements list query fails", async () => {
    seedHealthyFixtures();
    await migrateCustomerAgreements({ companyId: "cmp_1" });

    harnessSupabase.failTable("customer_agreements");
    const shadow = await shadowReadCustomerAgreements("cmp_1");
    expect(shadow.ok).toBe(false);
    expect(shadow.supabaseReadFailures).toBeGreaterThan(0);
  });
});

// ── A. Upsert / write-failure coverage ───────────────────
describe("CI harness — write failure injection", () => {
  it("aborts with ok=false and an error when the agreement upsert fails (nothing written)", async () => {
    seedHealthyFixtures();
    harnessSupabase.failTable("customer_agreements");

    const migrate = await migrateCustomerAgreements({ companyId: "cmp_1" });
    expect(migrate.ok).toBe(false);
    expect(migrate.error).toBeDefined();
    expect(migrate.error).toContain("Agreement upsert failed");
    // Failed at the first chunk → no agreements counted as written, and no lines.
    expect(migrate.writtenCount).toBe(0);
    expect(migrate.writtenLineCount).toBe(0);
    expect((harnessSupabase.db.get("customer_agreements") ?? []).length).toBe(0);
    expect((harnessSupabase.db.get("customer_agreement_lines") ?? []).length).toBe(0);
  });

  it("writes parents then aborts when only the line upsert fails (writtenCount reflects parents)", async () => {
    seedHealthyFixtures();
    harnessSupabase.failTable("customer_agreement_lines");

    const migrate = await migrateCustomerAgreements({ companyId: "cmp_1" });
    expect(migrate.ok).toBe(false);
    expect(migrate.error).toContain("Line upsert failed");
    // Parents committed before children → agreements written, lines aborted at chunk 0.
    expect(migrate.writtenCount).toBe(1);
    expect(migrate.writtenLineCount).toBe(0);
    expect((harnessSupabase.db.get("customer_agreements") ?? []).length).toBe(1);
    expect((harnessSupabase.db.get("customer_agreement_lines") ?? []).length).toBe(0);
  });
});

// ── B. Chunking behaviour (>200 agreements) ──────────────
describe("CI harness — chunked migration", () => {
  it("writes every agreement across multiple chunks (>200)", async () => {
    harnessSupabase.seedCompany("cmp_1", COMPANY_UUID);
    harnessStore.services = [makeService({ id: "svc_home" })];

    const COUNT = 250; // forces two chunks at CHUNK=200
    harnessStore.customers = Array.from({ length: COUNT }, (_unused, i) =>
      makeCustomer({ id: `cust_${i}`, customerNumber: `C-${i}` }),
    );
    harnessStore.workOrders = Array.from({ length: COUNT }, (_unused, i) =>
      makeWorkOrder([makeRow({ id: `row_${i}`, sourceServiceId: "svc_home" })], {
        id: `wo_${i}`,
        customerId: `cust_${i}`,
      }),
    );

    const migrate = await migrateCustomerAgreements({ companyId: "cmp_1" });
    expect(migrate.ok).toBe(true);
    expect(migrate.migratedCount).toBe(COUNT);
    expect(migrate.writtenCount).toBe(COUNT);
    expect(migrate.writtenLineCount).toBe(COUNT);
    expect((harnessSupabase.db.get("customer_agreements") ?? []).length).toBe(COUNT);

    const shadow = await shadowReadCustomerAgreements("cmp_1");
    expect(shadow.ok).toBe(true);
    expect(shadow.supabaseAgreementCount).toBe(COUNT);
    expect(shadow.matchedCount).toBe(COUNT);
  });
});

// ── C. Shadow-read edge cases ────────────────────────────
describe("CI harness — shadow-read edge cases", () => {
  it("flags extra/orphaned Supabase agreements after the local customer is deleted", async () => {
    seedHealthyFixtures();
    await migrateCustomerAgreements({ companyId: "cmp_1" });

    // Delete the local customer + its work orders (Supabase row is now orphaned).
    harnessStore.customers = [];
    harnessStore.workOrders = [];

    const shadow = await shadowReadCustomerAgreements("cmp_1");
    expect(shadow.ok).toBe(false);
    expect(shadow.localAgreementCount).toBe(0);
    expect(shadow.extraInSupabase).toContain(syntheticAgreementId("cust_1"));
    expect(shadow.missingCustomerCount).toBe(1);
    expect(shadow.notes.some((n) => n.includes("missing customer"))).toBe(true);
  });
});

// ── D. Version-chain anomalies ───────────────────────────
describe("CI harness — version-chain anomalies", () => {
  it("reports a chain anomaly when an unexpected extra version exists in the group", async () => {
    seedHealthyFixtures();
    await migrateCustomerAgreements({ companyId: "cmp_1" });

    // Inject a phantom v2 sharing the same agreement_group_id.
    const stored = harnessSupabase.db.get("customer_agreements") ?? [];
    stored.push({ ...stored[0], legacy_id: "synthagr-cust_1-v2", version: 2 });

    const shadow = await shadowReadCustomerAgreements("cmp_1");
    expect(shadow.ok).toBe(false);
    expect(shadow.mismatchCount).toBeGreaterThan(0);
    expect(shadow.notes.some((n) => n.includes("version chain unexpected"))).toBe(true);
  });

  it("reports a read failure when a summary exists but its detail record is missing", async () => {
    seedHealthyFixtures();
    await migrateCustomerAgreements({ companyId: "cmp_1" });

    // Null out the lossless `data` payload → getDetail resolves to null.
    const stored = harnessSupabase.db.get("customer_agreements") ?? [];
    stored[0].data = null;

    const shadow = await shadowReadCustomerAgreements("cmp_1");
    expect(shadow.ok).toBe(false);
    expect(shadow.supabaseReadFailures).toBeGreaterThan(0);
    expect(shadow.notes.some((n) => n.includes("detail missing"))).toBe(true);
  });
});

// ── E. Self-healing (drift → re-migrate → clean) ─────────
describe("CI harness — self-healing round-trip", () => {
  it("re-running migration repairs a drifted Supabase row back to a clean shadow read", async () => {
    seedHealthyFixtures();

    // 1. Initial migration.
    await migrateCustomerAgreements({ companyId: "cmp_1" });

    // 2. Introduce drift on the stored copy.
    const stored = harnessSupabase.db.get("customer_agreements") ?? [];
    (stored[0].data as CustomerAgreement).status = "active";
    stored[0].status = "active";

    // 3. Shadow read sees the mismatch.
    const drifted = await shadowReadCustomerAgreements("cmp_1");
    expect(drifted.ok).toBe(false);
    expect(drifted.mismatchCount).toBeGreaterThan(0);

    // 4. Re-run migration (idempotent upsert overwrites the drift).
    const repair = await migrateCustomerAgreements({ companyId: "cmp_1" });
    expect(repair.ok).toBe(true);

    // 5. Shadow read is clean again.
    const healed = await shadowReadCustomerAgreements("cmp_1");
    expect(healed.ok).toBe(true);
    expect(healed.mismatchCount).toBe(0);
    expect(healed.matchedCount).toBe(1);
  });
});

// ── F. Scope variations ──────────────────────────────────
describe("CI harness — scope variations", () => {
  it("migrates all companies when companyId is null", async () => {
    harnessSupabase.seedCompany("cmp_1", COMPANY_UUID);
    harnessSupabase.seedCompany("cmp_2", COMPANY_UUID_2);
    harnessStore.services = [
      makeService({ id: "svc_home", companyId: "cmp_1" }),
      makeService({ id: "svc_home2", companyId: "cmp_2" }),
    ];
    harnessStore.customers = [
      makeCustomer({ id: "cust_a", companyId: "cmp_1" }),
      makeCustomer({ id: "cust_b", companyId: "cmp_2" }),
    ];
    harnessStore.workOrders = [
      makeWorkOrder([makeRow({ id: "row_a", sourceServiceId: "svc_home" })], {
        id: "wo_a",
        companyId: "cmp_1",
        customerId: "cust_a",
      }),
      makeWorkOrder([makeRow({ id: "row_b", sourceServiceId: "svc_home2" })], {
        id: "wo_b",
        companyId: "cmp_2",
        customerId: "cust_b",
      }),
    ];

    const migrate = await migrateCustomerAgreements({ companyId: null });
    expect(migrate.ok).toBe(true);
    expect(migrate.migratedCount).toBe(2);

    const shadow = await shadowReadCustomerAgreements(null);
    expect(shadow.ok).toBe(true);
    expect(shadow.supabaseAgreementCount).toBe(2);
  });

  it("scopes a single-company migration so the other company is untouched", async () => {
    harnessSupabase.seedCompany("cmp_1", COMPANY_UUID);
    harnessSupabase.seedCompany("cmp_2", COMPANY_UUID_2);
    harnessStore.services = [
      makeService({ id: "svc_home", companyId: "cmp_1" }),
      makeService({ id: "svc_home2", companyId: "cmp_2" }),
    ];
    harnessStore.customers = [
      makeCustomer({ id: "cust_a", companyId: "cmp_1" }),
      makeCustomer({ id: "cust_b", companyId: "cmp_2" }),
    ];
    harnessStore.workOrders = [
      makeWorkOrder([makeRow({ id: "row_a", sourceServiceId: "svc_home" })], {
        id: "wo_a",
        companyId: "cmp_1",
        customerId: "cust_a",
      }),
      makeWorkOrder([makeRow({ id: "row_b", sourceServiceId: "svc_home2" })], {
        id: "wo_b",
        companyId: "cmp_2",
        customerId: "cust_b",
      }),
    ];

    const migrate = await migrateCustomerAgreements({ companyId: "cmp_1" });
    expect(migrate.migratedCount).toBe(1);
    expect((harnessSupabase.db.get("customer_agreements") ?? []).length).toBe(1);

    const shadow = await shadowReadCustomerAgreements("cmp_1");
    expect(shadow.ok).toBe(true);
    expect(shadow.supabaseAgreementCount).toBe(1);
  });

  it("getDetail rejects an agreement read from the wrong company scope", async () => {
    seedHealthyFixtures();
    await migrateCustomerAgreements({ companyId: "cmp_1" });
    const id = syntheticAgreementId("cust_1");

    // Correct scope resolves; mismatched scope is rejected (RLS-equivalent).
    const correct = await supabaseCustomerAgreementRepository.getDetail(id, {
      companyId: "cmp_1",
    });
    expect(correct?.id).toBe(id);

    const wrongScope = await supabaseCustomerAgreementRepository.getDetail(id, {
      companyId: "cmp_2",
    });
    expect(wrongScope).toBeNull();
  });
});

// ── G. Dry-run validation ────────────────────────────────
describe("CI harness — dry run", () => {
  it("plans the migration but writes nothing when dryRun=true", async () => {
    seedHealthyFixtures();

    const migrate = await migrateCustomerAgreements({ companyId: "cmp_1", dryRun: true });
    expect(migrate.ok).toBe(true);
    expect(migrate.dryRun).toBe(true);
    // The plan is still computed…
    expect(migrate.migratedCount).toBe(1);
    expect(migrate.migratedLineCount).toBe(1);
    // …but nothing is committed.
    expect(migrate.writtenCount).toBe(0);
    expect(migrate.writtenLineCount).toBe(0);
    expect((harnessSupabase.db.get("customer_agreements") ?? []).length).toBe(0);
    expect((harnessSupabase.db.get("customer_agreement_lines") ?? []).length).toBe(0);
  });
});
