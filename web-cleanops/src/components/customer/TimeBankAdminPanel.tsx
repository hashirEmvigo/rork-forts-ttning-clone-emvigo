/**
 * TimeBankAdminPanel — the FIRST admin UI surface for Time Bank (Phase 13).
 *
 * An internal/admin-only panel intended to live inside the Customer Agreement
 * detail view. It renders the full Time Bank picture for an agreement group
 * (entitlement, wallet, balances, rules, cancellation policy, opening balance,
 * legacy history and the immutable ledger) and offers a SMALL set of safe admin
 * actions: create the single opening balance, add an informational legacy note,
 * and append an audited manual adjustment. Wallet freeze/close is offered only
 * when a handler is supplied and the current status allows it.
 *
 * SAFETY (foundation only — no customer portal, no scheduler, no billing):
 *   * The panel NEVER creates a wallet (entitlement governs wallet creation
 *     elsewhere) — a denied/no-wallet state renders read-only.
 *   * No editing or deleting of historical ledger rows; corrections must use an
 *     adjustment transaction.
 *   * At most one opening balance per wallet; all gating comes from
 *     {@link buildTimeBankPanelModel}, which the component never overrides.
 *
 * The component is presentational: it derives everything through the pure
 * view-model and emits actions via callbacks. Persistence wiring is the caller's
 * responsibility and is intentionally out of scope here.
 */
import { useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Ban,
  Clock,
  History,
  Info,
  Lock,
  PlusCircle,
  ShieldCheck,
  ShieldX,
  Wallet,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  buildTimeBankPanelModel,
  parseHoursMinutes,
  type TimeBankPanelInput,
} from "@/lib/data/timeBankPanelModel";
import type { TimeBankWalletStatus } from "@/types";

/** A single safe admin action emitted by the panel. */
export interface TimeBankAdminPanelHandlers {
  /** Create the wallet's single opening balance (signed magnitude in minutes). */
  onCreateOpeningBalance?: (args: {
    minutes: number;
    note: string;
    sourceReference: string | null;
  }) => void;
  /** Append an audited manual adjustment. */
  onAddAdjustment?: (args: {
    direction: "manual_add" | "manual_remove";
    minutes: number;
    reason: string;
  }) => void;
  /** Record an informational legacy history note (never affects balance). */
  onAddLegacyNote?: (args: { note: string; sourceSystem: string | null }) => void;
  /** Change wallet status (freeze / close). Only rendered when supplied. */
  onSetWalletStatus?: (status: TimeBankWalletStatus) => void;
}

export interface TimeBankAdminPanelProps extends TimeBankAdminPanelHandlers {
  input: TimeBankPanelInput;
  className?: string;
}

/** A label + value row used throughout the panel. */
function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-sm text-foreground">{value}</span>
    </div>
  );
}

