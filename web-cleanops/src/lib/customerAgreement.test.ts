import { describe, expect, it } from "vitest";

import {
  AGREEMENT_STATUS_TRANSITIONS,
  assertStatusTransition,
  canBeSuperseded,
  canTransitionStatus,
  copyLinesToVersion,
  effectiveBillingModel,
  isBillingModelOverrideAllowed,
  isTerminalStatus,
  liveVersion,
  resolveLineTotal,
  sortVersionChain,
  supersedeAgreement,
  validateAgreement,
  validateLineBillingOverride,
} from "./customerAgreement";
import type {
  AgreementStatus,
  CustomerAgreement,
  CustomerAgreementLine,
} from "@/types";

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
    sourceType: "manual",
    sourceReferenceId: null,
    supersedesVersionId: null,
    supersededById: null,
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
    serviceNameSnapshot: "Home cleaning",
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

describe("CONTRACT 1 — hybrid billing precedence", () => {
  it("falls back to the agreement billing model when no override", () => {
    const agreement = makeAgreement({ billingModel: "monthly_fixed" });
    expect(effectiveBillingModel(agreement, makeLine())).toBe("monthly_fixed");
  });

  it("uses the line override when present", () => {
    const agreement = makeAgreement({ billingModel: "hybrid" });
    const line = makeLine({ billingModelOverride: "time_bank" });
    expect(effectiveBillingModel(agreement, line)).toBe("time_bank");
  });

  it("only allows overrides on hybrid agreements", () => {
    expect(isBillingModelOverrideAllowed(makeAgreement({ billingModel: "hybrid" }))).toBe(true);
    expect(isBillingModelOverrideAllowed(makeAgreement({ billingModel: "per_visit" }))).toBe(false);
  });

  it("rejects an override on a non-hybrid agreement", () => {
    const agreement = makeAgreement({ billingModel: "per_visit" });
    const line = makeLine({ billingModelOverride: "time_bank" });
    expect(validateLineBillingOverride(agreement, line)).toMatch(/only allowed when/);
  });

  it("accepts a null override on a non-hybrid agreement", () => {
    const agreement = makeAgreement({ billingModel: "per_visit" });
    expect(validateLineBillingOverride(agreement, makeLine({ billingModelOverride: null }))).toBeNull();
  });
});

describe("CONTRACT 3 — agreement status state machine", () => {
  it("permits the locked forward transitions", () => {
    expect(canTransitionStatus("draft", "active")).toBe(true);
    expect(canTransitionStatus("draft", "cancelled")).toBe(true);
    expect(canTransitionStatus("active", "paused")).toBe(true);
    expect(canTransitionStatus("active", "superseded")).toBe(true);
    expect(canTransitionStatus("active", "ended")).toBe(true);
    expect(canTransitionStatus("paused", "active")).toBe(true);
  });

  it("rejects illegal and terminal transitions", () => {
    expect(canTransitionStatus("draft", "paused")).toBe(false);
    expect(canTransitionStatus("draft", "superseded")).toBe(false);
    expect(canTransitionStatus("superseded", "active")).toBe(false);
    expect(canTransitionStatus("cancelled", "active")).toBe(false);
    expect(canTransitionStatus("ended", "active")).toBe(false);
  });

  it("marks the three terminal statuses", () => {
    expect(isTerminalStatus("superseded")).toBe(true);
    expect(isTerminalStatus("cancelled")).toBe(true);
    expect(isTerminalStatus("ended")).toBe(true);
    expect(isTerminalStatus("active")).toBe(false);
    (["superseded", "cancelled", "ended"] as AgreementStatus[]).forEach((s) =>
      expect(AGREEMENT_STATUS_TRANSITIONS[s]).toHaveLength(0),
    );
  });

  it("throws a descriptive error on an illegal transition", () => {
    expect(() => assertStatusTransition("ended", "active")).toThrow(/Illegal agreement status transition/);
    expect(() => assertStatusTransition("active", "ended")).not.toThrow();
  });

  it("only allows active/paused to be superseded", () => {
    expect(canBeSuperseded("active")).toBe(true);
    expect(canBeSuperseded("paused")).toBe(true);
    expect(canBeSuperseded("draft")).toBe(false);
    expect(canBeSuperseded("ended")).toBe(false);
  });
});

describe("pricing resolution", () => {
  it("resolves fixed and custom to the agreed price", () => {
    expect(resolveLineTotal(makeLine({ pricingModel: "fixed", agreedPrice: 1250.5 }))).toBe(1250.5);
    expect(resolveLineTotal(makeLine({ pricingModel: "custom", agreedPrice: 999.99, quantity: 5 }))).toBe(999.99);
  });

  it("resolves per_unit to price × quantity, rounded to money", () => {
    expect(resolveLineTotal(makeLine({ pricingModel: "per_unit", agreedPrice: 19.95, quantity: 3 }))).toBe(59.85);
  });

  it("returns null when inputs are missing", () => {
    expect(resolveLineTotal(makeLine({ agreedPrice: null }))).toBeNull();
    expect(resolveLineTotal(makeLine({ pricingModel: "per_unit", agreedPrice: 10, quantity: null }))).toBeNull();
  });
});

