import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestPasswordReset: vi.fn(),
  createSupabaseUser: vi.fn(),
}));

vi.mock("@/lib/authSupabase", () => ({
  requestPasswordReset: mocks.requestPasswordReset,
}));

vi.mock("@/lib/adminCreateUser", () => ({
  createSupabaseUser: mocks.createSupabaseUser,
}));

import {
  inviteRedirectUrl,
  passwordRecoveryRedirectUrl,
  sendEmployeeLoginEmail,
} from "@/lib/employeeLoginInvite";

describe("INV-A1 invite and recovery redirect URLs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requestPasswordReset.mockResolvedValue({ sent: true, error: null });
    mocks.createSupabaseUser.mockResolvedValue({ ok: true });
    window.history.replaceState(null, "", "/");
  });

  it("generates /accept-invite for invite links", () => {
    expect(inviteRedirectUrl()).toBe(`${window.location.origin}/accept-invite`);
  });

  it("generates /reset-password for recovery links", () => {
    expect(passwordRecoveryRedirectUrl()).toBe(`${window.location.origin}/reset-password`);
  });

  it("sends new employee login invites to /accept-invite", async () => {
    const result = await sendEmployeeLoginEmail({
      email: "nora@example.com",
      fullName: "Nora Nyberg",
      companyId: "cmp_nordlys",
      hasLogin: false,
    });

    expect(result.ok).toBe(true);
    expect(result.mode).toBe("invite");
    expect(mocks.createSupabaseUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "nora@example.com",
        baseRole: "employee",
        companyId: "cmp_nordlys",
        fullName: "Nora Nyberg",
        redirectTo: `${window.location.origin}/accept-invite`,
      }),
    );
    expect(mocks.requestPasswordReset).not.toHaveBeenCalled();
  });

  it("keeps existing-login password recovery on /reset-password", async () => {
    const result = await sendEmployeeLoginEmail({
      email: "nora@example.com",
      fullName: "Nora Nyberg",
      companyId: "cmp_nordlys",
      hasLogin: true,
    });

    expect(result.ok).toBe(true);
    expect(result.mode).toBe("reset");
    expect(mocks.requestPasswordReset).toHaveBeenCalledWith(
      "nora@example.com",
      `${window.location.origin}/reset-password`,
    );
    expect(mocks.createSupabaseUser).not.toHaveBeenCalled();
  });
});
