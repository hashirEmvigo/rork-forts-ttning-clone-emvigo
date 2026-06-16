import { describe, expect, it } from "vitest";

import {
  canBeSuperseded,
  createNewAgreementVersion,
  diffRequiresNewVersion,
  findVersionById,
  isLiveStatus,
  isTerminalStatus,
  listVersionsForGroup,
  normalizeToVersionOne,
  resolveCurrentVersion,
  resolveVersionActiveOn,
  snapshotLinesForNewVersion,
  timeBankWalletBindingKey,
  validateVersionChain,
} from "./agreementVersioning";
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
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

// ── Status helpers ──────────────────────────────────────────

describe("status helpers", () => {
  it("classifies terminal vs live statuses", () => {
    expect(isTerminalStatus("superseded")).toBe(true);
    expect(isTerminalStatus("cancelled")).toBe(true);
    expect(isTerminalStatus("ended")).toBe(true);
    expect(isTerminalStatus("active")).toBe(false);
    expect(isLiveStatus("draft")).toBe(true);
    expect(isLiveStatus("paused")).toBe(true);
    expect(isLiveStatus("ended")).toBe(false);
  });

  it("only allows active/paused to be superseded", () => {
    expect(canBeSuperseded("active")).toBe(true);
    expect(canBeSuperseded("paused")).toBe(true);
    expect(canBeSuperseded("draft")).toBe(false);
    expect(canBeSuperseded("superseded")).toBe(false);
    expect(canBeSuperseded("cancelled")).toBe(false);
    expect(canBeSuperseded("ended")).toBe(false);
  });
});

// ── Resolvers ───────────────────────────────────────────────

describe("listVersionsForGroup / findVersionById", () => {
  it("filters by group and sorts ascending without mutating input", () => {
    const v2 = makeAgreement({ id: "agr_v2", version: 2 });
    const v1 = makeAgreement({ id: "agr_v1", version: 1 });
    const other = makeAgreement({ id: "x", agreementGroupId: "grp_other", version: 1 });
    const input = [v2, other, v1];
    const result = listVersionsForGroup(input, "grp_1");
    expect(result.map((v) => v.id)).toEqual(["agr_v1", "agr_v2"]);
    // input order preserved (not mutated)
    expect(input[0]).toBe(v2);
  });

  it("finds a version by id or returns null", () => {
    const versions = [makeAgreement()];
    expect(findVersionById(versions, "agr_v1")?.id).toBe("agr_v1");
    expect(findVersionById(versions, "missing")).toBeNull();
  });
});

describe("resolveCurrentVersion", () => {
  it("returns the highest-version non-terminal version", () => {
    const v1 = makeAgreement({ id: "agr_v1", version: 1, status: "superseded" });
    const v2 = makeAgreement({ id: "agr_v2", version: 2, status: "active" });
    expect(resolveCurrentVersion([v1, v2])?.id).toBe("agr_v2");
  });

  it("returns null when every version is terminal", () => {
    const v1 = makeAgreement({ id: "agr_v1", version: 1, status: "superseded" });
    const v2 = makeAgreement({ id: "agr_v2", version: 2, status: "ended" });
    expect(resolveCurrentVersion([v1, v2])).toBeNull();
  });

  it("treats draft and paused as live", () => {
    expect(resolveCurrentVersion([makeAgreement({ status: "draft" })])?.id).toBe("agr_v1");
    expect(resolveCurrentVersion([makeAgreement({ status: "paused" })])?.id).toBe("agr_v1");
  });
});

