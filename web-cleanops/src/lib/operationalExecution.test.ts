import { describe, expect, it } from "vitest";

import {
  OPERATIONAL_EXECUTION_FEATURE_KEYS,
  SERVICE_FEATURE_REGISTRY,
  getServiceDefinition,
  validateFeatureAffects,
  validateFeatureLimits,
} from "@/lib/serviceRegistry";
import {
  isOperationalExecutionFeature,
  mapEntitlementStateToStatus,
  mapStatusToEntitlementState,
} from "@/lib/operationalExecution";
import type { ServiceFeatureKey } from "@/types";

const EXPECTED_KEYS: ServiceFeatureKey[] = [
  "mission_log",
  "time_reporting",
  "operational_flags",
  "notification_center",
  "incident_management",
  "action_center",
  "time_quality_analytics",
  "payroll_basis",
  "invoice_basis",
];

describe("Operational Execution feature keys", () => {
  it("registers all 9 keys in the bundle-first registry", () => {
    for (const key of EXPECTED_KEYS) {
      expect(getServiceDefinition(key)).toBeDefined();
    }
  });

  it("exposes the keys in module order", () => {
    expect(OPERATIONAL_EXECUTION_FEATURE_KEYS).toEqual(EXPECTED_KEYS);
  });

  it("keeps every registry service key unique after the additions", () => {
    const keys = SERVICE_FEATURE_REGISTRY.map((s) => s.serviceKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps the registry passing all Phase 0 validations", () => {
    expect(validateFeatureAffects()).toEqual([]);
    expect(validateFeatureLimits()).toEqual([]);
  });

  it("does not entitle new companies to any operational-execution module by default", () => {
    for (const key of EXPECTED_KEYS) {
      expect(getServiceDefinition(key)?.defaultCompanyEnabled).toBe(false);
    }
  });

  it("reserves payroll_basis and invoice_basis without trial semantics", () => {
    expect(getServiceDefinition("payroll_basis")?.supportsTrial).toBe(false);
    expect(getServiceDefinition("invoice_basis")?.supportsTrial).toBe(false);
  });
});

describe("entitlement-state mapping", () => {
  it("maps the architecture vocabulary onto ServiceEntitlementStatus", () => {
    expect(mapEntitlementStateToStatus("active")).toBe("enabled");
    expect(mapEntitlementStateToStatus("trial")).toBe("trial");
    expect(mapEntitlementStateToStatus("inactive")).toBe("disabled");
  });

  it("round-trips back to the architecture vocabulary", () => {
    expect(mapStatusToEntitlementState("enabled")).toBe("active");
    expect(mapStatusToEntitlementState("trial")).toBe("trial");
    expect(mapStatusToEntitlementState("disabled")).toBe("inactive");
  });
});

describe("isOperationalExecutionFeature", () => {
  it("recognises operational-execution keys", () => {
    expect(isOperationalExecutionFeature("mission_log")).toBe(true);
    expect(isOperationalExecutionFeature("time_reporting")).toBe(true);
  });

  it("rejects unrelated feature keys", () => {
    expect(isOperationalExecutionFeature("media_uploads")).toBe(false);
    expect(isOperationalExecutionFeature("time_bank")).toBe(false);
  });
});
