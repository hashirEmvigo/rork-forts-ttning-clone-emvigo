import { describe, expect, it } from "vitest";

import {
  MEDIA_UPLOADS_KEY,
  PREFERRED_TIME_EVALUATION_KEY,
  SERVICE_FEATURE_REGISTRY,
  describeFeatureSurface,
  evaluateUsageGate,
  findDuplicateLimitKeys,
  findDuplicateSurfaces,
  findFeaturesWithoutAffectedAreas,
  findInvalidEnumPriorities,
  findInvalidModuleReferences,
  getServiceDefinition,
  isServiceUsableForCompany,
  ADMIN_REQUESTS_KEY,
  resolveCompanyEntitlement,
  resolveCompanyEntitlementStatus,
  resolveEffectiveCompanyStatus,
  resolveGlobalAvailability,
  statusFromRecord,
  validateFeatureAffects,
  validateFeatureLimits,
} from "@/lib/serviceRegistry";
import type { ServiceFeatureDefinition } from "@/lib/serviceRegistry";
import { defaultSystemSettings } from "@/types";
import type {
  CompanyServiceEntitlement,
  ServiceGlobalEntitlement,
  SystemSettings,
} from "@/types";

const PTE = PREFERRED_TIME_EVALUATION_KEY;

function systemSettings(allow: boolean): SystemSettings {
  return { ...defaultSystemSettings(), allowPreferredTimeEvaluation: allow };
}