describe("resolveVersionActiveOn (historical reads by date)", () => {
  const v1 = makeAgreement({
    id: "agr_v1",
    version: 1,
    status: "superseded",
    validFrom: "2026-01-01",
    validTo: "2026-06-30",
  });
  const v2 = makeAgreement({
    id: "agr_v2",
    version: 2,
    status: "active",
    validFrom: "2026-07-01",
    validTo: null,
  });
  const chain = [v1, v2];

  it("resolves the version in effect for a past date (superseded included)", () => {
    expect(resolveVersionActiveOn(chain, "2026-03-15")?.id).toBe("agr_v1");
  });

  it("resolves the open-ended current version for a later date", () => {
    expect(resolveVersionActiveOn(chain, "2027-01-01")?.id).toBe("agr_v2");
  });

  it("returns null when no version covers the date", () => {
    expect(resolveVersionActiveOn(chain, "2025-12-31")).toBeNull();
  });

  it("prefers the highest version when validity windows overlap", () => {
    const a = makeAgreement({ id: "a", version: 1, validFrom: "2026-01-01", validTo: null });
    const b = makeAgreement({ id: "b", version: 2, validFrom: "2026-01-01", validTo: null });
    expect(resolveVersionActiveOn([a, b], "2026-05-05")?.id).toBe("b");
  });
});

// ── Version creation ────────────────────────────────────────

describe("createNewAgreementVersion", () => {
  it("creates a v2 that supersedes v1 without mutating v1 (immutable history)", () => {
    const v1 = makeAgreement();
    const frozen = JSON.stringify(v1);

    const { previous, next } = createNewAgreementVersion(v1, {
      newAgreementId: "agr_v2",
      now: "2026-07-01T00:00:00.000Z",
      changes: { billingModel: "monthly_fixed", invoiceInterval: "quarterly" },
    });

    // original object is untouched
    expect(JSON.stringify(v1)).toBe(frozen);

    expect(previous.status).toBe("superseded");
    expect(previous.supersededById).toBe("agr_v2");

    expect(next.id).toBe("agr_v2");
    expect(next.version).toBe(2);
    expect(next.agreementGroupId).toBe(v1.agreementGroupId);
    expect(next.status).toBe("active");
    expect(next.supersedesVersionId).toBe("agr_v1");
    expect(next.supersededById).toBeNull();
    expect(next.billingModel).toBe("monthly_fixed");
    expect(next.invoiceInterval).toBe("quarterly");
  });

  it("inherits unchanged fields from the prior version", () => {
    const v1 = makeAgreement({ name: "Keep me", validFrom: "2026-01-01" });
    const { next } = createNewAgreementVersion(v1, {
      newAgreementId: "agr_v2",
      now: NOW,
      changes: { billingModel: "hybrid" },
    });
    expect(next.name).toBe("Keep me");
    expect(next.validFrom).toBe("2026-01-01");
    expect(next.invoiceInterval).toBe("monthly");
  });

  it("can start the new version as draft", () => {
    const { next } = createNewAgreementVersion(makeAgreement(), {
      newAgreementId: "agr_v2",
      now: NOW,
      newStatus: "draft",
    });
    expect(next.status).toBe("draft");
  });

  it("throws when the current version cannot be superseded", () => {
    for (const status of ["draft", "superseded", "cancelled", "ended"] as const) {
      expect(() =>
        createNewAgreementVersion(makeAgreement({ status }), {
          newAgreementId: "agr_v2",
          now: NOW,
        }),
      ).toThrow();
    }
  });

  it("supports superseding a paused version", () => {
    const { previous, next } = createNewAgreementVersion(makeAgreement({ status: "paused" }), {
      newAgreementId: "agr_v2",
      now: NOW,
    });
    expect(previous.status).toBe("superseded");
    expect(next.version).toBe(2);
  });
});

