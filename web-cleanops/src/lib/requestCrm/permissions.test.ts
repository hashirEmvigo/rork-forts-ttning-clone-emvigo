import { describe, expect, it } from "vitest";

import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_MODULES,
} from "@/lib/permissions";

const REQUEST_KEYS = [
  "requests.view",
  "requests.manage",
  "requests.settings.view",
  "requests.settings.manage",
] as const;

describe("REQUEST CRM permission module", () => {
  it("registers a Requests / CRM module with the four keys", () => {
    const module = PERMISSION_MODULES.find((m) => m.id === "requests");
    expect(module).toBeDefined();
    expect(module?.permissions.map((p) => p.key)).toEqual([...REQUEST_KEYS]);
    for (const key of REQUEST_KEYS) {
      expect(ALL_PERMISSIONS).toContain(key);
    }
  });

  it("grants REQUEST CRM access to shared admins (super_admin + company_admin)", () => {
    for (const role of ["super_admin", "company_admin"] as const) {
      for (const key of REQUEST_KEYS) {
        expect(DEFAULT_ROLE_PERMISSIONS[role]).toContain(key);
      }
    }
  });

  it("does NOT grant REQUEST CRM access to employee or customer roles", () => {
    for (const role of ["employee", "customer"] as const) {
      for (const key of REQUEST_KEYS) {
        expect(DEFAULT_ROLE_PERMISSIONS[role]).not.toContain(key);
      }
    }
  });
});