describe("validateAgreement", () => {
  it("passes a valid agreement with consistent lines", () => {
    const result = validateAgreement(makeAgreement(), [makeLine()]);
    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("flags a line that references the wrong agreement/group and an illegal override", () => {
    const agreement = makeAgreement({ billingModel: "per_visit" });
    const badLine = makeLine({
      agreementId: "agr_other",
      agreementGroupId: "grp_other",
      billingModelOverride: "time_bank",
    });
    const result = validateAgreement(agreement, [badLine]);
    expect(result.ok).toBe(false);
    const codes = result.issues.map((i) => i.code);
    expect(codes).toContain("line_agreement_mismatch");
    expect(codes).toContain("line_group_mismatch");
    expect(codes).toContain("line_billing_override_illegal");
  });

  it("flags an inverted validity window and a sub-1 version", () => {
    const agreement = makeAgreement({ version: 0, validFrom: "2026-02-01", validTo: "2026-01-01" });
    const result = validateAgreement(agreement, []);
    const codes = result.issues.map((i) => i.code);
    expect(codes).toContain("version_below_one");
    expect(codes).toContain("invalid_valid_window");
  });
});

describe("versioning — supersedeAgreement", () => {
  it("creates v2, marks v1 superseded and links both ways", () => {
    const v1 = makeAgreement({ status: "active" });
    const { previous, next } = supersedeAgreement(
      v1,
      { billingModel: "monthly_fixed", invoiceInterval: "quarterly" },
      { newAgreementId: "agr_v2", now: "2026-03-01T00:00:00.000Z" },
    );

    expect(previous.status).toBe("superseded");
    expect(previous.supersededById).toBe("agr_v2");

    expect(next.id).toBe("agr_v2");
    expect(next.version).toBe(2);
    expect(next.status).toBe("active");
    expect(next.agreementGroupId).toBe(v1.agreementGroupId);
    expect(next.supersedesVersionId).toBe("agr_v1");
    expect(next.supersededById).toBeNull();
    expect(next.billingModel).toBe("monthly_fixed");
    expect(next.invoiceInterval).toBe("quarterly");
  });

  it("does not mutate the input", () => {
    const v1 = makeAgreement({ status: "active" });
    supersedeAgreement(v1, {}, { newAgreementId: "agr_v2", now: NOW });
    expect(v1.status).toBe("active");
    expect(v1.supersededById).toBeNull();
  });

  it("refuses to supersede a terminal agreement", () => {
    const ended = makeAgreement({ status: "ended" });
    expect(() => supersedeAgreement(ended, {}, { newAgreementId: "x", now: NOW })).toThrow(
      /Only "active" or "paused"/,
    );
  });

  it("respects an explicit non-terminal newStatus", () => {
    const v1 = makeAgreement({ status: "paused" });
    const { next } = supersedeAgreement(v1, {}, { newAgreementId: "agr_v2", now: NOW, newStatus: "draft" });
    expect(next.status).toBe("draft");
  });
});

describe("versioning — line + chain helpers", () => {
  it("copies lines onto a new version with fresh ids", () => {
    const lines = [makeLine({ id: "line_1" }), makeLine({ id: "line_2", sortOrder: 1 })];
    const next = { id: "agr_v2", agreementGroupId: "grp_1" };
    const copied = copyLinesToVersion(lines, next, (src, i) => `${src}_v2_${i}`, NOW);
    expect(copied).toHaveLength(2);
    expect(copied[0].id).toBe("line_1_v2_0");
    expect(copied[0].agreementId).toBe("agr_v2");
    expect(copied[1].agreementId).toBe("agr_v2");
    // snapshots preserved
    expect(copied[0].serviceNameSnapshot).toBe("Home cleaning");
  });

  it("sorts a version chain oldest → newest", () => {
    const chain = [
      makeAgreement({ id: "v3", version: 3 }),
      makeAgreement({ id: "v1", version: 1 }),
      makeAgreement({ id: "v2", version: 2 }),
    ];
    expect(sortVersionChain(chain).map((a) => a.version)).toEqual([1, 2, 3]);
  });

  it("returns the single live (non-terminal) version, or null", () => {
    const chain = [
      makeAgreement({ id: "v1", version: 1, status: "superseded" }),
      makeAgreement({ id: "v2", version: 2, status: "active" }),
    ];
    expect(liveVersion(chain)?.id).toBe("v2");

    const allTerminal = [makeAgreement({ id: "v1", version: 1, status: "cancelled" })];
    expect(liveVersion(allTerminal)).toBeNull();
  });
});