describe("snapshotLinesForNewVersion", () => {
  it("clones lines onto the new version without mutating the originals", () => {
    const v2 = makeAgreement({ id: "agr_v2", agreementGroupId: "grp_1", version: 2 });
    const lines = [
      makeLine({ id: "line_1", sortOrder: 0, agreedPrice: 1000 }),
      makeLine({ id: "line_2", sortOrder: 1, agreedPrice: 500 }),
    ];
    const frozen = JSON.stringify(lines);

    const snapshot = snapshotLinesForNewVersion(
      lines,
      v2,
      (_l, i) => `line_v2_${i}`,
      "2026-07-01T00:00:00.000Z",
    );

    // originals untouched — historical terms immutable
    expect(JSON.stringify(lines)).toBe(frozen);

    expect(snapshot.map((l) => l.id)).toEqual(["line_v2_0", "line_v2_1"]);
    expect(snapshot.every((l) => l.agreementId === "agr_v2")).toBe(true);
    expect(snapshot.every((l) => l.agreementGroupId === "grp_1")).toBe(true);
    // commercial values are carried forward verbatim
    expect(snapshot[0].agreedPrice).toBe(1000);
    expect(snapshot[1].agreedPrice).toBe(500);
  });
});

// ── Change classification ───────────────────────────────────

describe("diffRequiresNewVersion", () => {
  const current = makeAgreement({ billingModel: "per_visit", invoiceInterval: "monthly" });
  const currentLines = [makeLine({ id: "line_1", agreedPrice: 1000 })];

  it("requires a new version on a price change", () => {
    const result = diffRequiresNewVersion(
      current,
      currentLines,
      { billingModel: "per_visit", invoiceInterval: "monthly", validFrom: "2026-01-01", validTo: null },
      [makeLine({ id: "line_1", agreedPrice: 1200 })],
    );
    expect(result.requiresNewVersion).toBe(true);
    expect(result.reasons.some((r) => r.includes("agreedPrice"))).toBe(true);
  });

  it("requires a new version on a billing-model change", () => {
    const result = diffRequiresNewVersion(
      current,
      currentLines,
      { billingModel: "hybrid", invoiceInterval: "monthly", validFrom: "2026-01-01", validTo: null },
      currentLines,
    );
    expect(result.requiresNewVersion).toBe(true);
    expect(result.reasons.some((r) => r.includes("billingModel"))).toBe(true);
  });

  it("requires a new version on an invoice-interval (frequency) change", () => {
    const result = diffRequiresNewVersion(
      current,
      currentLines,
      { billingModel: "per_visit", invoiceInterval: "quarterly", validFrom: "2026-01-01", validTo: null },
      currentLines,
    );
    expect(result.requiresNewVersion).toBe(true);
    expect(result.reasons.some((r) => r.includes("invoiceInterval"))).toBe(true);
  });

  it("requires a new version on a service change", () => {
    const result = diffRequiresNewVersion(
      current,
      currentLines,
      { billingModel: "per_visit", invoiceInterval: "monthly", validFrom: "2026-01-01", validTo: null },
      [makeLine({ id: "line_1", sourceServiceId: "svc_other", serviceNameSnapshot: "Window" })],
    );
    expect(result.requiresNewVersion).toBe(true);
    expect(result.reasons.some((r) => r.includes("sourceServiceId"))).toBe(true);
  });

  it("requires a new version on a line count change", () => {
    const result = diffRequiresNewVersion(
      current,
      currentLines,
      { billingModel: "per_visit", invoiceInterval: "monthly", validFrom: "2026-01-01", validTo: null },
      [...currentLines, makeLine({ id: "line_2" })],
    );
    expect(result.requiresNewVersion).toBe(true);
    expect(result.reasons.some((r) => r.includes("line count"))).toBe(true);
  });

  it("does NOT require a new version for a validTo extension with unchanged terms", () => {
    const result = diffRequiresNewVersion(
      current,
      currentLines,
      { billingModel: "per_visit", invoiceInterval: "monthly", validFrom: "2026-01-01", validTo: "2027-12-31" },
      currentLines,
    );
    expect(result.requiresNewVersion).toBe(false);
    expect(result.reasons).toEqual([]);
  });
});

// ── Migration / compatibility ───────────────────────────────

describe("normalizeToVersionOne", () => {
  it("forces version 1 and clears supersede links without mutating input", () => {
    const legacy = makeAgreement({ version: 3, supersedesVersionId: "x", supersededById: "y" });
    const frozen = JSON.stringify(legacy);
    const v1 = normalizeToVersionOne(legacy);
    expect(JSON.stringify(legacy)).toBe(frozen);
    expect(v1.version).toBe(1);
    expect(v1.supersedesVersionId).toBeNull();
    expect(v1.supersededById).toBeNull();
  });
});

