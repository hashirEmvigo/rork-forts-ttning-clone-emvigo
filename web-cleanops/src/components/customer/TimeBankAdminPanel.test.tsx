/**
 * Tests for TimeBankAdminPanel (Phase 13 · first admin UI surface).
 *
 * React Testing Library against the jsdom environment. Validates rendering of
 * each section, the safe admin actions (opening balance, legacy note,
 * adjustment), the disabled/no-wallet states, and the safety constraints (no
 * wallet creation when denied, no edit/delete of ledger rows, no second opening
 * balance).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { TimeBankAdminPanel } from "./TimeBankAdminPanel";
import {
  buildOpeningBalanceTransaction,
  buildLegacyHistoryNote,
} from "@/lib/data/timeBankMigration";
import {
  buildTransaction,
  buildWalletForAgreement,
  defaultTimeBankRules,
} from "@/lib/data/timeBank";
import type { TimeBankPanelInput } from "@/lib/data/timeBankPanelModel";
import type { TimeBankEntitlementDecision } from "@/lib/data/timeBankEntitlement";
import type {
  CustomerAgreement,
  TimeBankTransaction,
  TimeBankWallet,
} from "@/types";

const NOW = "2026-01-15T10:00:00.000Z";

function agreement(): CustomerAgreement {
  return { agreementGroupId: "grp-1", customerId: "cust-1", companyId: "co-1" } as CustomerAgreement;
}

function wallet(over: Partial<TimeBankWallet> = {}): TimeBankWallet {
  const base = buildWalletForAgreement({
    id: "wallet-1",
    agreement: agreement(),
    rules: defaultTimeBankRules(600),
    now: NOW,
  });
  return { ...base, ...over };
}

function tx(
  type: TimeBankTransaction["type"],
  minutes: number,
  over: Partial<TimeBankTransaction> = {},
): TimeBankTransaction {
  const built = buildTransaction({
    id: `${type}-${minutes}`,
    wallet: wallet(),
    type,
    minutes,
    effectiveAt: NOW,
    now: NOW,
  });
  return { ...built, ...over };
}

function entitled(allowed: boolean): TimeBankEntitlementDecision {
  return {
    allowed,
    status: allowed ? "enabled" : "disabled",
    source: allowed ? "bundle" : "none",
    contributingBundleIds: allowed ? ["bundle-pro"] : [],
    globallyAvailable: true,
    denialReason: allowed ? null : "This company is not entitled to Time Bank.",
  };
}

function input(over: Partial<TimeBankPanelInput> = {}): TimeBankPanelInput {
  return {
    timeBankEnabledOnAgreement: true,
    entitlement: entitled(true),
    wallet: wallet(),
    transactions: [],
    legacyNotes: [],
    cancellationPolicy: null,
    ...over,
  };
}

beforeEach(() => cleanup());

describe("TimeBankAdminPanel — visibility & states", () => {
  it("renders for a Time Bank agreement", () => {
    render(<TimeBankAdminPanel input={input()} />);
    expect(screen.getByTestId("time-bank-admin-panel")).toBeInTheDocument();
    expect(screen.getByText("Time Bank")).toBeInTheDocument();
    expect(screen.getByText("Entitled")).toBeInTheDocument();
  });

  it("renders nothing when not relevant", () => {
    const { container } = render(
      <TimeBankAdminPanel
        input={input({
          timeBankEnabledOnAgreement: false,
          entitlement: entitled(false),
          wallet: null,
        })}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows a disabled state with the denial reason when denied and no wallet", () => {
    render(
      <TimeBankAdminPanel input={input({ wallet: null, entitlement: entitled(false) })} />,
    );
    expect(screen.getByText("Not entitled")).toBeInTheDocument();
    expect(
      screen.getAllByText(/not entitled to Time Bank/i).length,
    ).toBeGreaterThan(0);
    // No wallet summary / no actions.
    expect(screen.queryByLabelText("Wallet")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Add opening balance/i }),
    ).not.toBeInTheDocument();
  });
});

describe("TimeBankAdminPanel — wallet summary", () => {
  it("renders derived balances", () => {
    render(
      <TimeBankAdminPanel
        input={input({ transactions: [tx("opening_balance", 300), tx("reservation", 90)] })}
      />,
    );
    const summary = screen.getByLabelText("Wallet");
    expect(within(summary).getByText("3h 30m")).toBeInTheDocument(); // available 210
  });

  it("renders frozen status and hides adjustment form", () => {
    render(
      <TimeBankAdminPanel
        input={input({ wallet: wallet({ status: "frozen" }) })}
        onAddAdjustment={vi.fn()}
      />,
    );
    expect(screen.getByText("Frozen")).toBeInTheDocument();
    // Adjustment blocked on frozen wallet → no Record adjustment button.
    expect(
      screen.queryByRole("button", { name: /Record adjustment/i }),
    ).not.toBeInTheDocument();
  });
});

describe("TimeBankAdminPanel — opening balance", () => {
  it("creates an opening balance via the form", () => {
    const onCreateOpeningBalance = vi.fn();
    render(
      <TimeBankAdminPanel input={input()} onCreateOpeningBalance={onCreateOpeningBalance} />,
    );
    fireEvent.change(screen.getByLabelText("Hours"), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText("Minutes"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Carried over" } });
    fireEvent.click(screen.getByRole("button", { name: /Add opening balance/i }));
    expect(onCreateOpeningBalance).toHaveBeenCalledWith({
      minutes: 420,
      note: "Carried over",
      sourceReference: null,
    });
  });

  it("prevents a second opening balance (no form, message instead)", () => {
    const ob = buildOpeningBalanceTransaction({
      wallet: wallet(),
      minutes: 120,
      effectiveAt: NOW,
      now: NOW,
    });
    render(
      <TimeBankAdminPanel
        input={input({ transactions: [ob] })}
        onCreateOpeningBalance={vi.fn()}
      />,
    );
    expect(screen.getByText(/has been imported/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Add opening balance/i }),
    ).not.toBeInTheDocument();
  });

  it("validates the amount before submitting", () => {
    const onCreateOpeningBalance = vi.fn();
    render(
      <TimeBankAdminPanel input={input()} onCreateOpeningBalance={onCreateOpeningBalance} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Add opening balance/i }));
    expect(onCreateOpeningBalance).not.toHaveBeenCalled();
    expect(screen.getByText(/greater than zero/i)).toBeInTheDocument();
  });
});

describe("TimeBankAdminPanel — legacy notes", () => {
  it("adds a legacy note", () => {
    const onAddLegacyNote = vi.fn();
    render(<TimeBankAdminPanel input={input()} onAddLegacyNote={onAddLegacyNote} />);
    fireEvent.change(screen.getByLabelText("Note"), {
      target: { value: "8 hours in legacy system" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add legacy note/i }));
    expect(onAddLegacyNote).toHaveBeenCalledWith({
      note: "8 hours in legacy system",
      sourceSystem: null,
    });
  });

  it("renders existing legacy notes and they never affect balance", () => {
    const note = buildLegacyHistoryNote({
      id: "n1",
      wallet: wallet(),
      note: "Customer previously accumulated 8 hours.",
      now: NOW,
      sourceSystem: "OldSys",
    });
    render(
      <TimeBankAdminPanel
        input={input({ transactions: [tx("opening_balance", 120)], legacyNotes: [note] })}
      />,
    );
    expect(screen.getByText(/previously accumulated 8 hours/i)).toBeInTheDocument();
    // Balance shows the ledger's 2h (120m), not the note's 8h.
    const summary = screen.getByLabelText("Wallet");
    expect(within(summary).getAllByText("2h").length).toBeGreaterThan(0);
  });
});

describe("TimeBankAdminPanel — adjustments & ledger", () => {
  it("records a manual remove adjustment", () => {
    const onAddAdjustment = vi.fn();
    render(<TimeBankAdminPanel input={input()} onAddAdjustment={onAddAdjustment} />);
    fireEvent.click(screen.getByRole("button", { name: /^Remove$/ }));
    fireEvent.change(screen.getByLabelText("Hours"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Correction" } });
    fireEvent.click(screen.getByRole("button", { name: /Record adjustment/i }));
    expect(onAddAdjustment).toHaveBeenCalledWith({
      direction: "manual_remove",
      minutes: 60,
      reason: "Correction",
    });
  });

  it("renders ledger rows including the cancellation breakdown", () => {
    const credit = tx("cancelled_visit_credit", 180, {
      cancellationCredit: {
        originalVisitMinutes: 240,
        deductionMethod: "fixed",
        deductionValue: 60,
        deductionMinutes: 60,
        creditedMinutes: 180,
        cancellationReason: "Cancelled",
      },
    });
    render(<TimeBankAdminPanel input={input({ transactions: [credit] })} />);
    expect(screen.getByTestId("ledger-row-cancelled_visit_credit")).toBeInTheDocument();
    expect(screen.getByText(/credited/i)).toBeInTheDocument();
  });

  it("never renders edit or delete controls for ledger rows (safety)", () => {
    render(<TimeBankAdminPanel input={input({ transactions: [tx("monthly_refill", 600)] })} />);
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
  });
});

describe("TimeBankAdminPanel — cancellation policy & wallet status", () => {
  it("renders the cancellation policy", () => {
    render(
      <TimeBankAdminPanel
        input={input({
          cancellationPolicy: {
            enabled: true,
            deductionMethod: "percentage",
            deductionPercent: 25,
            minCreditMinutes: 0,
          },
        })}
      />,
    );
    expect(screen.getByText("Cancellation credit")).toBeInTheDocument();
    expect(screen.getByText(/25% of the visit duration/i)).toBeInTheDocument();
  });

  it("offers freeze/close only when a handler is supplied and active", () => {
    const onSetWalletStatus = vi.fn();
    render(<TimeBankAdminPanel input={input()} onSetWalletStatus={onSetWalletStatus} />);
    fireEvent.click(screen.getByRole("button", { name: /Freeze/i }));
    expect(onSetWalletStatus).toHaveBeenCalledWith("frozen");
  });

  it("does not offer wallet status controls without a handler", () => {
    render(<TimeBankAdminPanel input={input()} />);
    expect(screen.queryByRole("button", { name: /Freeze/i })).not.toBeInTheDocument();
  });
});
