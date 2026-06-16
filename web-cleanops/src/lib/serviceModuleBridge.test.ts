/**
 * Locks in the Service → Module availability bridge (WAVE-003H-R): the single
 * narrow seam that lets a Super Admin service entitlement decide a Company Admin
 * module's availability, WITHOUT merging the two models or creating a third
 * access system. The contract these tests enforce:
 *
 *   • Only the explicit allow-list is bridged — Admin Requests
 *     (`admin_requests` → `admin-requests`) and nothing else.
 *   • An effective `enabled`/`trial` entitlement OFFERS the module; `disabled`,
 *     missing, or globally-off does NOT.
 *   • The bridge feeds ONLY Layer 2 (availability); Layer 3 (the Company Admin
 *     local toggle) and Layer 1 (global module status) stay separate.
 *   • `employee-customer-requests` is a separate, deferred product and is NOT
 *     affected by `admin_requests`.
 *   • Un-bridged modules return `undefined` so the module access resolver keeps
 *     its exact existing behavior.
 */
import {
  resolveCompanyModuleState,
  isCompanyModuleOffered,
  isCompanyModuleUsable,
} from "./moduleAccess";
import {
  SERVICE_MODULE_BRIDGE,
  getServiceForBridgedModule,
  getBridgedModuleForService,
  isBridgedModule,
  resolveModuleEntitlementAvailability,
  validateServiceModuleBridge,
  type ModuleEntitlementAvailabilityOpts,
} from "./serviceModuleBridge";
import { ADMIN_REQUESTS_KEY } from "./serviceRegistry";
import { defaultSystemSettings } from "@/types";
import type {
  CompanyModuleSetting,
  CompanyServiceEntitlement,
  Module,
  ServiceEntitlementStatus,
  ServiceGlobalEntitlement,
} from "@/types";

const COMPANY = "cmp_1";

function opts(
  overrides: Partial<ModuleEntitlementAvailabilityOpts> = {},
): ModuleEntitlementAvailabilityOpts {
  return {
    systemSettings: defaultSystemSettings(),
    globalEntitlements: [],
    companyEntitlements: [],
    ...overrides,
  };
}

