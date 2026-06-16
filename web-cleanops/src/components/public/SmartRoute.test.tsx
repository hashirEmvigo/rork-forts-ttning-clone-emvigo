import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SmartRoute } from "@/components/public/SmartRoute";

const mocks = vi.hoisted(() => ({
  useApp: vi.fn(),
}));

vi.mock("@/context/AppContext", () => ({
  useApp: () => mocks.useApp(),
}));

interface MockUser {
  id: string;
  role: "super_admin" | "company_admin" | "employee" | "customer";
}

function setAppState(input: { currentUser: MockUser | null; isAuthRestoring?: boolean }) {
  mocks.useApp.mockReturnValue({
    currentUser: input.currentUser,
    isAuthRestoring: input.isAuthRestoring ?? false,
  });
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

/** Mirrors how `/` is wired in App.tsx: public marketing vs. dashboard redirect. */
function renderSmartRoot() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route
          path="/"
          element={
            <SmartRoute publicView={<div>Public marketing home</div>}>
              <LocationProbe />
              <div>Redirected to dashboard</div>
            </SmartRoute>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SmartRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the public view for logged-out visitors", () => {
    setAppState({ currentUser: null, isAuthRestoring: false });

    renderSmartRoot();

    expect(screen.getByText("Public marketing home")).toBeInTheDocument();
    expect(screen.queryByText("Redirected to dashboard")).not.toBeInTheDocument();
  });

  it("renders the authenticated view for signed-in users", () => {
    setAppState({ currentUser: { id: "usr_1", role: "super_admin" }, isAuthRestoring: false });

    renderSmartRoot();

    expect(screen.getByText("Redirected to dashboard")).toBeInTheDocument();
    expect(screen.queryByText("Public marketing home")).not.toBeInTheDocument();
  });

  it("shows a neutral splash while the session is restoring (no cross-flash)", () => {
    setAppState({ currentUser: null, isAuthRestoring: true });

    renderSmartRoot();

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText("Public marketing home")).not.toBeInTheDocument();
    expect(screen.queryByText("Redirected to dashboard")).not.toBeInTheDocument();
  });
});
