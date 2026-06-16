import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const mocks = vi.hoisted(() => ({
  completeOnboardingLogin: vi.fn(),
  hasInviteSession: vi.fn(),
  updatePassword: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/context/AppContext", () => ({
  useApp: () => ({
    completeOnboardingLogin: mocks.completeOnboardingLogin,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/lib/authSupabase", () => ({
  isSupabaseAuthEnabled: true,
  hasInviteSession: mocks.hasInviteSession,
  updatePassword: mocks.updatePassword,
}));

import AcceptInvite from "./AcceptInvite";

function renderInvite(path = "/accept-invite#type=invite") {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/accept-invite" element={<AcceptInvite />} />
        <Route path="/dashboard" element={<div>App home</div>} />
        <Route path="/login" element={<div>Login page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function fillAndSubmit(password = "secure-password"): Promise<void> {
  await screen.findByRole("button", { name: /Create password and activate/i });
  fireEvent.change(screen.getByLabelText(/^Create password$/i), {
    target: { value: password },
  });
  fireEvent.change(screen.getByLabelText(/^Confirm password$/i), {
    target: { value: password },
  });
  fireEvent.click(screen.getByRole("button", { name: /Create password and activate/i }));
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.hasInviteSession.mockResolvedValue({ valid: true, error: null });
  mocks.updatePassword.mockResolvedValue({ updated: true, error: null });
  mocks.completeOnboardingLogin.mockResolvedValue({
    id: "usr_invited",
    name: "Invited User",
    email: "invitee@example.com",
    role: "employee",
    companyId: "cmp_nordlys",
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
  });
});

describe("INV-A1 AcceptInvite page", () => {
  it("shows the password activation form after a valid invite session is parsed", async () => {
    renderInvite();

    expect(screen.getByRole("heading", { name: /Verifying your invite/i })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: /Activate your account/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Create password$/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create password and activate/i })).toBeInTheDocument();
  });

  it("updates the Supabase password, hydrates the app user, and redirects home", async () => {
    renderInvite();

    await fillAndSubmit();

    await waitFor(() => expect(mocks.updatePassword).toHaveBeenCalledWith("secure-password"));
    expect(mocks.completeOnboardingLogin).toHaveBeenCalledTimes(1);
    await screen.findByText("App home");
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Account activated" }),
    );
  });

  it("redirects to login with a success message when app hydration cannot complete", async () => {
    mocks.completeOnboardingLogin.mockResolvedValueOnce(null);
    renderInvite();

    await fillAndSubmit();

    await waitFor(() => expect(mocks.updatePassword).toHaveBeenCalledTimes(1));
    await screen.findByText("Login page");
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Account activated",
        description: "Your password is set. Please sign in to continue.",
      }),
    );
  });

  it("shows a clear error for an invalid, expired, or already-used invite", async () => {
    mocks.hasInviteSession.mockResolvedValueOnce({ valid: false, error: "expired" });
    renderInvite();

    expect(await screen.findByText(/Invite link problem/i)).toBeInTheDocument();
    expect(screen.getByText(/expired, invalid, or already used/i)).toBeInTheDocument();
    expect(mocks.updatePassword).not.toHaveBeenCalled();
  });

  it("keeps the user on the invite form when password update fails", async () => {
    mocks.updatePassword.mockResolvedValueOnce({ updated: false, error: "Token expired" });
    renderInvite();

    await fillAndSubmit();

    expect(await screen.findByText(/invalid, expired, or has already been used/i)).toBeInTheDocument();
    expect(mocks.completeOnboardingLogin).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Create password and activate/i })).toBeInTheDocument();
  });
});
