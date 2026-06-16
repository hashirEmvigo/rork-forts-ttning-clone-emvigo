/**
 * Versioning harness validation (Phase 2 · CI-safe, shadow only).
 *
 * Extends the Customer Agreement validation strategy so that VERSION CHAINS are
 * exercised end-to-end with NO browser localStorage and NO signed-in Supabase
 * session. It reuses the proven in-memory Supabase stand-in + seeded fixtures
 * from `customerAgreementHarness` (via the same `vi.mock` wiring as the Phase-1
 * harness), and persists multi-version chains through the EXISTING upsert
 * mappers so they read back through the real repository read surface
 * (`listVersionChain` / `getDetail` / `listLines`).
 *
 * What this proves:
 *   * createNewAgreementVersion → persist → repository read-back round-trips.
 *   * Multi-version chains (v1 → v2 → v3, superseded links, single live head).
 *   * Historical integrity — old versions + line snapshots stay byte-stable.
 *   * Agreement-group stability — agreementGroupId constant, version ids change.
 *   * Shadow-read compatibility AND its single-version SCOPE (the Phase-1 bridge
 *     derives one synthetic v1 and FLAGS any chain growth — it is not a full
 *     chain validator).
 *   * Drift detection + self-healing of value drift via idempotent re-persist.
 *   * Time Bank readiness — the wallet binding key stays agreementGroupId across
 *     unlimited revisions and is never a version id.
 *
 * SAFETY — identical guarantees to the Phase-1 harness: no network, no env, no
 * localStorage, no real Supabase, no activation, no production-authoritative
 * flip. Pure validation.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createNewAgreementVersion,
  resolveCurrentVersion,
  resolveCurrentVersionForGroup,
  resolveVersionActiveOn,
  snapshotLinesForNewVersion,
  timeBankWalletBindingKey,
  validateVersionChain,
} from "./agreementVersioning";
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
import {
  supabaseCustomerAgreementRepository,
  toCustomerAgreementLineUpsertRow,
  toCustomerAgreementUpsertRow,
} from "./customerAgreementRepository";
import type { CustomerAgreement, CustomerAgreementLine } from "@/types";

// Replace the Supabase client + localStorage store with the shared in-memory
// harness (same singleton the Phase-1 harness test wires in).
vi.mock("@/lib/supabase", async () => {
  const { harnessSupabase: hs } = await import("./customerAgreementHarness");
  return {
    isSupabaseConfigured: true,
    supabase: hs.client,
    requireSupabase: () => hs.client,
  };
});

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

/** A base, supersedable (active) v1 agreement in group `grp_1`. */
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

