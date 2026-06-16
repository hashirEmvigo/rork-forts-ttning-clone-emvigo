import { describe, expect, it } from "vitest";

import {
  isServiceUsableForCompany,
  resolveCompanyEntitlement,
  resolveCompanyEntitlementStatus,
  resolveEffectiveCompanyStatus,
  resolveGlobalAvailability,
} from "@/lib/serviceRegistry";
import { defaultSystemSettings } from "@/types";
import type {
  CompanyServiceEntitlement,
  ServiceFeatureKey,
  ServiceGlobalEntitlement,
  SystemSettings,
} from "@/types";

import {
  createEntitlementAccessors,
  type AdapterEvent,
  type EntitlementResolverInputs,
} from "./adapter";

const NOW = new Date("2025-06-01T12:00:00.000Z");
const C1 = "c1";
const C2 = "c2";
const MEDIA: ServiceFeatureKey = "media_uploads";
const PTE: ServiceFeatureKey = "preferred_time_evaluation";

function entitlement(
  companyId: string,
  serviceKey: ServiceFeatureKey,
  status: "disabled" | "trial" | "enabled",
): CompanyServiceEntitlement {
  return {
    companyId,
    serviceKey,
    status,
    enabled: status !== "disabled",
    enabledAt: status !== "disabled" ? NOW.toISOString() : null,
    disabledAt: status === "disabled" ? NOW.toISOString() : null,
    trialStartedAt: status === "trial" ? NOW.toISOString() : null,
    trialEndedAt: null,
    updatedBy: null,
    updatedAt: NOW.toISOString(),
  };
}

function makeInputs(over: Partial<EntitlementResolverInputs> = {}): EntitlementResolverInputs {
  const systemSettings: SystemSettings = {
    ...defaultSystemSettings(),
    allowPreferredTimeEvaluation: true,
  };
  return {
    companyIds: [C1, C2],
    companyEntitlements: [
      entitlement(C1, MEDIA, "enabled"),
      entitlement(C2, MEDIA, "trial"),
    ],
    globalEntitlements: [
      { serviceKey: MEDIA, enabled: true, updatedBy: null, updatedAt: NOW.toISOString() },
    ] as ServiceGlobalEntitlement[],
    systemSettings,
    now: NOW,
    ...over,
  };
}

/** Re-derives every legacy accessor value directly from the registry helpers. */
function legacyExpectations(inputs: EntitlementResolverInputs) {
  const opts = {
    systemSettings: inputs.systemSettings,
    globalEntitlements: inputs.globalEntitlements,
    companyEntitlements: inputs.companyEntitlements,
  };
  return {
    global: (k: ServiceFeatureKey) => resolveGlobalAvailability(k, opts),
    entitled: (c: string, k: ServiceFeatureKey) =>
      resolveCompanyEntitlement(k, c, inputs.companyEntitlements),
    available: (c: string, k: ServiceFeatureKey) =>
      isServiceUsableForCompany(k, c, opts),
    status: (c: string, k: ServiceFeatureKey) =>
      resolveCompanyEntitlementStatus(k, c, inputs.companyEntitlements),
    effective: (c: string, k: ServiceFeatureKey) =>
      resolveEffectiveCompanyStatus(k, c, opts),
  };
}

describe("entitlement adapter", () => {
  it("legacy mode returns exactly the legacy registry values", () => {
    const inputs = makeInputs();
    const exp = legacyExpectations(inputs);
    const a = createEntitlementAccessors({ mode: "legacy", shadowLog: false, inputs });

    for (const k of [MEDIA, PTE]) {
      expect(a.isServiceGloballyAvailable(k)).toBe(exp.global(k));
      for (const c of [C1, C2]) {
        expect(a.isCompanyEntitledToService(c, k)).toBe(exp.entitled(c, k));
        expect(a.isServiceAvailableForCompany(c, k)).toBe(exp.available(c, k));
        expect(a.getCompanyServiceStatus(c, k)).toBe(exp.status(c, k));
        expect(a.getEffectiveCompanyServiceStatus(c, k)).toBe(exp.effective(c, k));
      }
    }
  });

  it("bundle mode reproduces the legacy values (parity)", () => {
    const inputs = makeInputs();
    const exp = legacyExpectations(inputs);
    const a = createEntitlementAccessors({ mode: "bundle", shadowLog: false, inputs });

    for (const k of [MEDIA, PTE]) {
      expect(a.isServiceGloballyAvailable(k)).toBe(exp.global(k));
      for (const c of [C1, C2]) {
        expect(a.isCompanyEntitledToService(c, k)).toBe(exp.entitled(c, k));
        expect(a.isServiceAvailableForCompany(c, k)).toBe(exp.available(c, k));
        expect(a.getCompanyServiceStatus(c, k)).toBe(exp.status(c, k));
        expect(a.getEffectiveCompanyServiceStatus(c, k)).toBe(exp.effective(c, k));
      }
    }
  });

  it("bundle mode preserves the global gate (PTE off forces disabled)", () => {
    const inputs = makeInputs({
      systemSettings: { ...defaultSystemSettings(), allowPreferredTimeEvaluation: false },
    });
    const a = createEntitlementAccessors({ mode: "bundle", shadowLog: false, inputs });
    expect(a.isServiceGloballyAvailable(PTE)).toBe(false);
    expect(a.getEffectiveCompanyServiceStatus(C1, PTE)).toBe("disabled");
    // Company-layer status (pre-gate) still reflects the registry default.
    expect(a.getCompanyServiceStatus(C1, PTE)).toBe("enabled");
  });

  it("shadow logging emits no divergence when paths agree, and serves legacy", () => {
    const inputs = makeInputs();
    const events: AdapterEvent[] = [];
    const a = createEntitlementAccessors({
      mode: "legacy",
      shadowLog: true,
      inputs,
      onEvent: (e) => events.push(e),
    });
    for (const k of [MEDIA, PTE]) {
      a.isServiceGloballyAvailable(k);
      for (const c of [C1, C2]) {
        a.isCompanyEntitledToService(c, k);
        a.getEffectiveCompanyServiceStatus(c, k);
      }
    }
    expect(events).toHaveLength(0);
  });

  it("fail-safe: an unknown service key in bundle mode falls back to legacy and logs", () => {
    const inputs = makeInputs();
    const events: AdapterEvent[] = [];
    const bogus = "not_a_real_service" as ServiceFeatureKey;
    const a = createEntitlementAccessors({
      mode: "bundle",
      shadowLog: false,
      inputs,
      onEvent: (e) => events.push(e),
    });
    // Legacy returns the safe default (false) for an unknown service.
    expect(a.isServiceGloballyAvailable(bogus)).toBe(false);
    expect(events.some((e) => e.kind === "fallback")).toBe(true);
  });

  it("dedupes repeated fallback events for the same accessor/service", () => {
    const inputs = makeInputs();
    const events: AdapterEvent[] = [];
    const bogus = "not_a_real_service" as ServiceFeatureKey;
    const a = createEntitlementAccessors({
      mode: "bundle",
      shadowLog: false,
      inputs,
      onEvent: (e) => events.push(e),
    });
    a.isServiceGloballyAvailable(bogus);
    a.isServiceGloballyAvailable(bogus);
    a.isServiceGloballyAvailable(bogus);
    expect(events.filter((e) => e.kind === "fallback")).toHaveLength(1);
  });
});
