/**
 * Tests for CustomerAgreementDetail (Phase 14 · first agreement host page).
 *
 * Renders the page with the data hooks mocked (NO Supabase / network) and
 * validates: it loads + renders the agreement summary, lines, and version info;
 * the not-found state; the Time Bank panel mounts and receives the hook's input
 * + handlers; a denied entitlement renders the disabled panel state; and no
 * dangerous controls (edit/delete) are exposed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import type { TimeBankPanelInput } from "@/lib/data/timeBankPanelModel";
import type { TimeBankAdminPanelHandlers } from "@/components/customer/TimeBankAdminPanel";
import { buildWalletForAgreement, defaultTimeBankRules } from "@/lib/data/timeBank";
import type { CustomerAgreement, CustomerAgreementLine, TimeBankWallet } from "@/types";

// ── Mocks ──────────────────────────────────────────────────
vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const detailMock = vi.fn();
vi.mock("@/hooks/use-customer-agreement-detail-source", () => ({
  useCustomerAgreementDetailSource: () => detailMock(),
}));

const panelMock = vi.fn();
const onCreateOpeningBalance = vi.fn();
vi.mock("@/hooks/use-time-bank-panel", () => ({
  useTimeBankPanel: () => panelMock(),
}));

vi.mock("@/lib/data", () => ({
  resolveTimeBankEntitlement: vi.fn(async () => ({
    allowed: true,
    status: "enabled",
    source: "bundle",
    contributingBundleIds: ["bundle-pro"],
    globallyAvailable: true,
    denialReason: null,
  })),
}));

vi.mock("@/context/AppContext", () => ({
  useApp: () => ({
    currentUser: { id: "user_1", name: "Admin", role: "super_admin", companyId: null },
    hasPermission: () => true,
  }),
}));

import CustomerAgreementDetail from "./CustomerAgreementDetail";

const T1 = "2026-01-01T00:00:00.000Z";

function agreement(over: Partial<CustomerAgreement> = {}): CustomerAgreement {
  return {
    id: "grp1_v1",
    agreementGroupId: "grp_1",
    companyId: "cmp_1",
    customerId: "cust_1",
    version: 1,
    status: "active",
    billingModel: "monthly_fixed",
    invoiceInterval: "monthly",
    name: "Office cleaning",
    sourceType: "manual",
    sourceReferenceId: null,
    supersedesVersionId: null,
    supersededById: null,
    validFrom: "2026-01-01",
    validTo: null,
    notes: null,
    createdBy: "user_1",
    createdAt: T1,
    updatedAt: T1,
    ...over,
  } as CustomerAgreement;
}

function line(): CustomerAgreementLine {
  return {
    id: "line_1",
    agreementId: "grp1_v1",
    agreementGroupId: "grp_1",
    companyId: "cmp_1",
    sortOrder: 0,
    pricingModel: "custom",
    agreedPrice: 1200,
    quantity: 1,
    unit: "month",
    vat: 25,
    sourceServiceId: "svc_1",
    serviceNameSnapshot: "Office cleaning",
    categoryNameSnapshot: "Recurring",
    createdAt: T1,
    updatedAt: T1,
  } as CustomerAgreementLine;
}

function wallet(): TimeBankWallet {
  return buildWalletForAgreement({
    id: "wallet_1",
    agreement: agreement(),
    rules: defaultTimeBankRules(600),
    now: T1,
  });
}

function panelInput(over: Partial<TimeBankPanelInput> = {}): TimeBankPanelInput {
  return {
    timeBankEnabledOnAgreement: true,
    entitlement: {
      allowed: false,
      status: "disabled",
      source: "none",
      contributingBundleIds: [],
      globallyAvailable: true,
      denialReason: "This company is not entitled to Time Bank.",
    },
    wallet: null,
    transactions: [],
    legacyNotes: [],
    cancellationPolicy: null,
    ...over,
  };
}

function setPanel(input: TimeBankPanelInput, handlers: TimeBankAdminPanelHandlers = {}): void {
  panelMock.mockReturnValue({
    input,
    loading: false,
    loadError: null,
    actionError: null,
    pending: false,
    reload: vi.fn(),
    handlers,
  });
}

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={["/agreements/grp1_v1"]}>
      <CustomerAgreementDetail />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  detailMock.mockReturnValue({
    agreement: agreement(),
    lines: [line()],
    versionChain: [agreement()],
    loading: false,
    error: null,
    reload: vi.fn(),
  });
  setPanel(panelInput());
});

describe("CustomerAgreementDetail — agreement rendering", () => {
  it("renders the agreement summary, lines and version info", () => {
    renderPage();
    expect(screen.getAllByText("Office cleaning").length).toBeGreaterThan(0);
    expect(screen.getByText("Service lines")).toBeInTheDocument();
    expect(screen.getByTestId("agreement-line-line_1")).toBeInTheDocument();
    expect(screen.getByText("Version information")).toBeInTheDocument();
    expect(screen.getByText("v1")).toBeInTheDocument();
  });

  it("renders the not-found state when no agreement loaded", () => {
    detailMock.mockReturnValue({
      agreement: null,
      lines: [],
      versionChain: [],
      loading: false,
      error: null,
      reload: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("Agreement not found")).toBeInTheDocument();
  });

  it("renders the loading state", () => {
    detailMock.mockReturnValue({
      agreement: null,
      lines: [],
      versionChain: [],
      loading: true,
      error: null,
      reload: vi.fn(),
    });
    renderPage();
    expect(screen.getByText(/Loading agreement/i)).toBeInTheDocument();
  });
});

describe("CustomerAgreementDetail — Time Bank panel", () => {
  it("mounts the Time Bank panel with the wallet from the hook", () => {
    setPanel(
      panelInput({
        entitlement: {
          allowed: true,
          status: "enabled",
          source: "bundle",
          contributingBundleIds: ["bundle-pro"],
          globallyAvailable: true,
          denialReason: null,
        },
        wallet: wallet(),
      }),
    );
    renderPage();
    expect(screen.getByTestId("time-bank-admin-panel")).toBeInTheDocument();
    expect(screen.getByText("Entitled")).toBeInTheDocument();
  });

  it("renders the disabled panel state when entitlement is denied and no wallet", () => {
    setPanel(panelInput());
    renderPage();
    expect(screen.getByTestId("time-bank-admin-panel")).toBeInTheDocument();
    expect(screen.getByText("Not entitled")).toBeInTheDocument();
  });

  it("passes the opening-balance handler through to the panel", () => {
    setPanel(
      panelInput({
        entitlement: {
          allowed: true,
          status: "enabled",
          source: "bundle",
          contributingBundleIds: ["bundle-pro"],
          globallyAvailable: true,
          denialReason: null,
        },
        wallet: wallet(),
      }),
      { onCreateOpeningBalance },
    );
    renderPage();
    // The opening-balance form is offered (handler wired through).
    expect(
      screen.getByRole("button", { name: /Add opening balance/i }),
    ).toBeInTheDocument();
  });

  it("never exposes dangerous edit/delete controls", () => {
    renderPage();
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^edit/i })).not.toBeInTheDocument();
  });
});
