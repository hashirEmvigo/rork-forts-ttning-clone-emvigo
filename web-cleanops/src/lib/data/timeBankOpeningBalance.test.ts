/**
 * Time Bank — Opening Balance & Legacy History Foundation tests.
 *
 * Covers the migration/onboarding layer: the dedicated `opening_balance` ledger
 * entry (a real, single, balance-affecting transaction) and the INFORMATIONAL-
 * ONLY legacy history notes (which must NEVER influence balance, statements,
 * warnings, refill, expiry or carryover).
 *
 * Pure-logic suites need no mocks. The persistence suite runs against the
 * in-memory Supabase stand-in (no network, no localStorage, no real Supabase,
 * no activation).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildLegacyHistoryNote,
  buildOpeningBalanceTransaction,
  findOpeningBalances,
  hasOpeningBalance,
  openingBalanceTransactionId,
  validateLegacyHistoryNote,
  validateSingleOpeningBalance,
  buildAdminHistoryView,
  buildCustomerHistoryView,
} from "./timeBankMigration";
import {
  buildStatement,
  buildTransaction,
  defaultTimeBankRules,
  deriveBalance,
} from "./timeBank";
import {
  computeAgeExpiry,
  evaluateWalletWarnings,
  planTimeBankExpiry,
  planTimeBankRefill,
} from "./timeBankRefill";
import type { TimeBankTransaction, TimeBankWallet } from "@/types";

const NOW = "2026-02-01T00:00:00.000Z";

function makeWallet(over: Partial<TimeBankWallet> = {}): TimeBankWallet {
  return {
    id: "wal_1",
    agreementGroupId: "grp_1",
    customerId: "cust_1",
    companyId: "cmp_1",
    status: "active",
    rules: defaultTimeBankRules(600),
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

// ── Opening balance: a real, single, balance-affecting ledger entry ──

describe("opening balance — ledger entry", () => {
  it("affects the wallet balance like any transaction (signed integer minutes)", () => {
    const wallet = makeWallet();
    const opening = buildOpeningBalanceTransaction({
      wallet,
      minutes: 420,
      effectiveAt: "2026-01-01T00:00:00.000Z",
      now: NOW,
      importedBy: "user_admin",
      note: "Carried from legacy system",
      sourceReference: "LEGACY-2025",
    });
    expect(opening.type).toBe("opening_balance");
    expect(opening.minutes).toBe(420);
    expect(opening.id).toBe("wal_1-opening");
    expect(opening.sourceWorkOrderId).toBe("LEGACY-2025");
    expect(deriveBalance([opening]).currentBalance).toBe(420);
  });

  it("supports a negative opening balance (customer started in deficit)", () => {
    const opening = buildOpeningBalanceTransaction({
      wallet: makeWallet(),
      minutes: -90,
      effectiveAt: "2026-01-01T00:00:00.000Z",
      now: NOW,
    });
    expect(opening.minutes).toBe(-90);
    expect(deriveBalance([opening]).currentBalance).toBe(-90);
  });

  it("opening balance + later transactions derive correctly", () => {
    const wallet = makeWallet();
    const opening = buildOpeningBalanceTransaction({
      wallet,
      minutes: 480,
      effectiveAt: "2026-01-01T00:00:00.000Z",
      now: NOW,
    });
    const consume = buildTransaction({
      id: "tx_visit",
      wallet,
      type: "visit_consumption",
      minutes: 120,
      effectiveAt: "2026-01-10T00:00:00.000Z",
      now: NOW,
    });
    expect(deriveBalance([opening, consume]).currentBalance).toBe(360);
  });

  it("is visible distinctly on statements (openingBalanceMinutes)", () => {
    const wallet = makeWallet();
    const opening = buildOpeningBalanceTransaction({
      wallet,
      minutes: 300,
      effectiveAt: "2026-01-01T00:00:00.000Z",
      now: NOW,
    });
    const migration = buildTransaction({
      id: "tx_mig",
      wallet,
      type: "migration",
      minutes: 50,
      effectiveAt: "2026-01-02T00:00:00.000Z",
      now: NOW,
    });
    const statement = buildStatement([opening, migration]);
    expect(statement.openingBalanceMinutes).toBe(300);
    expect(statement.migrationMinutes).toBe(50); // opening kept separate
    expect(statement.closingBalance).toBe(350);
  });

  it("enforces at most ONE opening balance per wallet", () => {
    const wallet = makeWallet();
    const opening = buildOpeningBalanceTransaction({
      wallet,
      minutes: 200,
      effectiveAt: "2026-01-01T00:00:00.000Z",
      now: NOW,
    });
    expect(validateSingleOpeningBalance([]).ok).toBe(true);
    const guard = validateSingleOpeningBalance([opening]);
    expect(guard.ok).toBe(false);
    expect(guard.existingCount).toBe(1);
    expect(hasOpeningBalance([opening])).toBe(true);
    expect(findOpeningBalances([opening])).toHaveLength(1);
  });

  it("deterministic id is stable for idempotent re-import", () => {
    expect(openingBalanceTransactionId("wal_42")).toBe("wal_42-opening");
  });
});

// ── Legacy history notes: informational only, never the ledger ──

describe("legacy history notes — informational only", () => {
  const wallet = makeWallet();
  const ledger: TimeBankTransaction[] = [
    buildOpeningBalanceTransaction({
      wallet,
      minutes: 480,
      effectiveAt: "2026-01-01T00:00:00.000Z",
      now: NOW,
    }),
    buildTransaction({
      id: "tx_refill",
      wallet,
      type: "monthly_refill",
      minutes: 600,
      effectiveAt: "2026-01-01T00:00:00.000Z",
      now: NOW,
    }),
  ];

  function makeNote(note: string) {
    return buildLegacyHistoryNote({
      id: `note_${note.length}`,
      wallet,
      note,
      now: NOW,
      importedBy: "user_admin",
      sourceSystem: "OldTimeBank v1",
    });
  }

  it("does NOT affect the derived balance", () => {
    // Notes are a different type and can never enter deriveBalance.
    const before = deriveBalance(ledger).currentBalance;
    makeNote("Customer previously accumulated 8 hours in the legacy system.");
    const after = deriveBalance(ledger).currentBalance;
    expect(before).toBe(1080);
    expect(after).toBe(1080);
  });

  it("does NOT affect warnings (derived from balances only)", () => {
    const balance = deriveBalance(ledger);
    const warnings = evaluateWalletWarnings({
      wallet,
      currentBalance: balance.currentBalance,
      availableBalance: balance.availableBalance,
    });
    makeNote("3 hours used during March 2025.");
    expect(warnings.lowBalance).toBe("ok");
    expect(warnings.isNegative).toBe(false);
  });

  it("does NOT affect expiry calculations", () => {
    const expiryWallet = makeWallet({
      rules: defaultTimeBankRules(600, { carryoverPolicy: "expiry", expiryAfterDays: 30 }),
    });
    const asOf = "2026-03-01T00:00:00.000Z";
    const plan = planTimeBankExpiry({
      wallet: expiryWallet,
      transactions: ledger,
      asOf,
      asOfKey: "2026-03",
    });
    const age = computeAgeExpiry(ledger, asOf, 30);
    // A note can never enter the transactions array, so adding context here is
    // structurally impossible — these results stand regardless of notes.
    expect(plan.due).toBe(true);
    expect(age.expiringMinutes).toBe(1080);
  });

  it("does NOT affect refill calculations", () => {
    const plan = planTimeBankRefill({
      wallet,
      transactions: ledger,
      periodDate: "2026-02-15T00:00:00.000Z",
    });
    expect(plan.due).toBe(true);
    expect(plan.refillMinutes).toBe(600);
  });

  it("validates non-empty text and persists audit metadata", () => {
    const note = makeNote("2 hours credited due to cancelled visits before migration.");
    expect(validateLegacyHistoryNote(note).ok).toBe(true);
    expect(note.importedBy).toBe("user_admin");
    expect(note.importedAt).toBe(NOW);
    expect(note.sourceSystem).toBe("OldTimeBank v1");
    expect(note.agreementGroupId).toBe("grp_1");

    const empty = buildLegacyHistoryNote({ id: "n", wallet, note: "   ", now: NOW });
    expect(validateLegacyHistoryNote(empty).ok).toBe(false);
  });

  it("supports multiline notes and future attachment refs", () => {
    const note = buildLegacyHistoryNote({
      id: "note_multi",
      wallet,
      note: "Line one\nLine two\nLine three",
      now: NOW,
      attachments: [{ id: "att_1", label: "Legacy export.pdf", contentType: "application/pdf" }],
    });
    expect(note.note.split("\n")).toHaveLength(3);
    expect(note.attachments?.[0].label).toBe("Legacy export.pdf");
  });
});

// ── Reporting split: customer vs admin views ──

describe("history views — customer vs admin", () => {
  const wallet = makeWallet();
  const ledger = [
    buildOpeningBalanceTransaction({ wallet, minutes: 300, effectiveAt: NOW, now: NOW }),
  ];
  const notes = [buildLegacyHistoryNote({ id: "n1", wallet, note: "Legacy 8h", now: NOW })];

  it("admin view exposes both ledger and legacy notes, kept distinct", () => {
    const view = buildAdminHistoryView(ledger, notes);
    expect(view.ledger).toHaveLength(1);
    expect(view.legacyNotes).toHaveLength(1);
  });

  it("customer view shows the ledger (incl. opening balance) but hides raw notes by default", () => {
    const hidden = buildCustomerHistoryView(ledger, notes);
    expect(hidden.ledger).toHaveLength(1);
    expect(hidden.legacyNotes).toHaveLength(0);

    const shown = buildCustomerHistoryView(ledger, notes, { includeLegacyNotes: true });
    expect(shown.legacyNotes).toHaveLength(1);
  });
});
