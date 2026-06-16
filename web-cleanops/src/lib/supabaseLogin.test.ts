import { describe, expect, it } from "vitest";

import { isProfileEligibleForSupabaseAuth } from "./supabaseLogin";
import type { Profile, ProfileStatus, UserRole } from "@/types";

function makeProfile(over: Partial<Profile> = {}): Profile {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    companyId: "00000000-0000-0000-0000-0000000000aa",
    baseRole: "company_admin",
    fullName: "Test Admin",
    email: "admin@example.com",
    status: "active",
    createdAt: new Date().toISOString(),
    ...over,
  };
}

describe("isProfileEligibleForSupabaseAuth", () => {
  describe("eligible", () => {
    it("allows an active super_admin (company_id present)", () => {
      expect(
        isProfileEligibleForSupabaseAuth(
          makeProfile({ baseRole: "super_admin" }),
        ),
      ).toBe(true);
    });

    it("allows an active super_admin even without a company_id", () => {
      // super_admin is platform-wide; companyId is null by design.
      expect(
        isProfileEligibleForSupabaseAuth(
          makeProfile({ baseRole: "super_admin", companyId: null }),
        ),
      ).toBe(true);
    });

    it("allows an active company_admin with a companyId", () => {
      expect(
        isProfileEligibleForSupabaseAuth(
          makeProfile({ baseRole: "company_admin", companyId: "cmp-uuid" }),
        ),
      ).toBe(true);
    });
  });

  describe("not eligible", () => {
    it("rejects an inactive super_admin", () => {
      for (const status of ["inactive", "archived"] as ProfileStatus[]) {
        expect(
          isProfileEligibleForSupabaseAuth(
            makeProfile({ baseRole: "super_admin", status }),
          ),
        ).toBe(false);
      }
    });

    it("rejects an inactive company_admin", () => {
      for (const status of ["inactive", "archived"] as ProfileStatus[]) {
        expect(
          isProfileEligibleForSupabaseAuth(
            makeProfile({ baseRole: "company_admin", status }),
          ),
        ).toBe(false);
      }
    });

    it("rejects an active company_admin without a companyId", () => {
      expect(
        isProfileEligibleForSupabaseAuth(
          makeProfile({ baseRole: "company_admin", companyId: null }),
        ),
      ).toBe(false);
      expect(
        isProfileEligibleForSupabaseAuth(
          makeProfile({ baseRole: "company_admin", companyId: "" }),
        ),
      ).toBe(false);
    });

    it("rejects an active employee", () => {
      expect(
        isProfileEligibleForSupabaseAuth(
          makeProfile({ baseRole: "employee" }),
        ),
      ).toBe(false);
    });

    it("rejects an active customer", () => {
      expect(
        isProfileEligibleForSupabaseAuth(
          makeProfile({ baseRole: "customer" }),
        ),
      ).toBe(false);
    });

    it("rejects non-admin roles regardless of company binding", () => {
      const roles: UserRole[] = ["employee", "customer"];
      for (const baseRole of roles) {
        expect(
          isProfileEligibleForSupabaseAuth(
            makeProfile({ baseRole, companyId: "cmp-uuid" }),
          ),
        ).toBe(false);
      }
    });
  });
});
