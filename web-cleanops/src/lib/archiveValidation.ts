import { DEFAULT_RECURRENCE_INTERVAL } from "@/types";
import type {
  BookingOccurrenceException,
  RecurringVariation,
  WorkOrderServiceRow,
} from "@/types";

/**
 * Archive protection for Work Order service rows.
 *
 * In pre-production/test-data mode, a planned or in-progress status alone does
 * not block a company admin from archiving a service row. Invoice basis and
 * payroll basis generation are not implemented yet, so this module verifies the
 * existing structural preconditions (dates + remaining occurrences) and surfaces
 * a forward-looking warning. The future checks below are declared as explicit
 * extension points so protected execution/financial dependencies can be wired in
 * without reshaping the validation flow or its callers.
 */

/** A future validation gate that is declared but not yet implemented. */
export type PendingArchiveCheck =
  | "invoice_basis_generated"
  | "payroll_basis_generated"
  | "all_occurrences_processed"
  | "no_pending_time_reports"
  | "no_pending_approvals";

/**
 * Future validation gates. Each will eventually resolve to a real boolean
 * check; today they are informational only and drive the archival warning.
 */
export const PENDING_ARCHIVE_CHECKS: { key: PendingArchiveCheck; label: string }[] = [
  { key: "invoice_basis_generated", label: "Invoice basis generated" },
  { key: "payroll_basis_generated", label: "Payroll basis generated" },
  { key: "all_occurrences_processed", label: "All occurrences processed" },
  { key: "no_pending_time_reports", label: "No pending time reports" },
  { key: "no_pending_approvals", label: "No pending approval workflows" },
];

/** Why an archive attempt was blocked. */
export type ArchiveBlockReason = "no_end_date" | "end_date_not_passed";

export interface ArchiveValidationResult {
  /** Whether archival is currently permitted. */
  allowed: boolean;
  /** Stable reason code when {@link allowed} is false. */
  blockedReason?: ArchiveBlockReason;
  /** User-facing explanation of the block (empty when allowed). */
  blockedMessage?: string;
  /** Non-blocking warnings to surface before confirming archival. */
  warnings: string[];
  /** Future validation gates that are declared but not yet enforced. */
  pendingChecks: PendingArchiveCheck[];
}

/** Message shown when a recurring service has no end date. */
export const ARCHIVE_BLOCKED_NO_END_DATE_MESSAGE =
  "This recurring service has no end date and cannot be archived.";

/** Message shown when the service end date has not yet passed. */
export const ARCHIVE_BLOCKED_END_DATE_NOT_PASSED_MESSAGE =
  "This service has future occurrences and cannot be archived yet.";

/**
 * Forward-looking warning shown when a service is eligible for archival today
 * but the invoice/payroll validation that will eventually gate it does not yet
 * exist.
 */
export const ARCHIVE_PENDING_VALIDATION_WARNING =
  "Invoice basis and payroll basis validation are not implemented yet. Future versions of the system will verify that all invoice and payroll data has been generated before allowing archival.";

