import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { mergeAdminNavigationGroup } from "@/lib/navigation/navigationRegistry";

const mocks = vi.hoisted(() => ({
  useApp: vi.fn(),
  useNavigationConfig: vi.fn(),
  saveOverride: vi.fn(),
  resetOverride: vi.fn(),
  refetch: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/context/AppContext", () => ({ useApp: () => mocks.useApp() }));
vi.mock("@/hooks/use-navigation-config-admin", () => ({
  useNavigationConfig: () => mocks.useNavigationConfig(),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));

import { NavigationMenuPanel, categoryStateBadge } from "./NavigationMenuPanel";

function setConfig(over: Partial<ReturnType<typeof baseConfig>> = {}) {
  mocks.useNavigationConfig.mockReturnValue({ ...baseConfig(), ...over });
}

function baseConfig() {
  return {
    overrides: [],
    isLoading: false,
    isFetching: false,
    error: null as Error | null,
    refetch: mocks.refetch,
    isSaving: false,
    saveOverride: mocks.saveOverride,
    resetOverride: mocks.resetOverride,
    adminGroup: (group: "main_navigation" | "customer_card" | "calculator") =>
      mergeAdminNavigationGroup(group, []),
  };
}

function asSuperAdmin() {
  mocks.useApp.mockReturnValue({
    currentUser: { role: "super_admin", id: "u1", name: "Root" },
    hasPermission: (p: string) => p === "navigation.manage",
  });
}

/** Switch the visible category via its tab button (aria-label = title). */
function selectCategory(name: string) {
  fireEvent.click(screen.getByRole("tab", { name }));
}

/** The categorized panel defaults to Main Navigation; reach Calculator first. */
function openPricingDialog() {
  selectCategory("Calculator");
  fireEvent.click(screen.getByRole("button", { name: "Edit Pricing" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.saveOverride.mockResolvedValue(undefined);
  mocks.resetOverride.mockResolvedValue(undefined);
  asSuperAdmin();
  setConfig();
});

describe("NavigationMenuPanel — access", () => {
  it("renders the categorized editor for a Super Admin holding navigation.manage", () => {
    render(<NavigationMenuPanel />);
    // Category buttons (tabs) for every group + the planned Employee Card.
    expect(screen.getByRole("tab", { name: "Main Navigation" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Customer Card" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Calculator" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Employee Card" })).toBeInTheDocument();
  });

  it("shows the English language selector (future-ready)", () => {
    render(<NavigationMenuPanel />);
    expect(screen.getByRole("button", { name: "English" })).toBeInTheDocument();
    // Future languages are present but disabled (no translation engine yet).
    const svenska = screen.getByRole("button", { name: /Svenska/ });
    expect(svenska).toBeDisabled();
  });

  it("denies a Company Admin", () => {
    mocks.useApp.mockReturnValue({
      currentUser: { role: "company_admin", id: "u2", name: "Mgr" },
      hasPermission: () => false,
    });
    render(<NavigationMenuPanel />);
    expect(screen.getByText(/don't have permission to manage navigation/i)).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Calculator" })).not.toBeInTheDocument();
  });

  it("denies a Super Admin who lacks navigation.manage (permission, not just role)", () => {
    mocks.useApp.mockReturnValue({
      currentUser: { role: "super_admin", id: "u1", name: "Root" },
      hasPermission: () => false,
    });
    render(<NavigationMenuPanel />);
    expect(screen.getByText(/don't have permission to manage navigation/i)).toBeInTheDocument();
  });
});

describe("NavigationMenuPanel — categories", () => {
  it("defaults to Main Navigation and shows only its items", () => {
    render(<NavigationMenuPanel />);
    // Main Navigation item keys are visible…
    expect(screen.getByText("main.dashboard")).toBeInTheDocument();
    // …and Calculator items are not in the DOM until that category is selected.
    expect(screen.queryByText("calculator.pricing")).not.toBeInTheDocument();
  });

  it("switches to Calculator and shows only its items", () => {
    render(<NavigationMenuPanel />);
    selectCategory("Calculator");
    expect(screen.getByText("calculator.pricing")).toBeInTheDocument();
    expect(screen.queryByText("main.dashboard")).not.toBeInTheDocument();
  });

  it("switches to Customer Card and shows only its items", () => {
    render(<NavigationMenuPanel />);
    selectCategory("Customer Card");
    expect(screen.getByText("customer_card.contact")).toBeInTheDocument();
    expect(screen.queryByText("calculator.pricing")).not.toBeInTheDocument();
    expect(screen.queryByText("main.dashboard")).not.toBeInTheDocument();
  });

  it("shows a coming-soon placeholder for the planned Employee Card category", () => {
    render(<NavigationMenuPanel />);
    selectCategory("Employee Card");
    expect(screen.getByText(/Employee Card is coming soon/i)).toBeInTheDocument();
    // No registry items / Edit buttons for a planned group.
    expect(screen.queryByText("main.dashboard")).not.toBeInTheDocument();
  });

  it("badges each category state (Live for applied groups, Coming soon for planned)", () => {
    render(<NavigationMenuPanel />);
    expect(screen.getAllByText("Live").length).toBeGreaterThan(0);
    expect(screen.getByText("Coming soon")).toBeInTheDocument();
  });

  it("maps category state to the correct badge (pure)", () => {
    expect(categoryStateBadge("live")).toEqual({ label: "Live", tone: "green" });
    expect(categoryStateBadge("registered")).toEqual({ label: "Registered", tone: "amber" });
    expect(categoryStateBadge("coming_soon")).toEqual({ label: "Coming soon", tone: "muted" });
  });
});

describe("NavigationMenuPanel — edit dialog", () => {
  it("opens the edit dialog with locked technical fields read-only", () => {
    render(<NavigationMenuPanel />);
    openPricingDialog();

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Customize menu item")).toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    // Locked technical fields are shown, but not as editable inputs.
    expect(within(dialog).getByText("Menu key")).toBeInTheDocument();
    expect(within(dialog).getByText("Permission")).toBeInTheDocument();
    expect(within(dialog).getAllByText("calculator.manage").length).toBeGreaterThan(0);
    // The only editable text fields are the label + sort order (key/route absent).
    expect(within(dialog).queryByLabelText("Menu key")).not.toBeInTheDocument();
  });

  it("saves a custom label", async () => {
    render(<NavigationMenuPanel />);
    openPricingDialog();

    fireEvent.change(screen.getByLabelText("Custom label"), { target: { value: "Priser" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mocks.saveOverride).toHaveBeenCalledWith(
        expect.objectContaining({ menuKey: "calculator.pricing", customLabel: "Priser" }),
      ),
    );
  });

  it("saves a custom icon from the controlled set", async () => {
    render(<NavigationMenuPanel />);
    openPricingDialog();

    fireEvent.click(screen.getByRole("button", { name: "Icon Calculator" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mocks.saveOverride).toHaveBeenCalledWith(
        expect.objectContaining({ menuKey: "calculator.pricing", customIcon: "Calculator" }),
      ),
    );
  });

  it("toggles visibility and saves it", async () => {
    render(<NavigationMenuPanel />);
    openPricingDialog();

    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mocks.saveOverride).toHaveBeenCalledWith(expect.objectContaining({ isVisible: false })),
    );
  });

  it("resets an item to its default", async () => {
    render(<NavigationMenuPanel />);
    openPricingDialog();

    fireEvent.click(screen.getByRole("button", { name: /Reset to default/ }));

    await waitFor(() => expect(mocks.resetOverride).toHaveBeenCalledWith("calculator.pricing"));
  });
});