// ── Chain integrity ─────────────────────────────────────────

describe("validateVersionChain", () => {
  it("accepts a clean v1→v2 chain with a single live head", () => {
    const v1 = makeAgreement({
      id: "agr_v1",
      version: 1,
      status: "superseded",
      supersededById: "agr_v2",
    });
    const v2 = makeAgreement({
      id: "agr_v2",
      version: 2,
      status: "active",
      supersedesVersionId: "agr_v1",
    });
    const result = validateVersionChain([v2, v1]);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.liveVersionId).toBe("agr_v2");
    expect(result.liveCount).toBe(1);
  });

  it("flags multiple live versions", () => {
    const v1 = makeAgreement({ id: "agr_v1", version: 1, status: "active" });
    const v2 = makeAgreement({ id: "agr_v2", version: 2, status: "active" });
    const result = validateVersionChain([v1, v2]);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.includes("multiple live versions"))).toBe(true);
    expect(result.liveCount).toBe(2);
  });

  it("flags a version sequence gap", () => {
    const v1 = makeAgreement({ id: "agr_v1", version: 1, status: "superseded" });
    const v3 = makeAgreement({ id: "agr_v3", version: 3, status: "active" });
    const result = validateVersionChain([v1, v3]);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.includes("sequence gap"))).toBe(true);
  });

  it("flags a broken supersede link", () => {
    const v1 = makeAgreement({
      id: "agr_v1",
      version: 1,
      status: "superseded",
      supersededById: "ghost",
    });
    const result = validateVersionChain([v1]);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.includes("not found in chain"))).toBe(true);
  });

  it("flags a non-terminal version that has a successor", () => {
    const v1 = makeAgreement({
      id: "agr_v1",
      version: 1,
      status: "active",
      supersededById: "agr_v2",
    });
    const v2 = makeAgreement({
      id: "agr_v2",
      version: 2,
      status: "active",
      supersedesVersionId: "agr_v1",
    });
    const result = validateVersionChain([v1, v2]);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.includes("not terminal"))).toBe(true);
  });
});

// ── Self-healing: create a version, validate the resulting chain ──

describe("end-to-end version creation → chain validity", () => {
  it("produces a valid, single-live chain after superseding", () => {
    const v1 = makeAgreement();
    const { previous, next } = createNewAgreementVersion(v1, {
      newAgreementId: "agr_v2",
      now: "2026-07-01T00:00:00.000Z",
      changes: { invoiceInterval: "quarterly", validFrom: "2026-07-01" },
    });

    const result = validateVersionChain([previous, next]);
    expect(result.ok).toBe(true);
    expect(result.liveVersionId).toBe("agr_v2");
    expect(resolveCurrentVersion([previous, next])?.id).toBe("agr_v2");

    // v1 still resolvable for its historical window
    const previousWithWindow = { ...previous, validTo: "2026-06-30" };
    expect(resolveVersionActiveOn([previousWithWindow, next], "2026-03-01")?.id).toBe("agr_v1");
  });
});

// ── Time Bank binding contract ──────────────────────────────

describe("timeBankWalletBindingKey", () => {
  it("binds to the stable agreementGroupId, not the version id", () => {
    const v1 = makeAgreement();
    const { next } = createNewAgreementVersion(v1, {
      newAgreementId: "agr_v2",
      now: NOW,
      changes: { billingModel: "time_bank" },
    });

    // Wallet key is identical across versions even though the version id changed.
    expect(timeBankWalletBindingKey(v1)).toBe("grp_1");
    expect(timeBankWalletBindingKey(next)).toBe("grp_1");
    expect(timeBankWalletBindingKey(v1)).toBe(timeBankWalletBindingKey(next));
    expect(timeBankWalletBindingKey(next)).not.toBe(next.id);
  });
});
