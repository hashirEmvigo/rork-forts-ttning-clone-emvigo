import { describe, expect, it } from "vitest";

import {
  classifyServiceGroup,
  isDefaultWorkspaceService,
  isLegacyService,
  isLegacyWorkspaceService,
  isPilotService,
  partitionWorkspaceServices,
  serviceStatusBadges,
  summarizeWorkspaceConfigCounts,
} from "./serviceListPresentation";

type ServiceLike = {
  serviceKey: string;
  pricingModel: string;
  enabled: boolean;
  comingSoon: boolean;
};

function svc(over: Partial<ServiceLike> = {}): ServiceLike {
  return {
    serviceKey: "home_cleaning",
    pricingModel: "home_cleaning_recommended_hours",
    enabled: true,
    comingSoon: false,
    ...over,
  };
}

describe("classifyServiceGroup", () => {
  it("classifies Home Cleaning as the pilot regardless of its (legacy) pricing model", () => {
    expect(classifyServiceGroup(svc())).toBe("pilot");
    expect(isPilotService(svc())).toBe(true);
  });

  it("classifies the seeded legacy services as legacy", () => {
    const legacy: ServiceLike[] = [
      svc({ serviceKey: "move_out_cleaning", pricingModel: "move_out_fixed_plus_addons" }),
      svc({ serviceKey: "office_cleaning", pricingModel: "office_cleaning_recurring_area_frequency" }),
      svc({ serviceKey: "window_cleaning", pricingModel: "window_cleaning_count_based" }),
      svc({ serviceKey: "deep_cleaning", pricingModel: "deep_cleaning_area_addons" }),
      svc({ serviceKey: "stairwell_cleaning", pricingModel: "stairwell_cleaning_floors_frequency" }),
      svc({ serviceKey: "procurement", pricingModel: "inquiry_only_no_price" }),
    ];
    for (const s of legacy) {
      expect(classifyServiceGroup(s)).toBe("legacy");
      expect(isLegacyService(s)).toBe(true);
    }
  });

  it("classifies a future non-Home service on a GENERIC pricing model as pilot/builder", () => {
    expect(classifyServiceGroup(svc({ serviceKey: "office_v2", pricingModel: "hourly_by_area" }))).toBe("pilot");
    expect(classifyServiceGroup(svc({ serviceKey: "windows_v2", pricingModel: "unit_based" }))).toBe("pilot");
    expect(classifyServiceGroup(svc({ serviceKey: "anything", pricingModel: "manual_quote" }))).toBe("pilot");
  });

  it("treats an unknown non-legacy pricing model as pilot/builder (not legacy)", () => {
    expect(classifyServiceGroup(svc({ serviceKey: "mystery", pricingModel: "totally_unknown" }))).toBe("pilot");
  });
});

describe("serviceStatusBadges", () => {
  it("marks Home with a V2 Pilot badge + Live when enabled", () => {
    const badges = serviceStatusBadges(svc({ enabled: true }));
    expect(badges.map((b) => b.label)).toEqual(["V2 Pilot", "Live"]);
  });

  it("marks an enabled legacy service as Legacy + Live (admins are never blind to public services)", () => {
    const badges = serviceStatusBadges(
      svc({ serviceKey: "office_cleaning", pricingModel: "office_cleaning_recurring_area_frequency", enabled: true }),
    );
    expect(badges.map((b) => b.label)).toEqual(["Legacy", "Live"]);
  });

  it("marks a coming-soon service", () => {
    const badges = serviceStatusBadges(
      svc({ serviceKey: "window_cleaning", pricingModel: "window_cleaning_count_based", enabled: false, comingSoon: true }),
    );
    expect(badges.map((b) => b.label)).toEqual(["Legacy", "Coming soon"]);
  });

  it("marks a hidden draft service", () => {
    const badges = serviceStatusBadges(
      svc({ serviceKey: "window_cleaning", pricingModel: "window_cleaning_count_based", enabled: false, comingSoon: false }),
    );
    expect(badges.map((b) => b.label)).toEqual(["Legacy", "Hidden"]);
  });
});

// ── GPM-ADMIN-FILTER-1: default workspace visibility ────────────────────