function companyEntitlement(
  overrides: Partial<CompanyServiceEntitlement> = {},
): CompanyServiceEntitlement {
  return {
    companyId: "cmp_1",
    serviceKey: PTE,
    enabled: true,
    enabledAt: "2026-01-01T00:00:00.000Z",
    disabledAt: null,
    updatedBy: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("service registry", () => {
  it("contains the Preferred Time Evaluation feature with billing metadata", () => {
    const def = getServiceDefinition(PTE);
    expect(def).toBeDefined();
    expect(def?.billingEligible).toBe(true);
    expect(def?.billingLabel).toBe("Preferred Time Evaluation");
    expect(def?.category).toBe("Work Orders");
  });

  it("every registry entry has a unique service key", () => {
    const keys = SERVICE_FEATURE_REGISTRY.map((s) => s.serviceKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("feature affected-area metadata (Phase 0)", () => {
  it("maps Preferred Time Evaluation to scheduling/work-order areas only (no module)", () => {
    const def = getServiceDefinition(PTE);
    const affects = def?.affects ?? [];
    expect(affects.length).toBeGreaterThan(0);
    // No module references at all — PTE is a cross-cutting capability.
    expect(affects.some((s) => s.kind === "module")).toBe(false);
    const areas = affects.map((s) => describeFeatureSurface(s));
    expect(areas).toContain("Work Orders");
    expect(areas).toContain("Scheduling");
    // Must not reference My Cleaning Protocols.
    expect(areas.some((a) => /protocol/i.test(a))).toBe(false);
  });

  it("maps Media Uploads to its media/upload surfaces", () => {
    const def = getServiceDefinition(MEDIA_UPLOADS_KEY);
    const areas = (def?.affects ?? []).map((s) => describeFeatureSurface(s));
    expect(areas).toContain("Customer Media");
    expect(areas).toContain("Work Order Images");
  });

  it("the live registry passes all affected-area validations", () => {
    expect(validateFeatureAffects()).toEqual([]);
  });
});

describe("feature limit declarations (Phase 0)", () => {
  it("declares the Media Upload Count limit mirroring the trial allowance", () => {
    const def = getServiceDefinition(MEDIA_UPLOADS_KEY);
    const limit = def?.limits?.find((l) => l.limitKey === "media_upload_count");
    expect(limit).toBeDefined();
    expect(limit?.valueType).toBe("count");
    expect(limit?.mergeKind).toBe("numeric-max");
    expect(limit?.defaultValue).toBe(def?.trialLimit);
  });

  it("Preferred Time Evaluation declares no configurable limits", () => {
    const def = getServiceDefinition(PTE);
    expect(def?.limits ?? []).toHaveLength(0);
  });

  it("the live registry passes all limit-declaration validations", () => {
    expect(validateFeatureLimits()).toEqual([]);
  });
});

describe("limit-declaration validation helpers", () => {
  const base: ServiceFeatureDefinition = {
    serviceKey: "media_uploads",
    name: "Test Feature",
    description: "",
    category: "Test",
    icon: "Box",
    billingEligible: false,
    billingLabel: "",
    defaultGlobalEnabled: true,
    defaultCompanyEnabled: false,
    supportsTrial: false,
  };

  it("detects a limit key declared by more than one feature", () => {
    const reg: ServiceFeatureDefinition[] = [
      {
        ...base,
        serviceKey: "media_uploads",
        limits: [
          {
            limitKey: "media_upload_count",
            name: "A",
            valueType: "count",
            mergeKind: "numeric-max",
            defaultValue: 1,
            billingEligible: false,
          },
        ],
      },
      {
        ...base,
        serviceKey: "preferred_time_evaluation",
        limits: [
          {
            limitKey: "media_upload_count",
            name: "B",
            valueType: "count",
            mergeKind: "numeric-max",
            defaultValue: 2,
            billingEligible: false,
          },
        ],
      },
    ];
    const issues = findDuplicateLimitKeys(reg);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("duplicate-limit-key");
  });

  it("flags enum-priority merge kind without a declared priority order", () => {
    const reg: ServiceFeatureDefinition[] = [
      {
        ...base,
        limits: [
          {
            limitKey: "media_upload_count",
            name: "Mode",
            valueType: "enum",
            mergeKind: "enum-priority",
            defaultValue: "manual",
            billingEligible: false,
          },
        ],
      },
    ];
    const issues = findInvalidEnumPriorities(reg);
    expect(issues.some((i) => i.kind === "enum-priority-missing")).toBe(true);
  });

  it("flags a priority order on a non-enum merge kind", () => {
    const reg: ServiceFeatureDefinition[] = [
      {
        ...base,
        limits: [
          {
            limitKey: "media_upload_count",
            name: "Count",
            valueType: "count",
            mergeKind: "numeric-max",
            defaultValue: 1,
            enumPriority: ["a", "b"],
            billingEligible: false,
          },
        ],
      },
    ];
    const issues = findInvalidEnumPriorities(reg);
    expect(issues.some((i) => i.kind === "enum-priority-unexpected")).toBe(true);
  });

  it("flags an enum default value missing from its priority order", () => {
    const reg: ServiceFeatureDefinition[] = [
      {
        ...base,
        limits: [
          {
            limitKey: "media_upload_count",
            name: "Mode",
            valueType: "enum",
            mergeKind: "enum-priority",
            defaultValue: "automatic",
            enumPriority: ["manual", "semi"],
            billingEligible: false,
          },
        ],
      },
    ];
    const issues = findInvalidEnumPriorities(reg);
    expect(issues.some((i) => i.kind === "enum-default-not-in-priority")).toBe(true);
  });

  it("accepts a valid enum-priority declaration", () => {
    const reg: ServiceFeatureDefinition[] = [
      {
        ...base,
        limits: [
          {
            limitKey: "media_upload_count",
            name: "Mode",
            valueType: "enum",
            mergeKind: "enum-priority",
            defaultValue: "manual",
            enumPriority: ["manual", "automatic"],
            billingEligible: false,
          },
        ],
      },
    ];
    expect(findInvalidEnumPriorities(reg)).toEqual([]);
  });
});

describe("affected-area validation helpers", () => {
  const base: ServiceFeatureDefinition = {
    serviceKey: "media_uploads",
    name: "Test Feature",
    description: "",
    category: "Test",
    icon: "Box",
    billingEligible: false,
    billingLabel: "",
    defaultGlobalEnabled: true,
    defaultCompanyEnabled: false,
    supportsTrial: false,
  };

  it("detects invalid module references", () => {
    const reg: ServiceFeatureDefinition[] = [
      { ...base, affects: [{ kind: "module", moduleId: "does-not-exist" }] },
    ];
    const issues = findInvalidModuleReferences(reg);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("invalid-module-reference");
  });

  it("accepts a valid module reference", () => {
    const reg: ServiceFeatureDefinition[] = [
      { ...base, affects: [{ kind: "module", moduleId: "checklist-manager" }] },
    ];
    expect(findInvalidModuleReferences(reg)).toEqual([]);
  });

  it("detects duplicate areas case-insensitively", () => {
    const reg: ServiceFeatureDefinition[] = [
      {
        ...base,
        affects: [
          { kind: "area", area: "Work Orders" },
          { kind: "area", area: "work orders " },
        ],
      },
    ];
    const issues = findDuplicateSurfaces(reg);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("duplicate-surface");
  });

  it("detects features with no affected areas", () => {
    const reg: ServiceFeatureDefinition[] = [{ ...base }];
    const issues = findFeaturesWithoutAffectedAreas(reg);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("no-affected-areas");
  });
});

describe("resolveGlobalAvailability", () => {
  it("bridges Preferred Time Evaluation to the legacy master gate (on)", () => {
    expect(
      resolveGlobalAvailability(PTE, {
        systemSettings: systemSettings(true),
        globalEntitlements: [],
      }),
    ).toBe(true);
  });

  it("bridges Preferred Time Evaluation to the legacy master gate (off)", () => {
    expect(
      resolveGlobalAvailability(PTE, {
        systemSettings: systemSettings(false),
        globalEntitlements: [],
      }),
    ).toBe(false);
  });
});

describe("resolveCompanyEntitlement", () => {
  it("uses the explicit company record when present", () => {
    const entitlements = [companyEntitlement({ enabled: false })];
    expect(resolveCompanyEntitlement(PTE, "cmp_1", entitlements)).toBe(false);
  });

  it("falls back to the registry default (entitled) when no record exists", () => {
    expect(resolveCompanyEntitlement(PTE, "cmp_1", [])).toBe(true);
  });

  it("scopes records by company id", () => {
    const entitlements = [companyEntitlement({ companyId: "cmp_other", enabled: false })];
    // cmp_1 has no record → default true; cmp_other explicitly false.
    expect(resolveCompanyEntitlement(PTE, "cmp_1", entitlements)).toBe(true);
    expect(resolveCompanyEntitlement(PTE, "cmp_other", entitlements)).toBe(false);
  });
});

describe("Admin Requests service (registry identity)", () => {
  it("registers exactly one admin_requests entry with billing metadata", () => {
    const matches = SERVICE_FEATURE_REGISTRY.filter(
      (s) => s.serviceKey === ADMIN_REQUESTS_KEY,
    );
    expect(matches).toHaveLength(1);
    const def = matches[0];
    expect(def.serviceKey).toBe("admin_requests");
    expect(def.name).toBe("Admin Requests");
    expect(def.billingEligible).toBe(true);
    expect(def.billingLabel).toBe("Admin Requests");
  });

  it("models the service on the notification_center add-on defaults", () => {
    const def = getServiceDefinition(ADMIN_REQUESTS_KEY);
    // Platform offers it; a company must be granted access explicitly.
    expect(def?.defaultGlobalEnabled).toBe(true);
    expect(def?.defaultCompanyEnabled).toBe(false);
    expect(def?.supportsTrial).toBe(true);
  });

  it("points `affects` ONLY at the admin-requests module (diagnostic-only)", () => {
    const def = getServiceDefinition(ADMIN_REQUESTS_KEY);
    const moduleIds = (def?.affects ?? []).flatMap((s) =>
      s.kind === "module" ? [s.moduleId] : [],
    );
    expect(moduleIds).toEqual(["admin-requests"]);
    // Every referenced module id resolves to a real module definition.
    expect(findInvalidModuleReferences([def as ServiceFeatureDefinition])).toEqual([]);
  });

  it("does NOT affect employee-customer-requests (separate, deferred product)", () => {
    const def = getServiceDefinition(ADMIN_REQUESTS_KEY);
    const moduleIds = (def?.affects ?? []).flatMap((s) =>
      s.kind === "module" ? [s.moduleId] : [],
    );
    expect(moduleIds).not.toContain("employee-customer-requests");
  });

  it("removes the superseded request_crm suite key from the registry entirely", () => {
    const keys: string[] = SERVICE_FEATURE_REGISTRY.map((s) => s.serviceKey);
    expect(keys).not.toContain("request_crm");
    expect(keys).toContain("admin_requests");
  });

  it("keeps the live registry passing all Phase 0 validations after the correction", () => {
    expect(validateFeatureAffects()).toEqual([]);
    expect(validateFeatureLimits()).toEqual([]);
  });
});

describe("Media Uploads premium service", () => {
  it("is registered with a counted trial and billing metadata", () => {
    const def = getServiceDefinition(MEDIA_UPLOADS_KEY);
    expect(def).toBeDefined();
    expect(def?.billingEligible).toBe(true);
    expect(def?.supportsTrial).toBe(true);
    expect(def?.trialLimitType).toBe("count");
    expect(def?.trialLimit).toBe(30);
    // Premium: new companies are not entitled by default.
    expect(def?.defaultCompanyEnabled).toBe(false);
  });
});

describe("statusFromRecord (legacy migration)", () => {
  it("uses the explicit status when present", () => {
    expect(
      statusFromRecord(companyEntitlement({ status: "trial" })),
    ).toBe("trial");
  });

  it("derives status from the legacy enabled flag when absent", () => {
    expect(statusFromRecord(companyEntitlement({ enabled: true }))).toBe("enabled");
    expect(statusFromRecord(companyEntitlement({ enabled: false }))).toBe("disabled");
  });
});

describe("resolveCompanyEntitlementStatus", () => {
  it("defaults Media Uploads to disabled for companies without a record", () => {
    expect(resolveCompanyEntitlementStatus(MEDIA_UPLOADS_KEY, "cmp_1", [])).toBe(
      "disabled",
    );
  });

  it("reads an explicit trial record", () => {
    const records = [
      companyEntitlement({ serviceKey: MEDIA_UPLOADS_KEY, status: "trial" }),
    ];
    expect(resolveCompanyEntitlementStatus(MEDIA_UPLOADS_KEY, "cmp_1", records)).toBe(
      "trial",
    );
  });

  it("treats trial and enabled as entitled, disabled as not", () => {
    const trial = [companyEntitlement({ status: "trial" })];
    const disabled = [companyEntitlement({ status: "disabled", enabled: false })];
    expect(resolveCompanyEntitlement(PTE, "cmp_1", trial)).toBe(true);
    expect(resolveCompanyEntitlement(PTE, "cmp_1", disabled)).toBe(false);
  });
});

describe("resolveEffectiveCompanyStatus", () => {
  it("collapses to disabled when the service is globally off", () => {
    expect(
      resolveEffectiveCompanyStatus(PTE, "cmp_1", {
        systemSettings: systemSettings(false),
        globalEntitlements: [],
        companyEntitlements: [companyEntitlement({ status: "enabled" })],
      }),
    ).toBe("disabled");
  });

  it("preserves the company status when globally available", () => {
    expect(
      resolveEffectiveCompanyStatus(PTE, "cmp_1", {
        systemSettings: systemSettings(true),
        globalEntitlements: [],
        companyEntitlements: [companyEntitlement({ status: "trial" })],
      }),
    ).toBe("trial");
  });
});

describe("evaluateUsageGate", () => {
  it("blocks when disabled", () => {
    const res = evaluateUsageGate(MEDIA_UPLOADS_KEY, "disabled", 0);
    expect(res.allowed).toBe(false);
    expect(res.reason).toBeDefined();
  });

  it("allows during trial below the limit and reports remaining", () => {
    const res = evaluateUsageGate(MEDIA_UPLOADS_KEY, "trial", 23);
    expect(res.allowed).toBe(true);
    expect(res.limit).toBe(30);
    expect(res.used).toBe(23);
    expect(res.remaining).toBe(7);
  });

  it("blocks once the trial limit is reached", () => {
    const res = evaluateUsageGate(MEDIA_UPLOADS_KEY, "trial", 30);
    expect(res.allowed).toBe(false);
    expect(res.remaining).toBe(0);
    expect(res.reason).toContain("Trial limit reached");
  });

  it("allows without limit when enabled", () => {
    const res = evaluateUsageGate(MEDIA_UPLOADS_KEY, "enabled", 9999);
    expect(res.allowed).toBe(true);
    expect(res.limit).toBeNull();
  });
});

describe("isServiceUsableForCompany", () => {
  const base = (allow: boolean, entitlements: CompanyServiceEntitlement[]) => ({
    systemSettings: systemSettings(allow),
    globalEntitlements: [] as ServiceGlobalEntitlement[],
    companyEntitlements: entitlements,
  });

  it("is usable when globally available and the company is entitled", () => {
    expect(isServiceUsableForCompany(PTE, "cmp_1", base(true, [companyEntitlement()]))).toBe(
      true,
    );
  });

  it("is not usable when globally off, even if the company is entitled", () => {
    expect(
      isServiceUsableForCompany(PTE, "cmp_1", base(false, [companyEntitlement()])),
    ).toBe(false);
  });

  it("is not usable when the company entitlement is revoked", () => {
    expect(
      isServiceUsableForCompany(PTE, "cmp_1", base(true, [companyEntitlement({ enabled: false })])),
    ).toBe(false);
  });
});
