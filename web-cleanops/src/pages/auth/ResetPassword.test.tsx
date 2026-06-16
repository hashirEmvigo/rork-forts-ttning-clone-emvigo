import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const mocks = vi.hoisted(() => ({
  resetPassword: vi.fn(),
  completeOnboardingLogin: vi.fn(),
  hasRecoverySession: vi.fn(),
  updatePassword: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/context/AppContext", () => ({
  useApp: () => ({
    resetPassword: mocks.resetPassword,
    completeOnboardingLogin: mocks.completeOnboardingLogin,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/lib/authSupabase", () => ({
  isSupabaseAuthEnabled: true,
  hasRecoverySession: mocks.hasRecoverySession,
  updatePassword: mocks.updatePassword,
}));

import ResetPassword from "./ResetPassword";

function renderReset(path = "/reset-password#type=recovery"): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/reset-password" element={<ResetPassword />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Waits for the new-password form, fills both fields, and submits it. */
async function fillAndSubmit(value = "brand-new-password"): Promise<void> {
  await screen.findByRole("heading", { name: /Choose a new password/i });
  fireEvent.change(screen.getByLabelText("New password"), {
    target: { value },
  });
  fireEvent.change(screen.getByLabelText("Confirm password"), {
    target: { value },
  });
  fireEvent.click(screen.getByRole("button", { name: /Update password/i }));
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  // Reset the real browser hash the page reads for Supabase auth-link errors so
  // each test starts from a clean URL (no leaked error hash between cases).
  window.location.hash = "";
  mocks.hasRecoverySession.mockResolvedValue({ valid: true, error: null });
  mocks.updatePassword.mockResolvedValue({ updated: true, error: null });
  mocks.completeOnboardingLogin.mockResolvedValue(null);
});

describe("INV-A1 ResetPassword recovery-only behavior", () => {
  it("shows the recovery password form for a valid recovery session", async () => {
    renderReset();

    expect(screen.getByRole("heading", { name: /Verifying your reset link/i })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: /Choose a new password/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Update password/i })).toBeInTheDocument();
    expect(mocks.hasRecoverySession).toHaveBeenCalledTimes(1);
  });

  it("surfaces the real reason when the link itself is used/expired (otp_expired)", async () => {
    // GoTrue rejected the single-use link and redirected with an error hash and
    // NO session — the page must show the precise reason and never wait on a
    // recovery session that will never arrive.
    window.location.hash =
      "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired";
    renderReset();

    expect(await screen.findByText(/Reset link problem/i)).toBeInTheDocument();
    expect(
      screen.getByText(/already been used or has expired/i),
    ).toBeInTheDocument();
    expect(mocks.hasRecoverySession).not.toHaveBeenCalled();
    expect(mocks.updatePassword).not.toHaveBeenCalled();
  });

  it("does not treat an invite link as a password-recovery flow", async () => {
    mocks.hasRecoverySession.mockResolvedValueOnce({ valid: false, error: "Expected recovery link" });
    renderReset("/reset-password#type=invite");

    expect(await screen.findByText(/Reset link problem/i)).toBeInTheDocument();
    expect(screen.getByText(/password reset link is invalid or has expired/i)).toBeInTheDocument();
    expect(mocks.updatePassword).not.toHaveBeenCalled();
    expect(mocks.resetPassword).not.toHaveBeenCalled();
  });
});

describe("INV-A2 ResetPassword password-update error handling", () => {
  it("shows a password-specific error (not link-expired) when the new password matches the old one", async () => {
    mocks.updatePassword.mockResolvedValueOnce({
      updated: false,
      error: "New password should be different from the old password.",
      code: "same_password",
    });
    renderReset();
    await fillAndSubmit();

    expect(
      await screen.findByText(/must be different from your current password/i),
    ).toBeInTheDocument();
    // The user stays on the form to pick another password — not bounced to the
    // invalid-link screen — and we never claim the link expired.
    expect(screen.getByRole("button", { name: /Update password/i })).toBeInTheDocument();
    expect(screen.queryByText(/Reset link problem/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/has expired/i)).not.toBeInTheDocument();
    expect(mocks.completeOnboardingLogin).not.toHaveBeenCalled();
  });

  it("shows a weak-password error and keeps the user on the form", async () => {
    mocks.updatePassword.mockResolvedValueOnce({
      updated: false,
      error: "Password is too weak.",
      code: "weak_password",
    });
    renderReset();
    await fillAndSubmit();

    expect(await screen.findByText(/that password is too weak/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Update password/i })).toBeInTheDocument();
    expect(screen.queryByText(/Reset link problem/i)).not.toBeInTheDocument();
  });

  it("routes a genuine session/token failure to the invalid-link screen", async () => {
    mocks.updatePassword.mockResolvedValueOnce({
      updated: false,
      error: "Auth session missing!",
      code: "session_not_found",
    });
    renderReset();
    await fillAndSubmit();

    expect(await screen.findByText(/Reset link problem/i)).toBeInTheDocument();
    expect(
      screen.getByText(/expired or is no longer valid/i),
    ).toBeInTheDocument();
    // The recovery CTA is available so the user can request a fresh link.
    expect(
      screen.getByRole("link", { name: /Request a new reset link/i }),
    ).toBeInTheDocument();
  });
});