/** Parses an ISO date ("YYYY-MM-DD") into a local Date at midnight. */
function parseIsoDate(iso: string): Date | null {
  const slice = iso.slice(0, 10);
  const [y, m, d] = slice.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

/** Local "today" at midnight, used as the comparison anchor. */
function startOfToday(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function isRecurring(row: WorkOrderServiceRow): boolean {
  return (row.recurrenceInterval ?? DEFAULT_RECURRENCE_INTERVAL) !== "one_time";
}

/**
 * The effective end date that bounds the service's future work. Recurring
 * services are bounded by their inclusive end date; one-time services by their
 * single service date. Returns null when no bounding date is configured (e.g. a
 * recurring service with no end date, which keeps generating occurrences).
 */
export function getServiceEndDate(row: WorkOrderServiceRow): Date | null {
  const explicit = row.serviceEndDate?.trim();
  const iso = explicit ? row.serviceEndDate : isRecurring(row) ? null : row.serviceDate;
  if (!iso?.trim()) return null;
  return parseIsoDate(iso);
}

/**
 * Whether the service has ended (its bounding end date is strictly in the past).
 * A service with no bounding end date never ends on its own — it keeps
 * generating future occurrences.
 */
export function hasServiceEnded(row: WorkOrderServiceRow, now: Date = new Date()): boolean {
  const end = getServiceEndDate(row);
  if (!end) return false;
  return end < startOfToday(now);
}

/**
 * Whether the service is currently live. This lifecycle signal is still used by
 * delete protection and status labeling, but it is not an archive blocker by
 * itself in pre-production/test-data mode.
 */
export function isServiceRowActive(row: WorkOrderServiceRow): boolean {
  return row.status === "planned" || row.status === "in_progress";
}

const ALL_PENDING_CHECKS = PENDING_ARCHIVE_CHECKS.map((c) => c.key);

function blocked(
  reason: ArchiveBlockReason,
  message: string,
): ArchiveValidationResult {
  return {
    allowed: false,
    blockedReason: reason,
    blockedMessage: message,
    warnings: [],
    pendingChecks: ALL_PENDING_CHECKS,
  };
}

/**
 * Validates whether a Work Order service row may be archived.
 *
 * Archival is blocked when either of the following is true (checked in order):
 * 1. The service has no end date (future occurrences cannot be bounded).
 * 2. The service end date has not yet passed (future occurrences may remain).
 *
 * A planned/in_progress status alone is intentionally not a blocker here. When
 * the structural conditions clear, archival is allowed but carries the pending
 * invoice/payroll validation warning until protected dependency checks exist.
 *
 * Restores are never gated.
 */
export function validateServiceRowArchive(
  row: WorkOrderServiceRow,
  now: Date = new Date(),
): ArchiveValidationResult {
  if (!getServiceEndDate(row)) {
    return blocked("no_end_date", ARCHIVE_BLOCKED_NO_END_DATE_MESSAGE);
  }

  if (!hasServiceEnded(row, now)) {
    return blocked("end_date_not_passed", ARCHIVE_BLOCKED_END_DATE_NOT_PASSED_MESSAGE);
  }

  return {
    allowed: true,
    warnings: [ARCHIVE_PENDING_VALIDATION_WARNING],
    pendingChecks: ALL_PENDING_CHECKS,
  };
}

/**
 * The date an occurrence exception effectively lands on: its override date when
 * the occurrence was rescheduled, otherwise the rule-derived occurrence date.
 */
export function getOccurrenceExceptionEffectiveDate(
  exception: BookingOccurrenceException,
): string {
  return exception.overrideOccurrenceDate?.trim() || exception.occurrenceDate;
}

/**
 * Whether an occurrence exception represents real operational history — i.e. it
 * touches an occurrence whose original or moved-to date is strictly before
 * today. Future-only exceptions (e.g. a reschedule/cancel created while testing
 * a service that hasn't started yet) are NOT history and must never block
 * deletion of a not-yet-started service.
 */
export function isOccurrenceExceptionOperational(
  exception: BookingOccurrenceException,
  now: Date = new Date(),
): boolean {
  const today = startOfToday(now);
  const original = parseIsoDate(exception.occurrenceDate);
  if (original && original < today) return true;
  const overrideIso = exception.overrideOccurrenceDate?.trim();
  const override = overrideIso ? parseIsoDate(overrideIso) : null;
  if (override && override < today) return true;
  return false;
}

/**
 * Why deleting a service row was blocked. Deletion/removal is permitted for rows
 * with no protected operational or financial history. A non-empty list means the
 * row must be preserved instead of removed.
 */
export type DeleteBlockFactor =
  | "service_completed"
  | "has_time_reports"
  | "has_occurrence_exceptions";

/**
 * History signals that cannot be derived from the row alone. The caller resolves
 * these from the surrounding stores (time reports, occurrence exceptions) and
 * passes them in, keeping this validator pure.
 */
export interface ServiceRowDeleteContext {
  /** Whether any time report references this service row. */
  hasTimeReports: boolean;
  /**
   * Whether any *operational* booking occurrence exception references this
   * service row — i.e. an exception touching a past occurrence (see
   * {@link isOccurrenceExceptionOperational}). Future-only exceptions are not
   * history and should not be passed as `true` here.
   */
  hasOccurrenceExceptions: boolean;
  /** Comparison anchor for "has an occurrence passed"; defaults to now. */
  now?: Date;
}

export interface DeleteValidationResult {
  /** Whether a hard delete is currently permitted. */
  allowed: boolean;
  /** Stable factor codes that block deletion (empty when allowed). */
  blockingFactors: DeleteBlockFactor[];
  /** Human-readable reasons, aligned 1:1 with {@link blockingFactors}. */
  reasons: string[];
  /** Single summary message shown when deletion is blocked. */
  blockedMessage?: string;
}

/** Human-readable explanation for each delete block factor. */
export const DELETE_BLOCK_FACTOR_LABELS: Record<DeleteBlockFactor, string> = {
  service_completed: "This service has been completed or performed.",
  has_time_reports: "This service has time reports.",
  has_occurrence_exceptions:
    "This service has booking exceptions that must be preserved.",
};

/** Message shown when a service has protected history and must be preserved. */
export const DELETE_BLOCKED_MESSAGE =
  "This service has protected operational or financial history and cannot be deleted. Archive it instead to preserve the record.";

/**
 * Validates whether a Work Order service row may be permanently deleted.
 *
 * Deletion/removal is blocked only by protected operational or financial history
 * that must remain traceable. A planned/in-progress status, a past planned date,
 * assignment, or planned variation is not protected history by itself in the
 * current pre-production/test-data operating mode.
 *
 * The caller resolves external history signals (time reports and operational
 * occurrence exceptions) before calling this pure validator. Supabase-side remove
 * RPCs also enforce durable protected-history checks before mutating data.
 */
export function validateServiceRowDelete(
  row: WorkOrderServiceRow,
  context: ServiceRowDeleteContext,
): DeleteValidationResult {
  const factors: DeleteBlockFactor[] = [];

  if (row.status === "completed") {
    factors.push("service_completed");
  }
  if (context.hasTimeReports) {
    factors.push("has_time_reports");
  }
  if (context.hasOccurrenceExceptions) {
    factors.push("has_occurrence_exceptions");
  }

  const allowed = factors.length === 0;
  return {
    allowed,
    blockingFactors: factors,
    reasons: factors.map((f) => DELETE_BLOCK_FACTOR_LABELS[f]),
    blockedMessage: allowed ? undefined : DELETE_BLOCKED_MESSAGE,
  };
}

/**
 * Why a Force Delete of a mistaken service row was blocked. Force delete is the
 * emergency cleanup path for a service created with the wrong start date (e.g.
 * 2026-01-01 instead of 2026-06-01) that has generated historical occurrences
 * but has NOT yet produced any financial or locked operational data. Any factor
 * below means real money/history is attached and the row must be archived
 * instead, never force-deleted.
 */
export type ForceDeleteBlockFactor =
  | "has_payroll_basis"
  | "has_invoice_basis"
  | "has_completed_time_reports"
  | "has_locked_history"
  | "has_exported_payroll"
  | "has_exported_invoice";

/**
 * Financial/operational dependency signals for {@link validateServiceRowForceDelete}.
 * All are resolved by the caller from the surrounding stores so the validator
 * stays pure. Several gates (payroll/invoice basis + exports) are future
 * extension points and resolve to `false` until those modules exist; completed
 * time reports are enforced today.
 */
export interface ServiceRowForceDeleteContext {
  /** A payroll basis has been generated for this row. */
  hasPayrollBasis: boolean;
  /** An invoice basis has been generated for this row. */
  hasInvoiceBasis: boolean;
  /** Any completed/checked-out time report references this row. */
  hasCompletedTimeReports: boolean;
  /** Any locked operational record references this row. */
  hasLockedHistory: boolean;
  /** Payroll data for this row has already been exported. */
  hasExportedPayroll: boolean;
  /** Invoice data for this row has already been exported. */
  hasExportedInvoice: boolean;
}

export interface ForceDeleteValidationResult {
  /** Whether a force delete is currently permitted. */
  allowed: boolean;
  /** Stable factor codes that block force deletion (empty when allowed). */
  blockingFactors: ForceDeleteBlockFactor[];
  /** Human-readable reasons, aligned 1:1 with {@link blockingFactors}. */
  reasons: string[];
  /** Single summary message shown when force deletion is blocked. */
  blockedMessage?: string;
}

/** Human-readable explanation for each force-delete block factor. */
export const FORCE_DELETE_BLOCK_FACTOR_LABELS: Record<ForceDeleteBlockFactor, string> = {
  has_payroll_basis: "A payroll basis has been generated for this service.",
  has_invoice_basis: "An invoice basis has been generated for this service.",
  has_completed_time_reports: "This service has completed time reports.",
  has_locked_history: "This service has locked operational history.",
  has_exported_payroll: "Payroll data for this service has already been exported.",
  has_exported_invoice: "Invoice data for this service has already been exported.",
};

/** Message shown when a service has financial history and must be archived. */
export const FORCE_DELETE_BLOCKED_MESSAGE =
  "This service has financial or locked operational history that must be preserved. Archive it instead.";

/** The exact word a user must type to confirm a destructive force delete. */
export const FORCE_DELETE_CONFIRMATION_WORD = "delete";

/**
 * Whether a typed confirmation matches the required {@link FORCE_DELETE_CONFIRMATION_WORD}.
 * Case-insensitive and whitespace-trimmed, so "delete", "DELETE" and "Delete"
 * all pass while any other value fails.
 */
export function isForceDeleteConfirmed(input: string): boolean {
  return input.trim().toLowerCase() === FORCE_DELETE_CONFIRMATION_WORD;
}

/**
 * Validates whether a mistaken Work Order service row may be permanently
 * force-deleted.
 *
 * Force delete is a separate, more destructive path than {@link
 * validateServiceRowDelete}: it deliberately tolerates historical *generated*
 * occurrences (the whole reason it exists), but is blocked the moment any
 * financial or locked operational data is attached. It is blocked when ANY of:
 * 1. A payroll basis exists.
 * 2. An invoice basis exists.
 * 3. A completed time report exists.
 * 4. Locked operational history exists.
 * 5. Payroll data has been exported.
 * 6. Invoice data has been exported.
 *
 * When blocked, the row must be archived instead so the financial record is
 * preserved.
 */
export function validateServiceRowForceDelete(
  context: ServiceRowForceDeleteContext,
): ForceDeleteValidationResult {
  const factors: ForceDeleteBlockFactor[] = [];
  if (context.hasPayrollBasis) factors.push("has_payroll_basis");
  if (context.hasInvoiceBasis) factors.push("has_invoice_basis");
  if (context.hasCompletedTimeReports) factors.push("has_completed_time_reports");
  if (context.hasLockedHistory) factors.push("has_locked_history");
  if (context.hasExportedPayroll) factors.push("has_exported_payroll");
  if (context.hasExportedInvoice) factors.push("has_exported_invoice");
  const allowed = factors.length === 0;
  return {
    allowed,
    blockingFactors: factors,
    reasons: factors.map((f) => FORCE_DELETE_BLOCK_FACTOR_LABELS[f]),
    blockedMessage: allowed ? undefined : FORCE_DELETE_BLOCKED_MESSAGE,
  };
}

/**
 * Why deleting a recurring variation was blocked. Hard delete is only for a
 * mistaken, freshly-created variation with no historical impact; any factor
 * below forces the user to Stop (archive with a cutoff) instead so past
 * bookings the variation already modified stay traceable.
 */
export type VariationDeleteBlockFactor =
  | "applied_in_past"
  | "in_replace_chain";

/**
 * History signals about a variation that cannot be derived from the variation
 * object alone. {@link appliedInPast} is resolved by the caller from the series'
 * occurrences (e.g. via {@link import("./serviceRowOccurrences").variationHasPastOccurrence}),
 * keeping this validator pure.
 */
export interface VariationDeleteContext {
  /** Whether the variation already applied to an occurrence strictly before today. */
  appliedInPast: boolean;
}

export interface VariationDeleteValidationResult {
  /** Whether a hard delete is currently permitted. */
  allowed: boolean;
  /** Stable factor codes that block deletion (empty when allowed). */
  blockingFactors: VariationDeleteBlockFactor[];
  /** Human-readable reasons, aligned 1:1 with {@link blockingFactors}. */
  reasons: string[];
  /** Single summary message shown when deletion is blocked. */
  blockedMessage?: string;
}

/** Human-readable explanation for each variation delete block factor. */
export const VARIATION_DELETE_BLOCK_FACTOR_LABELS: Record<
  VariationDeleteBlockFactor,
  string
> = {
  applied_in_past: "This variation has already applied to past bookings.",
  in_replace_chain:
    "This variation is part of a replacement history that must be preserved.",
};

/** Message shown when a variation has history and must be stopped, not deleted. */
export const VARIATION_DELETE_BLOCKED_MESSAGE =
  "This variation has history and cannot be deleted. Stop it instead to keep past bookings traceable while preventing it from applying to future bookings.";

/**
 * Validates whether a recurring variation may be permanently deleted.
 *
 * Deletion exists only to remove a mistaken, newly-created variation before it
 * gains any historical impact. It is blocked when EITHER:
 * 1. The variation already applied to a past occurrence ({@link
 *    VariationDeleteContext.appliedInPast}).
 * 2. The variation participates in a replacement chain (it replaced another
 *    variation, or was itself replaced) — that history must be preserved.
 *
 * When blocked, the variation must be Stopped instead (bounded with an
 * `appliesUntil` cutoff and kept), which preserves every past occurrence it
 * modified while preventing it from applying to future occurrences.
 */
export function validateVariationDelete(
  variation: RecurringVariation,
  context: VariationDeleteContext,
): VariationDeleteValidationResult {
  const factors: VariationDeleteBlockFactor[] = [];
  if (context.appliedInPast) {
    factors.push("applied_in_past");
  }
  if (
    variation.replacesVariationId ||
    variation.replacedByVariationId ||
    variation.replacedAt
  ) {
    factors.push("in_replace_chain");
  }
  const allowed = factors.length === 0;
  return {
    allowed,
    blockingFactors: factors,
    reasons: factors.map((f) => VARIATION_DELETE_BLOCK_FACTOR_LABELS[f]),
    blockedMessage: allowed ? undefined : VARIATION_DELETE_BLOCKED_MESSAGE,
  };
}

/**
 * The lifecycle stage of a Work Order service (AO), derived from its status,
 * dates and archive flag. The Work Order service is the source of truth for the
 * lifecycle:
 *
 *   active → ended → archive_upcoming → archived
 *
 * - `active`: status is planned/in_progress; future occurrences may still be
 *   generated.
 * - `ended`: no longer active, but not yet eligible for archival (e.g. recurring
 *   with no end date, or the end date hasn't passed).
 * - `archive_upcoming`: eligible for archival and visible for a configurable
 *   retention period before the future auto-archive process archives it.
 * - `archived`: fully archived (hidden by default, recoverable).
 */
export type ServiceLifecycleStage =
  | "active"
  | "ended"
  | "archive_upcoming"
  | "archived";

/** Human-readable labels for each lifecycle stage. */
export const SERVICE_LIFECYCLE_STAGE_LABELS: Record<ServiceLifecycleStage, string> = {
  active: "Active",
  ended: "Ended",
  archive_upcoming: "Archive Upcoming",
  archived: "Archived",
};

/**
 * Derives the current lifecycle stage for a service row. Archival eligibility
 * reuses {@link validateServiceRowArchive} so the lifecycle and archive
 * protection rules can never drift apart.
 */
export function deriveServiceLifecycleStage(
  row: WorkOrderServiceRow,
  now: Date = new Date(),
): ServiceLifecycleStage {
  if (row.archived) return "archived";
  if (isServiceRowActive(row)) return "active";
  return validateServiceRowArchive(row, now).allowed ? "archive_upcoming" : "ended";
}

/**
 * The date a service entered the Archive Upcoming stage (became eligible for
 * archival), which equals its effective end date. Returns null unless the
 * service is currently in Archive Upcoming. Future extension point for the
 * automatic archival process.
 */
export function getArchiveUpcomingSince(
  row: WorkOrderServiceRow,
  now: Date = new Date(),
): Date | null {
  if (deriveServiceLifecycleStage(row, now) !== "archive_upcoming") return null;
  return getServiceEndDate(row);
}

/**
 * The date the future auto-archive process would archive a service, given the
 * configured Auto Archive Delay (in days). Returns null when the delay is
 * disabled (`null`) or the service is not currently in Archive Upcoming. Pure
 * derivation — nothing is archived automatically yet.
 */
export function getAutoArchiveDate(
  row: WorkOrderServiceRow,
  delayDays: number | null,
  now: Date = new Date(),
): Date | null {
  if (delayDays == null) return null;
  const since = getArchiveUpcomingSince(row, now);
  if (!since) return null;
  const due = new Date(since);
  due.setDate(due.getDate() + delayDays);
  return due;
}
