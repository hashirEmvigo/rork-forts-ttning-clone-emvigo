import { describe, expect, it } from "vitest";

import {
  canActivateServices,
  describeEntitlementBlock,
  describePermissionBlock,
} from "./mediaUploadMessaging";
import type { UsageGateResult } from "./serviceRegistry";

const disabledGate: UsageGateResult = {
  allowed: false,
  status: "disabled",
  limit: 30,
  used: 0,
  remaining: 30,
};

const exhaustedTrialGate: UsageGateResult = {
  allowed: false,
  status: "trial",
  limit: 30,
  used: 30,
  remaining: 0,
};

describe("canActivateServices", () => {
  it("only Super Admin can reach the activation surface by default", () => {
    expect(canActivateServices("super_admin")).toBe(true);
    expect(canActivateServices("company_admin")).toBe(false);
    expect(canActivateServices("employee")).toBe(false);
    expect(canActivateServices("customer")).toBe(false);
  });

  it("lets Company Admin activate when the future flag is enabled", () => {
    expect(canActivateServices("company_admin", { companyAdminCanActivate: true })).toBe(true);
    // The flag never elevates other non-admin roles.
    expect(canActivateServices("employee", { companyAdminCanActivate: true })).toBe(false);
    expect(canActivateServices("customer", { companyAdminCanActivate: true })).toBe(false);
  });
});

describe("describePermissionBlock", () => {
  it("returns a real permission-denied message without activation", () => {
    const msg = describePermissionBlock();
    expect(msg.kind).toBe("permission");
    expect(msg.canActivate).toBe(false);
    expect(msg.description).toBe("You do not have permission to upload media.");
  });
});

describe("describeEntitlementBlock — service disabled", () => {
  it("offers activation to Super Admin", () => {
    const msg = describeEntitlementBlock(disabledGate, "super_admin");
    expect(msg.kind).toBe("service_disabled");
    expect(msg.canActivate).toBe(true);
    expect(msg.description).toContain("not activated for this company");
    expect(msg.description).toContain("activate the service");
  });

  it("tells employees to contact their administrator (no activation)", () => {
    const msg = describeEntitlementBlock(disabledGate, "employee");
    expect(msg.canActivate).toBe(false);
    expect(msg.description).toContain("not available for this company");
    expect(msg.description).toContain("contact your administrator");
  });

  it("tells customers to contact support (no activation)", () => {
    const msg = describeEntitlementBlock(disabledGate, "customer");
    expect(msg.canActivate).toBe(false);
    expect(msg.description).toContain("contact support");
  });

  it("gives Company Admin a neutral service-provider message (no activation, no 'contact your administrator')", () => {
    const msg = describeEntitlementBlock(disabledGate, "company_admin");
    expect(msg.canActivate).toBe(false);
    expect(msg.description).toContain("not activated for this company");
    expect(msg.description).toContain("activated by your service provider");
    expect(msg.description).not.toContain("contact your administrator");
  });

  it("offers Company Admin activation when the future self-activation flag is enabled", () => {
    const msg = describeEntitlementBlock(disabledGate, "company_admin", "Media Uploads", {
      companyAdminCanActivate: true,
    });
    expect(msg.canActivate).toBe(true);
    expect(msg.description).toContain("activate the service");
  });
});

describe("describeEntitlementBlock — trial limit reached", () => {
  it("shows usage and offers activation to Super Admin", () => {
    const msg = describeEntitlementBlock(exhaustedTrialGate, "super_admin");
    expect(msg.kind).toBe("trial_limit");
    expect(msg.canActivate).toBe(true);
    expect(msg.description).toContain("trial limit reached");
    expect(msg.description).toContain("30 / 30 images used.");
  });

  it("gives Company Admin a neutral service-provider message with usage (no 'contact your administrator')", () => {
    const msg = describeEntitlementBlock(exhaustedTrialGate, "company_admin");
    expect(msg.canActivate).toBe(false);
    expect(msg.description).toContain("trial limit reached");
    expect(msg.description).toContain("30 / 30 images used.");
    expect(msg.description).toContain("activated by your service provider");
    expect(msg.description).not.toContain("contact your administrator");
  });

  it("offers Company Admin trial activation when the future flag is enabled", () => {
    const msg = describeEntitlementBlock(exhaustedTrialGate, "company_admin", "Media Uploads", {
      companyAdminCanActivate: true,
    });
    expect(msg.canActivate).toBe(true);
    expect(msg.description).toContain("30 / 30 images used.");
    expect(msg.description).toContain("activate the service");
  });

  it("shows usage to employees and points them to their administrator", () => {
    const msg = describeEntitlementBlock(exhaustedTrialGate, "employee");
    expect(msg.canActivate).toBe(false);
    expect(msg.description).toContain("30 / 30 images used.");
    expect(msg.description).toContain("contact your administrator");
  });

  it("shows usage to customers and points them to support", () => {
    const msg = describeEntitlementBlock(exhaustedTrialGate, "customer");
    expect(msg.canActivate).toBe(false);
    expect(msg.description).toContain("30 / 30 images used.");
    expect(msg.description).toContain("contact support");
  });
});
