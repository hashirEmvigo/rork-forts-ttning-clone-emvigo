/**
 * Locks in the Phase-2B Module access model: the SINGLE source of truth that
 * combines GLOBAL module status (Super Admin, platform-wide) + COMPANY
 * availability (Super Admin offers it) + COMPANY enablement (Company Admin
 * switches it on). The contract these tests enforce:
 *
 *   • A globally-inactive module is NEVER offered/usable, even when a stale
 *     company_modules row still says available + enabled (global status wins).
 *   • A globally-active module the Super Admin never offered is "Not available".
 *   • A globally-active, offered module can be enabled/disabled by the company.
 *   • Only global-active + available + enabled is usable (the access gate).
 */
import type { CompanyModuleSetting, EntityStatus, Module } from "@/types";
import {
  resolveCompanyModuleState,
  isCompanyModuleOffered,
  isCompanyModuleUsable,
  isCompanyModuleAccessible,
} from "./moduleAccess";

function makeModule(status: EntityStatus): Module {
  return {
    id: "news",
    name: "News",
    description: "Company announcements.",
    status,
    allowedUserTypes: ["company_admin", "employee", "customer"],
    createdAt: "2024-01-01T00:00:00.000Z",
  };
}

function makeSetting(available: boolean, enabled: boolean): CompanyModuleSetting {
  return { companyId: "cmp_a", moduleId: "news", available, enabled };
}

describe("resolveCompanyModuleState", () => {
  it("is globally_inactive when the module row is missing", () => {
    expect(
      resolveCompanyModuleState({ module: undefined, setting: makeSetting(true, true) }),
    ).toBe("globally_inactive");
  });

  it("is globally_inactive when the module status is inactive", () => {
    expect(
      resolveCompanyModuleState({ module: makeModule("inactive"), setting: makeSetting(true, true) }),
    ).toBe("globally_inactive");
  });

  it("is globally_inactive when the module status is archived", () => {
    expect(
      resolveCompanyModuleState({ module: makeModule("archived"), setting: makeSetting(true, true) }),
    ).toBe("globally_inactive");
  });

  it("GLOBAL status wins over a stale available+enabled company row", () => {
    // The exact reported bug: deactivating News globally must drop access even
    // though the backfilled company_modules row is still available + enabled.
    const state = resolveCompanyModuleState({
      module: makeModule("inactive"),
      setting: makeSetting(true, true),
    });
    expect(state).toBe("globally_inactive");
    expect(isCompanyModuleOffered(state)).toBe(false);
    expect(isCompanyModuleUsable(state)).toBe(false);
  });

  it("is not_offered when globally active but no company row exists", () => {
    expect(
      resolveCompanyModuleState({ module: makeModule("active"), setting: undefined }),
    ).toBe("not_offered");
  });

  it("is not_offered when globally active but availability is false", () => {
    expect(
      resolveCompanyModuleState({ module: makeModule("active"), setting: makeSetting(false, false) }),
    ).toBe("not_offered");
  });

  it("is available_off when offered but the company disabled it", () => {
    expect(
      resolveCompanyModuleState({ module: makeModule("active"), setting: makeSetting(true, false) }),
    ).toBe("available_off");
  });

  it("is enabled when globally active + offered + switched on", () => {
    expect(
      resolveCompanyModuleState({ module: makeModule("active"), setting: makeSetting(true, true) }),
    ).toBe("enabled");
  });
});

describe("isCompanyModuleOffered", () => {
  it("is true only when the module is toggleable (available_off or enabled)", () => {
    expect(isCompanyModuleOffered("globally_inactive")).toBe(false);
    expect(isCompanyModuleOffered("not_offered")).toBe(false);
    expect(isCompanyModuleOffered("available_off")).toBe(true);
    expect(isCompanyModuleOffered("enabled")).toBe(true);
  });
});

describe("isCompanyModuleUsable", () => {
  it("is true only for the fully-enabled state", () => {
    expect(isCompanyModuleUsable("globally_inactive")).toBe(false);
    expect(isCompanyModuleUsable("not_offered")).toBe(false);
    expect(isCompanyModuleUsable("available_off")).toBe(false);
    expect(isCompanyModuleUsable("enabled")).toBe(true);
  });
});