function adminRequestsEntitlement(
  status: ServiceEntitlementStatus,
  companyId: string = COMPANY,
): CompanyServiceEntitlement {
  return {
    companyId,
    serviceKey: ADMIN_REQUESTS_KEY,
    status,
    enabled: status !== "disabled",
    enabledAt: status !== "disabled" ? "2026-01-01T00:00:00.000Z" : null,
    disabledAt: status === "disabled" ? "2026-01-01T00:00:00.000Z" : null,
    updatedBy: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function globalOff(): ServiceGlobalEntitlement {
  return {
    serviceKey: ADMIN_REQUESTS_KEY,
    enabled: false,
    updatedBy: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeModule(): Module {
  return {
    id: "admin-requests",
    name: "Admin Requests",
    description: "Internal requests routed to company administrators.",
    status: "active",
    allowedUserTypes: ["company_admin"],
    createdAt: "2024-01-01T00:00:00.000Z",
  };
}

function makeSetting(
  available: boolean,
  enabled: boolean,
  moduleId: string = "admin-requests",
): CompanyModuleSetting {
  return { companyId: COMPANY, moduleId, available, enabled };
}

describe("SERVICE_MODULE_BRIDGE allow-list", () => {
  it("bridges exactly admin_requests → admin-requests and nothing else", () => {
    expect(SERVICE_MODULE_BRIDGE).toEqual([
      { serviceKey: "admin_requests", moduleId: "admin-requests" },
    ]);
  });

  it("does NOT bridge the deferred employee_customer_requests product", () => {
    const serviceKeys = SERVICE_MODULE_BRIDGE.map((b) => b.serviceKey as string);
    const moduleIds = SERVICE_MODULE_BRIDGE.map((b) => b.moduleId);
    expect(serviceKeys).not.toContain("employee_customer_requests");
    expect(moduleIds).not.toContain("employee-customer-requests");
  });

  it("resolves the bridge in both directions", () => {
    expect(getServiceForBridgedModule("admin-requests")).toBe("admin_requests");
    expect(getBridgedModuleForService(ADMIN_REQUESTS_KEY)).toBe("admin-requests");
    expect(isBridgedModule("admin-requests")).toBe(true);
  });

  it("returns undefined/false for un-bridged modules", () => {
    expect(getServiceForBridgedModule("employee-customer-requests")).toBeUndefined();
    expect(getServiceForBridgedModule("checklist-manager")).toBeUndefined();
    expect(isBridgedModule("employee-customer-requests")).toBe(false);
    expect(isBridgedModule("news")).toBe(false);
  });

  it("stays consistent with the registry affects + module catalogue", () => {
    // Guards against drift: the bridged module must exist and be declared in the
    // service's registry `affects` metadata.
    expect(validateServiceModuleBridge()).toEqual([]);
  });
});

describe("resolveModuleEntitlementAvailability", () => {
  it("returns undefined for modules with no bridge (existing behavior preserved)", () => {
    expect(
      resolveModuleEntitlementAvailability("employee-customer-requests", COMPANY, opts()),
    ).toBeUndefined();
    expect(
      resolveModuleEntitlementAvailability("checklist-manager", COMPANY, opts()),
    ).toBeUndefined();
  });

  it("is not offered by default (admin_requests defaults to disabled per company)", () => {
    expect(resolveModuleEntitlementAvailability("admin-requests", COMPANY, opts())).toBe(
      false,
    );
  });

  it("is offered when the company entitlement is enabled", () => {
    expect(
      resolveModuleEntitlementAvailability(
        "admin-requests",
        COMPANY,
        opts({ companyEntitlements: [adminRequestsEntitlement("enabled")] }),
      ),
    ).toBe(true);
  });

  it("is offered when the company entitlement is on trial", () => {
    expect(
      resolveModuleEntitlementAvailability(
        "admin-requests",
        COMPANY,
        opts({ companyEntitlements: [adminRequestsEntitlement("trial")] }),
      ),
    ).toBe(true);
  });

  it("is not offered when the company entitlement is disabled", () => {
    expect(
      resolveModuleEntitlementAvailability(
        "admin-requests",
        COMPANY,
        opts({ companyEntitlements: [adminRequestsEntitlement("disabled")] }),
      ),
    ).toBe(false);
  });

  it("is not offered when the service is globally turned off, even if the company is enabled", () => {
    expect(
      resolveModuleEntitlementAvailability(
        "admin-requests",
        COMPANY,
        opts({
          globalEntitlements: [globalOff()],
          companyEntitlements: [adminRequestsEntitlement("enabled")],
        }),
      ),
    ).toBe(false);
  });

  it("scopes availability to the entitled company only", () => {
    const shared = opts({
      companyEntitlements: [adminRequestsEntitlement("enabled", "cmp_entitled")],
    });
    expect(
      resolveModuleEntitlementAvailability("admin-requests", "cmp_entitled", shared),
    ).toBe(true);
    expect(
      resolveModuleEntitlementAvailability("admin-requests", "cmp_other", shared),
    ).toBe(false);
  });
});

describe("bridge → module access resolver integration", () => {
  it("offers admin-requests (available_off) when entitled but locally off", () => {
    const available = resolveModuleEntitlementAvailability(
      "admin-requests",
      COMPANY,
      opts({ companyEntitlements: [adminRequestsEntitlement("enabled")] }),
    );
    const state = resolveCompanyModuleState({
      module: makeModule(),
      setting: makeSetting(false, false),
      entitlementAvailability: available,
    });
    expect(state).toBe("available_off");
    expect(isCompanyModuleOffered(state)).toBe(true);
    expect(isCompanyModuleUsable(state)).toBe(false);
  });

  it("makes admin-requests usable when entitled AND locally enabled", () => {
    const available = resolveModuleEntitlementAvailability(
      "admin-requests",
      COMPANY,
      opts({ companyEntitlements: [adminRequestsEntitlement("trial")] }),
    );
    const state = resolveCompanyModuleState({
      module: makeModule(),
      setting: makeSetting(false, true),
      entitlementAvailability: available,
    });
    expect(state).toBe("enabled");
    expect(isCompanyModuleUsable(state)).toBe(true);
  });

  it("locks admin-requests when not entitled, overriding any stale company row", () => {
    const available = resolveModuleEntitlementAvailability(
      "admin-requests",
      COMPANY,
      opts(),
    );
    const state = resolveCompanyModuleState({
      module: makeModule(),
      setting: makeSetting(true, true),
      entitlementAvailability: available,
    });
    expect(state).toBe("not_offered");
    expect(isCompanyModuleOffered(state)).toBe(false);
  });

  it("does not change employee-customer-requests: undefined bridge falls back to the raw row", () => {
    const available = resolveModuleEntitlementAvailability(
      "employee-customer-requests",
      COMPANY,
      // Even with an admin_requests entitlement present, the sibling module is
      // un-bridged and must follow its own company_modules row unchanged.
      opts({ companyEntitlements: [adminRequestsEntitlement("enabled")] }),
    );
    expect(available).toBeUndefined();
    const offered = resolveCompanyModuleState({
      module: { ...makeModule(), id: "employee-customer-requests" },
      setting: makeSetting(true, true, "employee-customer-requests"),
      entitlementAvailability: available,
    });
    const notOffered = resolveCompanyModuleState({
      module: { ...makeModule(), id: "employee-customer-requests" },
      setting: makeSetting(false, false, "employee-customer-requests"),
      entitlementAvailability: available,
    });
    expect(offered).toBe("enabled");
    expect(notOffered).toBe("not_offered");
  });
});