describe("isDefaultWorkspaceService / isLegacyWorkspaceService", () => {
  it("treats enabled Home as the default-workspace service", () => {
    const home = svc({ serviceKey: "home_cleaning", enabled: true });
    expect(isDefaultWorkspaceService(home)).toBe(true);
    expect(isLegacyWorkspaceService(home)).toBe(false);
  });

  it("excludes a disabled Home from the default workspace", () => {
    const home = svc({ serviceKey: "home_cleaning", enabled: false });
    expect(isDefaultWorkspaceService(home)).toBe(false);
    expect(isLegacyWorkspaceService(home)).toBe(true);
  });

  it("excludes seeded legacy-model services even when enabled", () => {
    const office = svc({ serviceKey: "office_cleaning", pricingModel: "office_cleaning_recurring_area_frequency", enabled: true });
    const moveOut = svc({ serviceKey: "move_out_cleaning", pricingModel: "move_out_fixed_plus_addons", enabled: true });
    expect(isDefaultWorkspaceService(office)).toBe(false);
    expect(isDefaultWorkspaceService(moveOut)).toBe(false);
  });

  it("excludes disabled legacy-model services (move-out / office)", () => {
    expect(
      isLegacyWorkspaceService(
        svc({ serviceKey: "office_cleaning", pricingModel: "office_cleaning_recurring_area_frequency", enabled: false }),
      ),
    ).toBe(true);
    expect(
      isLegacyWorkspaceService(
        svc({ serviceKey: "move_out_cleaning", pricingModel: "move_out_fixed_plus_addons", enabled: false }),
      ),
    ).toBe(true);
  });

  it("keeps an enabled admin-built generic-model service in the default workspace", () => {
    expect(isDefaultWorkspaceService(svc({ serviceKey: "office_v2", pricingModel: "hourly_by_area", enabled: true }))).toBe(true);
  });

  it("hides a disabled draft generic-model service from the default workspace", () => {
    expect(isDefaultWorkspaceService(svc({ serviceKey: "office_v2", pricingModel: "hourly_by_area", enabled: false }))).toBe(false);
  });
});

describe("partitionWorkspaceServices", () => {
  it("splits the live roster into default (Home) and legacy/hidden (move-out, office)", () => {
    const services = [
      svc({ serviceKey: "home_cleaning", enabled: true }),
      svc({ serviceKey: "move_out_cleaning", pricingModel: "move_out_fixed_plus_addons", enabled: false }),
      svc({ serviceKey: "office_cleaning", pricingModel: "office_cleaning_recurring_area_frequency", enabled: false }),
    ];
    const { defaultServices, legacyServices } = partitionWorkspaceServices(services);
    expect(defaultServices.map((s) => s.serviceKey)).toEqual(["home_cleaning"]);
    expect(legacyServices.map((s) => s.serviceKey)).toEqual(["move_out_cleaning", "office_cleaning"]);
  });

  it("preserves input order within each group", () => {
    const services = [
      svc({ serviceKey: "office_cleaning", pricingModel: "office_cleaning_recurring_area_frequency", enabled: false }),
      svc({ serviceKey: "home_cleaning", enabled: true }),
      svc({ serviceKey: "move_out_cleaning", pricingModel: "move_out_fixed_plus_addons", enabled: false }),
    ];
    const { defaultServices, legacyServices } = partitionWorkspaceServices(services);
    expect(defaultServices.map((s) => s.serviceKey)).toEqual(["home_cleaning"]);
    expect(legacyServices.map((s) => s.serviceKey)).toEqual(["office_cleaning", "move_out_cleaning"]);
  });
});

describe("summarizeWorkspaceConfigCounts", () => {
  const config = {
    services: [
      { id: "svc-home", serviceKey: "home_cleaning", pricingModel: "home_cleaning_recommended_hours", enabled: true, questions: [{}, {}] },
      { id: "svc-office", serviceKey: "office_cleaning", pricingModel: "office_cleaning_recurring_area_frequency", enabled: false, questions: [{}, {}, {}] },
    ],
    cleaningPlans: [
      { serviceKey: "home_cleaning" },
      { serviceKey: "office_cleaning" },
      { serviceKey: null }, // legacy plan with no key resolves to Home
    ],
    pricingRules: [{ serviceId: "svc-home" }, { serviceId: "svc-home" }, { serviceId: "svc-office" }],
  };

  it("scopes the default counts to the active (Home) workspace", () => {
    expect(summarizeWorkspaceConfigCounts(config).defaultCounts).toEqual({
      services: 1,
      enabledServices: 1,
      cleaningPlans: 2,
      questions: 2,
      pricingRules: 2,
    });
  });

  it("reports the legacy/hidden counts separately", () => {
    expect(summarizeWorkspaceConfigCounts(config).legacyCounts).toEqual({
      services: 1,
      enabledServices: 0,
      cleaningPlans: 1,
      questions: 3,
      pricingRules: 1,
    });
  });
});