describe("resolveCompanyModuleState — Service → Module bridge (entitlementAvailability)", () => {
  it("falls back to company_modules.available when entitlementAvailability is undefined", () => {
    // Un-bridged modules pass `undefined`, so existing behavior is preserved.
    expect(
      resolveCompanyModuleState({
        module: makeModule("active"),
        setting: makeSetting(true, false),
        entitlementAvailability: undefined,
      }),
    ).toBe("available_off");
    expect(
      resolveCompanyModuleState({
        module: makeModule("active"),
        setting: makeSetting(false, false),
        entitlementAvailability: undefined,
      }),
    ).toBe("not_offered");
  });

  it("offers a bridged module from the entitlement even with no company_modules row", () => {
    // Entitled (enabled/trial) but the company has not toggled it on locally yet.
    expect(
      resolveCompanyModuleState({
        module: makeModule("active"),
        setting: undefined,
        entitlementAvailability: true,
      }),
    ).toBe("available_off");
  });

  it("offers a bridged module from the entitlement even when the raw available flag is false", () => {
    // Availability now comes from the service entitlement, NOT company_modules.
    expect(
      resolveCompanyModuleState({
        module: makeModule("active"),
        setting: makeSetting(false, false),
        entitlementAvailability: true,
      }),
    ).toBe("available_off");
  });

  it("enables a bridged module when entitled AND the local toggle is on", () => {
    expect(
      resolveCompanyModuleState({
        module: makeModule("active"),
        setting: makeSetting(false, true),
        entitlementAvailability: true,
      }),
    ).toBe("enabled");
  });

  it("withdraws a bridged module when not entitled, overriding a stale available+enabled row", () => {
    expect(
      resolveCompanyModuleState({
        module: makeModule("active"),
        setting: makeSetting(true, true),
        entitlementAvailability: false,
      }),
    ).toBe("not_offered");
  });

  it("keeps GLOBAL status authoritative over the entitlement bridge", () => {
    expect(
      resolveCompanyModuleState({
        module: makeModule("inactive"),
        setting: makeSetting(true, true),
        entitlementAvailability: true,
      }),
    ).toBe("globally_inactive");
  });

  it("keeps the local enabled toggle separate from entitlement availability", () => {
    const enabled = resolveCompanyModuleState({
      module: makeModule("active"),
      setting: makeSetting(false, true),
      entitlementAvailability: true,
    });
    const off = resolveCompanyModuleState({
      module: makeModule("active"),
      setting: makeSetting(false, false),
      entitlementAvailability: true,
    });
    expect(isCompanyModuleUsable(enabled)).toBe(true);
    expect(isCompanyModuleOffered(off)).toBe(true);
    expect(isCompanyModuleUsable(off)).toBe(false);
  });
});

describe("isCompanyModuleAccessible (access gate predicate)", () => {
  it("grants access only with global-active + available + enabled", () => {
    expect(
      isCompanyModuleAccessible({ module: makeModule("active"), setting: makeSetting(true, true) }),
    ).toBe(true);
  });

  it("denies access when globally inactive even if available + enabled", () => {
    expect(
      isCompanyModuleAccessible({ module: makeModule("inactive"), setting: makeSetting(true, true) }),
    ).toBe(false);
  });

  it("denies access when offered but disabled by the company", () => {
    expect(
      isCompanyModuleAccessible({ module: makeModule("active"), setting: makeSetting(true, false) }),
    ).toBe(false);
  });

  it("denies access when globally active but never offered", () => {
    expect(
      isCompanyModuleAccessible({ module: makeModule("active"), setting: makeSetting(false, true) }),
    ).toBe(false);
    expect(
      isCompanyModuleAccessible({ module: makeModule("active"), setting: undefined }),
    ).toBe(false);
  });

  it("denies access when the module row is missing entirely", () => {
    expect(
      isCompanyModuleAccessible({ module: undefined, setting: makeSetting(true, true) }),
    ).toBe(false);
  });
});