/** A base agreement line for `grp1_v1`. */
function makeLine(over: Partial<CustomerAgreementLine> = {}): CustomerAgreementLine {
  return {
    id: "line_1",
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

/** Persists a set of agreement versions to the in-memory Supabase via the real mapper. */
async function persistChain(chain: CustomerAgreement[]): Promise<void> {
  const rows = chain.map((a) => toCustomerAgreementUpsertRow(a, COMPANY_UUID));
  await harnessSupabase.client
    .from("customer_agreements")
    .upsert(rows, { onConflict: "legacy_id" });
}

/** Persists agreement lines to the in-memory Supabase via the real mapper. */
async function persistLines(lines: CustomerAgreementLine[]): Promise<void> {
  const rows = lines.map((l) => toCustomerAgreementLineUpsertRow(l, COMPANY_UUID));
  await harnessSupabase.client
    .from("customer_agreement_lines")
    .upsert(rows, { onConflict: "legacy_id" });
}

/** Seeds one clean, fully-resolvable customer for the migrate-driven tests. */
function seedHealthyFixtures(): void {
  harnessSupabase.seedCompany(COMPANY, COMPANY_UUID);
  harnessStore.customers = [makeCustomer()];
  harnessStore.services = [makeService({ id: "svc_home", serviceBasisType: "billable" })];
  harnessStore.workOrders = [makeWorkOrder([makeRow({ sourceServiceId: "svc_home" })])];
}

beforeEach(() => {
  resetHarness();
  vi.clearAllMocks();
});

// ── A. Multi-version chains ──────────────────────────────
describe("versioning harness — multi-version chains", () => {
  it("persists a v1→v2→v3 chain that reads back as a single-live, valid chain", async () => {
    const v1 = makeAgreement();
    const step2 = createNewAgreementVersion(v1, {
      newAgreementId: "grp1_v2",
      now: T2,
      changes: { invoiceInterval: "quarterly", validFrom: "2026-04-01" },
    });
    const step3 = createNewAgreementVersion(step2.next, {
      newAgreementId: "grp1_v3",
      now: T3,
      changes: { billingModel: "monthly_fixed", validFrom: "2026-07-01" },
    });

    // Stored chain: v1 (superseded) → v2 (superseded) → v3 (active live head).
    await persistChain([step2.previous, step3.previous, step3.next]);

    const chain = await supabaseCustomerAgreementRepository.listVersionChain(GROUP, {
      companyId: COMPANY,
    });
    expect(chain.map((c) => c.version)).toEqual([1, 2, 3]);

    const integrity = validateVersionChain(chain);
    expect(integrity.ok).toBe(true);
    expect(integrity.liveCount).toBe(1);
    expect(integrity.liveVersionId).toBe("grp1_v3");

    expect(resolveCurrentVersion(chain)?.id).toBe("grp1_v3");

    const live = await resolveCurrentVersionForGroup(GROUP, { companyId: COMPANY });
    expect(live?.id).toBe("grp1_v3");
  });

  it("resolves the version in commercial effect on a historical date across the chain", async () => {
    const v1 = makeAgreement();
    const step2 = createNewAgreementVersion(v1, {
      newAgreementId: "grp1_v2",
      now: T2,
      changes: { validFrom: "2026-04-01" },
    });
    const step3 = createNewAgreementVersion(step2.next, {
      newAgreementId: "grp1_v3",
      now: T3,
      changes: { validFrom: "2026-07-01" },
    });
    await persistChain([step2.previous, step3.previous, step3.next]);

    const chain = await supabaseCustomerAgreementRepository.listVersionChain(GROUP, {
      companyId: COMPANY,
    });
    expect(resolveVersionActiveOn(chain, "2026-02-15")?.id).toBe("grp1_v1");
    expect(resolveVersionActiveOn(chain, "2026-05-15")?.id).toBe("grp1_v2");
    expect(resolveVersionActiveOn(chain, "2026-08-15")?.id).toBe("grp1_v3");
  });
});

// ── B. Historical integrity ──────────────────────────────
describe("versioning harness — historical integrity", () => {
  it("keeps v1 header + line snapshots byte-stable after v2 changes price and billing model", async () => {
    const v1 = makeAgreement();
    const v1Lines = [makeLine({ id: "line_1", agreedPrice: 1000 })];
    await persistChain([v1]);
    await persistLines(v1Lines);

    // v2 changes the billing model and the agreed price.
    const { previous, next } = createNewAgreementVersion(v1, {
      newAgreementId: "grp1_v2",
      now: T2,
      changes: { billingModel: "monthly_fixed" },
    });
    const v2Lines = snapshotLinesForNewVersion(
      v1Lines,
      next,
      (_l, i) => `grp1_v2_line_${i}`,
      T2,
    ).map((l) => ({ ...l, agreedPrice: 1500 }));
    await persistChain([previous, next]);
    await persistLines(v2Lines);

    // v1 lines are untouched — historical price stays 1000.
    const v1Back = await supabaseCustomerAgreementRepository.listLines("grp1_v1");
    expect(v1Back).toHaveLength(1);
    expect(v1Back[0].agreedPrice).toBe(1000);

    // v1 header keeps its original billing model (status flipped to superseded only).
    const v1Header = await supabaseCustomerAgreementRepository.getDetail("grp1_v1", {
      companyId: COMPANY,
    });
    expect(v1Header?.billingModel).toBe("per_visit");
    expect(v1Header?.status).toBe("superseded");

    // v2 carries the NEW commercial terms.
    const v2Back = await supabaseCustomerAgreementRepository.listLines("grp1_v2");
    expect(v2Back[0].agreedPrice).toBe(1500);
    const v2Header = await supabaseCustomerAgreementRepository.getDetail("grp1_v2", {
      companyId: COMPANY,
    });
    expect(v2Header?.billingModel).toBe("monthly_fixed");
    // v1 and v2 lines are independent records (distinct ids).
    expect(v1Back[0].id).not.toBe(v2Back[0].id);
  });
});

// ── C. Agreement-group stability ─────────────────────────
describe("versioning harness — agreement group stability", () => {
  it("keeps agreementGroupId constant while version ids and supersede links change", async () => {
    const v1 = makeAgreement();
    const step2 = createNewAgreementVersion(v1, { newAgreementId: "grp1_v2", now: T2 });
    const step3 = createNewAgreementVersion(step2.next, { newAgreementId: "grp1_v3", now: T3 });
    await persistChain([step2.previous, step3.previous, step3.next]);

    const chain = await supabaseCustomerAgreementRepository.listVersionChain(GROUP, {
      companyId: COMPANY,
    });

    // One stable group key across every version.
    expect(new Set(chain.map((c) => c.agreementGroupId))).toEqual(new Set([GROUP]));
    // Distinct version ids.
    expect(new Set(chain.map((c) => c.id)).size).toBe(3);
    // Supersede links remain valid and bidirectional.
    expect(chain[0].supersededById).toBe(chain[1].id);
    expect(chain[1].supersedesVersionId).toBe(chain[0].id);
    expect(chain[1].supersededById).toBe(chain[2].id);
    expect(chain[2].supersedesVersionId).toBe(chain[1].id);
    expect(chain[2].supersededById).toBeNull();
  });
});

// ── D. Shadow-read compatibility (and its single-version SCOPE) ──
describe("versioning harness — shadow-read compatibility", () => {
  it("a single synthetic v1 survives migration and shadow-reads clean", async () => {
    seedHealthyFixtures();
    const migrate = await migrateCustomerAgreements({ companyId: COMPANY });
    expect(migrate.ok).toBe(true);

    const shadow = await shadowReadCustomerAgreements(COMPANY);
    expect(shadow.ok).toBe(true);
    expect(shadow.matchedCount).toBe(1);
  });

  it("a synthetic draft cannot be superseded until activated (state-machine boundary)", async () => {
    seedHealthyFixtures();
    await migrateCustomerAgreements({ companyId: COMPANY });

    const draft = await supabaseCustomerAgreementRepository.getDetail(
      syntheticAgreementId("cust_1"),
      { companyId: COMPANY },
    );
    expect(draft?.status).toBe("draft");
    expect(() =>
      createNewAgreementVersion(draft as CustomerAgreement, {
        newAgreementId: "syn_v2",
        now: T2,
      }),
    ).toThrow();
  });

  it("the Phase-1 shadow bridge FLAGS chain growth — it is single-version scoped", async () => {
    seedHealthyFixtures();
    await migrateCustomerAgreements({ companyId: COMPANY });

    // Activate the synthetic v1, then add a real v2 in the same group.
    const v1 = await supabaseCustomerAgreementRepository.getDetail(
      syntheticAgreementId("cust_1"),
      { companyId: COMPANY },
    );
    const activated: CustomerAgreement = { ...(v1 as CustomerAgreement), status: "active" };
    const { previous, next } = createNewAgreementVersion(activated, {
      newAgreementId: `${activated.id}-v2`,
      now: T2,
    });
    await persistChain([previous, next]);

    const shadow = await shadowReadCustomerAgreements(COMPANY);
    expect(shadow.ok).toBe(false);
    // The bridge derives only v1, so the extra version is surfaced, not hidden.
    expect(shadow.notes.some((n) => n.includes("version chain unexpected"))).toBe(true);
    expect(shadow.extraInSupabase).toContain(`${activated.id}-v2`);
  });
});

// ── E. Drift and self-healing ────────────────────────────
describe("versioning harness — drift detection and self-healing", () => {
  it("detects a broken supersede link, then heals it via an idempotent re-persist", async () => {
    const v1 = makeAgreement();
    const { previous, next } = createNewAgreementVersion(v1, {
      newAgreementId: "grp1_v2",
      now: T2,
    });
    await persistChain([previous, next]);

    // 1. Clean chain.
    const clean = validateVersionChain(
      await supabaseCustomerAgreementRepository.listVersionChain(GROUP, { companyId: COMPANY }),
    );
    expect(clean.ok).toBe(true);

    // 2. Introduce drift on the stored copy only (replace its `data` with a
    // corrupted clone so the source `next` object stays clean — the DB row
    // drifts independently, exactly as a real out-of-band edit would).
    const stored = harnessSupabase.db.get("customer_agreements") ?? [];
    const v2Row = stored.find((r) => r.legacy_id === "grp1_v2");
    if (v2Row) {
      v2Row.data = {
        ...(v2Row.data as CustomerAgreement),
        supersedesVersionId: "ghost_version",
      };
    }

    // 3. Shadow integrity now reports the broken link.
    const drifted = validateVersionChain(
      await supabaseCustomerAgreementRepository.listVersionChain(GROUP, { companyId: COMPANY }),
    );
    expect(drifted.ok).toBe(false);
    expect(drifted.issues.some((i) => i.includes("not found in chain"))).toBe(true);

    // 4. Re-persist the correct chain (idempotent upsert overwrites the drift).
    await persistChain([previous, next]);

    // 5. Chain is valid again.
    const healed = validateVersionChain(
      await supabaseCustomerAgreementRepository.listVersionChain(GROUP, { companyId: COMPANY }),
    );
    expect(healed.ok).toBe(true);
    expect(healed.liveVersionId).toBe("grp1_v2");
  });

  it("re-running migration heals a drifted synthetic v1 row back to a clean shadow read", async () => {
    seedHealthyFixtures();
    await migrateCustomerAgreements({ companyId: COMPANY });

    // Drift the stored synthetic agreement away from its derived "draft" status.
    const stored = harnessSupabase.db.get("customer_agreements") ?? [];
    (stored[0].data as CustomerAgreement).status = "active";
    stored[0].status = "active";

    const drifted = await shadowReadCustomerAgreements(COMPANY);
    expect(drifted.ok).toBe(false);
    expect(drifted.mismatchCount).toBeGreaterThan(0);

    await migrateCustomerAgreements({ companyId: COMPANY });
    const healed = await shadowReadCustomerAgreements(COMPANY);
    expect(healed.ok).toBe(true);
    expect(healed.matchedCount).toBe(1);
  });
});

// ── F. Time Bank readiness proof ─────────────────────────
describe("versioning harness — Time Bank readiness", () => {
  it("keeps the wallet binding key = agreementGroupId across unlimited revisions", async () => {
    const v1 = makeAgreement();
    const step2 = createNewAgreementVersion(v1, {
      newAgreementId: "grp1_v2",
      now: T2,
      changes: { billingModel: "time_bank" },
    });
    const step3 = createNewAgreementVersion(step2.next, {
      newAgreementId: "grp1_v3",
      now: T3,
      changes: { invoiceInterval: "quarterly" },
    });
    await persistChain([step2.previous, step3.previous, step3.next]);

    const chain = await supabaseCustomerAgreementRepository.listVersionChain(GROUP, {
      companyId: COMPANY,
    });

    // One wallet key for the whole chain — wallet continuity survives versioning.
    const keys = new Set(chain.map(timeBankWalletBindingKey));
    expect(keys).toEqual(new Set([GROUP]));
    // The binding key is never a (mutable) version id.
    for (const version of chain) {
      expect(timeBankWalletBindingKey(version)).not.toBe(version.id);
    }
    // A future wallet bound to the group still resolves the live version it should bill against.
    const live = await resolveCurrentVersionForGroup(GROUP, { companyId: COMPANY });
    expect(timeBankWalletBindingKey(live as CustomerAgreement)).toBe(GROUP);
    expect(live?.id).toBe("grp1_v3");
  });
});