export function TimeBankAdminPanel({
  input,
  className,
  onCreateOpeningBalance,
  onAddAdjustment,
  onAddLegacyNote,
  onSetWalletStatus,
}: TimeBankAdminPanelProps) {
  const model = useMemo(() => buildTimeBankPanelModel(input), [input]);

  // ── Local form state ──
  const [obHours, setObHours] = useState<string>("");
  const [obMinutes, setObMinutes] = useState<string>("");
  const [obNote, setObNote] = useState<string>("");
  const [obSource, setObSource] = useState<string>("");
  const [obError, setObError] = useState<string | null>(null);

  const [adjDirection, setAdjDirection] = useState<"manual_add" | "manual_remove">("manual_add");
  const [adjHours, setAdjHours] = useState<string>("");
  const [adjMinutes, setAdjMinutes] = useState<string>("");
  const [adjReason, setAdjReason] = useState<string>("");
  const [adjError, setAdjError] = useState<string | null>(null);

  const [noteText, setNoteText] = useState<string>("");
  const [noteSource, setNoteSource] = useState<string>("");
  const [noteError, setNoteError] = useState<string | null>(null);

  if (!model.visible) return null;

  const submitOpeningBalance = () => {
    const parsed = parseHoursMinutes(obHours, obMinutes);
    if (!parsed.ok) {
      setObError(parsed.error ?? "Invalid amount.");
      return;
    }
    if (obNote.trim().length === 0) {
      setObError("Add a short note describing the imported balance.");
      return;
    }
    setObError(null);
    onCreateOpeningBalance?.({
      minutes: parsed.minutes,
      note: obNote.trim(),
      sourceReference: obSource.trim() === "" ? null : obSource.trim(),
    });
    setObHours("");
    setObMinutes("");
    setObNote("");
    setObSource("");
  };

  const submitAdjustment = () => {
    const parsed = parseHoursMinutes(adjHours, adjMinutes);
    if (!parsed.ok) {
      setAdjError(parsed.error ?? "Invalid amount.");
      return;
    }
    if (adjReason.trim().length === 0) {
      setAdjError("A reason is required for every manual adjustment (audit).");
      return;
    }
    setAdjError(null);
    onAddAdjustment?.({
      direction: adjDirection,
      minutes: parsed.minutes,
      reason: adjReason.trim(),
    });
    setAdjHours("");
    setAdjMinutes("");
    setAdjReason("");
  };

  const submitLegacyNote = () => {
    if (noteText.trim().length === 0) {
      setNoteError("A legacy history note must contain text.");
      return;
    }
    setNoteError(null);
    onAddLegacyNote?.({
      note: noteText.trim(),
      sourceSystem: noteSource.trim() === "" ? null : noteSource.trim(),
    });
    setNoteText("");
    setNoteSource("");
  };

  return (
    <Card className={cn("overflow-hidden", className)} data-testid="time-bank-admin-panel">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="flex flex-col gap-1">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Clock className="h-5 w-5 text-primary" />
            Time Bank
          </CardTitle>
          <CardDescription>Admin-only · internal view. Not customer-facing.</CardDescription>
        </div>
        {model.entitlement.allowed ? (
          <Badge variant="secondary" className="gap-1">
            <ShieldCheck className="h-3.5 w-3.5" /> Entitled
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1 text-muted-foreground">
            <ShieldX className="h-3.5 w-3.5" /> Not entitled
          </Badge>
        )}
      </CardHeader>

      <CardContent className="space-y-6">
        {/* ── Entitlement ── */}
        <section className="space-y-2" aria-label="Entitlement">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Field label="Access" value={model.entitlement.allowed ? "Allowed" : "Denied"} />
            <Field label="Status" value={model.entitlement.statusLabel} />
            <Field label="Source" value={model.entitlement.sourceLabel} />
            <Field
              label="Platform"
              value={model.entitlement.globallyAvailable ? "Available" : "Unavailable"}
            />
          </div>
          {model.entitlement.contributingBundleIds.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {model.entitlement.contributingBundleIds.map((id) => (
                <Badge key={id} variant="outline" className="text-xs">
                  {id}
                </Badge>
              ))}
            </div>
          )}
          {model.entitlement.denialReason && (
            <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {model.entitlement.denialReason}
            </p>
          )}
        </section>

        {model.disabled ? (
          <div
            className="flex items-center gap-3 rounded-md border border-dashed bg-muted/40 p-4 text-sm text-muted-foreground"
            role="status"
          >
            <Ban className="h-4 w-4 shrink-0" />
            <span>{model.disabledReason}</span>
          </div>
        ) : !model.hasWallet ? (
          <div
            className="flex items-center gap-3 rounded-md border border-dashed bg-muted/40 p-4 text-sm text-muted-foreground"
            role="status"
          >
            <Wallet className="h-4 w-4 shrink-0" />
            <span>
              No wallet has been created for this agreement yet. A wallet is provisioned when the
              agreement is created with Time Bank enabled.
            </span>
          </div>
        ) : (
          model.wallet && (
            <>
              <Separator />

              {/* ── Wallet summary ── */}
              <section className="space-y-3" aria-label="Wallet">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant={model.wallet.statusLabel === "Active" ? "default" : "secondary"}
                  >
                    {model.wallet.statusLabel}
                  </Badge>
                  {model.wallet.warningLevel !== "ok" && (
                    <Badge
                      variant={
                        model.wallet.warningLevel === "critical" ? "destructive" : "outline"
                      }
                      className="gap-1"
                    >
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {model.wallet.warningLabel}
                    </Badge>
                  )}
                  {model.wallet.isNegative && (
                    <Badge variant="destructive">Overdrawn</Badge>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <Field
                    label="Available"
                    value={
                      <span className="text-lg font-semibold">{model.wallet.availableLabel}</span>
                    }
                  />
                  <Field label="Current" value={model.wallet.currentLabel} />
                  <Field label="Reserved" value={model.wallet.reservedLabel} />
                </div>
                <Field label="Agreement group" value={model.wallet.agreementGroupId} />
                {onSetWalletStatus && model.wallet.statusLabel !== "Closed" && (
                  <div className="flex gap-2">
                    {model.wallet.statusLabel === "Active" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onSetWalletStatus("frozen")}
                      >
                        <Lock className="mr-1.5 h-3.5 w-3.5" /> Freeze
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onSetWalletStatus("closed")}
                    >
                      <Ban className="mr-1.5 h-3.5 w-3.5" /> Close
                    </Button>
                  </div>
                )}
              </section>

              <Separator />

              {/* ── Rules ── */}
              {model.rules && (
                <section className="space-y-3" aria-label="Rules">
                  <h4 className="text-sm font-semibold">Rules</h4>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                    <Field label="Allocation" value={model.rules.allocationLabel} />
                    <Field label="Refill" value={model.rules.refillFrequency} />
                    <Field label="Carryover" value={model.rules.carryoverPolicy} />
                    {model.rules.maxBalanceLabel && (
                      <Field label="Max balance" value={model.rules.maxBalanceLabel} />
                    )}
                    {model.rules.expiryLabel && (
                      <Field label="Expiry" value={model.rules.expiryLabel} />
                    )}
                    <Field label="Negative floor" value={model.rules.negativeFloorLabel} />
                    {model.rules.warningThresholdLabel && (
                      <Field label="Warn at" value={model.rules.warningThresholdLabel} />
                    )}
                    {model.rules.criticalThresholdLabel && (
                      <Field label="Critical at" value={model.rules.criticalThresholdLabel} />
                    )}
                  </div>
                </section>
              )}

              {/* ── Cancellation policy ── */}
              {model.cancellation && (
                <>
                  <Separator />
                  <section className="space-y-2" aria-label="Cancellation policy">
                    <h4 className="text-sm font-semibold">Cancellation credit</h4>
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                      <Field
                        label="Policy"
                        value={model.cancellation.enabled ? "Enabled" : "Disabled"}
                      />
                      <Field label="Method" value={model.cancellation.methodLabel} />
                      {model.cancellation.deductionDetail && (
                        <Field label="Deduction" value={model.cancellation.deductionDetail} />
                      )}
                      {model.cancellation.minCreditLabel && (
                        <Field label="Min credit" value={model.cancellation.minCreditLabel} />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Cancelled visit credits are posted as one net credit transaction; the full
                      deduction calculation is retained in the audit ledger.
                    </p>
                  </section>
                </>
              )}

              <Separator />

              {/* ── Opening balance ── */}
              <section className="space-y-3" aria-label="Opening balance">
                <h4 className="text-sm font-semibold">Opening balance</h4>
                {model.wallet.openingBalanceMinutes !== null ? (
                  <p className="text-sm text-muted-foreground">
                    An opening balance of{" "}
                    <span className="font-medium text-foreground">
                      {model.ledger.find((r) => r.type === "opening_balance")?.minutesLabel ?? ""}
                    </span>{" "}
                    has been imported. Corrections must use an adjustment transaction.
                  </p>
                ) : model.gates.createOpeningBalance.allowed && onCreateOpeningBalance ? (
                  <div className="space-y-2 rounded-md border p-3">
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="w-20">
                        <Label htmlFor="ob-hours" className="text-xs">
                          Hours
                        </Label>
                        <Input
                          id="ob-hours"
                          inputMode="numeric"
                          value={obHours}
                          onChange={(e) => setObHours(e.target.value)}
                        />
                      </div>
                      <div className="w-20">
                        <Label htmlFor="ob-mins" className="text-xs">
                          Minutes
                        </Label>
                        <Input
                          id="ob-mins"
                          inputMode="numeric"
                          value={obMinutes}
                          onChange={(e) => setObMinutes(e.target.value)}
                        />
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="ob-note" className="text-xs">
                        Note
                      </Label>
                      <Input
                        id="ob-note"
                        value={obNote}
                        onChange={(e) => setObNote(e.target.value)}
                        placeholder="e.g. Carried from legacy system"
                      />
                    </div>
                    <div>
                      <Label htmlFor="ob-source" className="text-xs">
                        Source reference (optional)
                      </Label>
                      <Input
                        id="ob-source"
                        value={obSource}
                        onChange={(e) => setObSource(e.target.value)}
                      />
                    </div>
                    {obError && <p className="text-sm text-destructive">{obError}</p>}
                    <Button size="sm" onClick={submitOpeningBalance}>
                      <PlusCircle className="mr-1.5 h-3.5 w-3.5" /> Add opening balance
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {model.gates.createOpeningBalance.reason ??
                      "Opening balance cannot be added."}
                  </p>
                )}
              </section>

              <Separator />

              {/* ── Manual adjustment ── */}
              {onAddAdjustment && (
                <section className="space-y-3" aria-label="Manual adjustment">
                  <h4 className="text-sm font-semibold">Manual adjustment</h4>
                  {model.gates.addAdjustmentAdd.allowed ? (
                    <div className="space-y-2 rounded-md border p-3">
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant={adjDirection === "manual_add" ? "default" : "outline"}
                          onClick={() => setAdjDirection("manual_add")}
                        >
                          Add
                        </Button>
                        <Button
                          size="sm"
                          variant={adjDirection === "manual_remove" ? "default" : "outline"}
                          onClick={() => setAdjDirection("manual_remove")}
                        >
                          Remove
                        </Button>
                      </div>
                      <div className="flex flex-wrap items-end gap-2">
                        <div className="w-20">
                          <Label htmlFor="adj-hours" className="text-xs">
                            Hours
                          </Label>
                          <Input
                            id="adj-hours"
                            inputMode="numeric"
                            value={adjHours}
                            onChange={(e) => setAdjHours(e.target.value)}
                          />
                        </div>
                        <div className="w-20">
                          <Label htmlFor="adj-mins" className="text-xs">
                            Minutes
                          </Label>
                          <Input
                            id="adj-mins"
                            inputMode="numeric"
                            value={adjMinutes}
                            onChange={(e) => setAdjMinutes(e.target.value)}
                          />
                        </div>
                      </div>
                      <div>
                        <Label htmlFor="adj-reason" className="text-xs">
                          Reason
                        </Label>
                        <Input
                          id="adj-reason"
                          value={adjReason}
                          onChange={(e) => setAdjReason(e.target.value)}
                        />
                      </div>
                      {adjError && <p className="text-sm text-destructive">{adjError}</p>}
                      <Button size="sm" onClick={submitAdjustment}>
                        <PlusCircle className="mr-1.5 h-3.5 w-3.5" /> Record adjustment
                      </Button>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {model.gates.addAdjustmentAdd.reason ?? "Adjustments are not available."}
                    </p>
                  )}
                </section>
              )}

              <Separator />

              {/* ── Legacy history ── */}
              <section className="space-y-3" aria-label="Legacy history">
                <h4 className="flex items-center gap-1.5 text-sm font-semibold">
                  <History className="h-4 w-4" /> Legacy history
                </h4>
                <p className="text-xs text-muted-foreground">
                  Informational only — legacy notes never affect the wallet balance.
                </p>
                {model.legacyNotes.length > 0 && (
                  <ul className="space-y-2">
                    {model.legacyNotes.map((n) => (
                      <li key={n.id} className="rounded-md border bg-muted/30 p-2.5 text-sm">
                        <p className="whitespace-pre-wrap">{n.note}</p>
                        {(n.sourceSystem || n.importedAt) && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {n.sourceSystem ? `${n.sourceSystem} · ` : ""}
                            {n.importedAt ?? ""}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {onAddLegacyNote && (
                  <div className="space-y-2 rounded-md border p-3">
                    <div>
                      <Label htmlFor="note-text" className="text-xs">
                        Note
                      </Label>
                      <Textarea
                        id="note-text"
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                        placeholder="Paste historical Time Bank information…"
                        rows={3}
                      />
                    </div>
                    <div>
                      <Label htmlFor="note-source" className="text-xs">
                        Source system (optional)
                      </Label>
                      <Input
                        id="note-source"
                        value={noteSource}
                        onChange={(e) => setNoteSource(e.target.value)}
                      />
                    </div>
                    {noteError && <p className="text-sm text-destructive">{noteError}</p>}
                    <Button size="sm" variant="outline" onClick={submitLegacyNote}>
                      <PlusCircle className="mr-1.5 h-3.5 w-3.5" /> Add legacy note
                    </Button>
                  </div>
                )}
              </section>

              <Separator />

              {/* ── Ledger ── */}
              <section className="space-y-3" aria-label="Ledger">
                <h4 className="text-sm font-semibold">Ledger</h4>
                {model.ledger.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No transactions yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead className="text-right">Minutes</TableHead>
                          <TableHead>Details</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {model.ledger.map((row) => (
                          <TableRow key={row.id} data-testid={`ledger-row-${row.type}`}>
                            <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                              {row.effectiveAt.slice(0, 10)}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1.5">
                                <span className="text-sm">{row.typeLabel}</span>
                                {row.reserved && (
                                  <Badge variant="outline" className="text-[10px]">
                                    reserved
                                  </Badge>
                                )}
                                {row.billable === true && (
                                  <Badge variant="outline" className="text-[10px]">
                                    billable
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell
                              className={cn(
                                "text-right font-medium tabular-nums",
                                row.minutes < 0 ? "text-destructive" : "text-foreground",
                              )}
                            >
                              {row.minutesLabel}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {row.cancellation ? (
                                <span>
                                  {row.cancellation.originalLabel} visit −{" "}
                                  {row.cancellation.deductionLabel} ({row.cancellation.methodLabel}){" "}
                                  → {row.cancellation.creditedLabel} credited
                                </span>
                              ) : (
                                <>
                                  {row.reason ?? ""}
                                  {row.category ? ` · ${row.category}` : ""}
                                </>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </section>
            </>
          )
        )}
      </CardContent>
    </Card>
  );
}
