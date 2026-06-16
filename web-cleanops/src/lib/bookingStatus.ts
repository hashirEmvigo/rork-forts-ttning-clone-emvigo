import { buildRescheduleMessage } from "./rescheduleMessaging";
import type { PreferredTimeEvaluationResult } from "./evaluatePreferredTime";

/**
 * Single source of truth for a booking's two independent status layers, so the
 * Booking Queue, Schedule, Mobile App, Customer Portal and Booking Details all
 * describe a booking identically instead of each re-deriving copy/colours.
 *
 * The two layers are intentionally separate concepts and are NEVER mixed:
 * - Operational status — what happened to the booking (cancelled, rebooked,
 *   variation, scheduled, unscheduled). Exactly one applies, by priority.
 * - Confirmation status — whether the booking matches the customer's approved
 *   scheduling preferences (auto-confirmed / needs confirmation). Optional;
 *   absent when there are no preferences or the feature is off.
 *
 * Both resolvers are pure and framework-agnostic. They emit an `icon` *key*
 * (string) rather than a component so each platform can map it to its own icon
 * set (lucide-react on web, lucide-react-native on mobile).
 */

// ── Operational status ────────────────────────────────────

/** The mutually-exclusive operational states, highest priority first. */
export type BookingOperationalStatus =
  | "cancelled"
  | "rebooked"
  | "variation"
  | "scheduled"
  | "unscheduled";

/** Semantic colour token for a status badge; mapped to classes by the UI. */
export type BookingStatusColor = "red" | "blue" | "violet" | "green" | "neutral" | "orange";

/** Platform-agnostic icon key; the UI maps this to a concrete icon. */
export type BookingStatusIcon =
  | "cancelled"
  | "rebooked"
  | "variation"
  | "scheduled"
  | "unscheduled"
  | "changed"
  | "auto-confirmed"
  | "needs-confirmation";

export interface OperationalStatusBadge {
  status: BookingOperationalStatus;
  label: string;
  color: BookingStatusColor;
  icon: BookingStatusIcon;
  /** Multi-line tooltip; only present for rebooked today. */
  tooltip?: string;
}

/** A reschedule, sourced from the occurrence exception or legacy booking move. */
export interface OperationalRescheduleInput {
  /** Original (rule-derived) date — ISO timestamp or "YYYY-MM-DD". */
  originalDate: string;
  /** New date the occurrence moved to — ISO timestamp or "YYYY-MM-DD". */
  newDate: string;
  /** One-time occurrence move (true) vs series-level anchor move (false). */
  oneTime: boolean;
}

export interface OperationalStatusInput {
  /** This occurrence is cancelled (wins over everything else). */
  isCancelled: boolean;
  /**
   * The reschedule that moved this occurrence, or null. Derived from the
   * authoritative {@link BookingOccurrenceException} / booking reschedule —
   * never inferred from display dates. Treated as "rebooked" only when the
   * dates actually differ.
   */
  reschedule: OperationalRescheduleInput | null;
  /** A recurring variation resolved onto this occurrence. */
  isVariation: boolean;
  /** The booking has a concrete schedule slot (Schedule module). */
  isScheduled: boolean;
}

/**
 * Resolves the single operational status for a booking using the fixed priority
 * order: cancelled → rebooked → variation → scheduled → unscheduled. Pure.
 */
export function resolveBookingOperationalStatus(
  input: OperationalStatusInput,
): OperationalStatusBadge {
  if (input.isCancelled) {
    return { status: "cancelled", label: "Cancelled", color: "red", icon: "cancelled" };
  }

  if (input.reschedule) {
    const msg = buildRescheduleMessage({
      scope: input.reschedule.oneTime ? "occurrence" : "series",
      originalDate: input.reschedule.originalDate,
      newDate: input.reschedule.newDate,
    });
    // Only a real day change counts as rebooked — never show "X → X".
    if (msg.changed) {
      const tooltip = [
        "Rescheduled from:",
        msg.originalDate,
        "",
        "To:",
        msg.newDate,
        "",
        `${msg.detailLines.join(".\n")}.`,
      ].join("\n");
      return { status: "rebooked", label: "Rebooked", color: "blue", icon: "rebooked", tooltip };
    }
  }

  if (input.isVariation) {
    return { status: "variation", label: "Variation", color: "violet", icon: "variation" };
  }

  if (input.isScheduled) {
    return { status: "scheduled", label: "Scheduled", color: "green", icon: "scheduled" };
  }

  return { status: "unscheduled", label: "Unscheduled", color: "neutral", icon: "unscheduled" };
}

// ── Confirmation status ───────────────────────────────────

/** Whether the booking matches the customer's approved preferences. */
export type BookingConfirmationStatus = "auto_confirmed" | "needs_confirmation";

export interface ConfirmationStatusBadge {
  status: BookingConfirmationStatus;
  label: string;
  color: BookingStatusColor;
  icon: BookingStatusIcon;
  tooltip: string;
}

/**
 * Resolves the optional confirmation status from a Preferred Time Evaluation
 * result. Returns null when no badge should be shown:
 * - `none` — the customer has no preferences (or the feature is off),
 * - `not_evaluated` — the time couldn't be classified.
 *
 * `optimal`/`acceptable` → auto-confirmed (green); `outside_range` → needs
 * confirmation (orange). This is display-only — it never blocks, notifies or
 * triggers a customer-approval workflow. Pure.
 */
export function resolveBookingConfirmationStatus(
  result: PreferredTimeEvaluationResult | null | undefined,
): ConfirmationStatusBadge | null {
  if (!result) return null;

  if (result.status === "optimal" || result.status === "acceptable") {
    return {
      status: "auto_confirmed",
      label: "Auto",
      color: "green",
      icon: "auto-confirmed",
      tooltip: "Within customer's approved scheduling preferences.",
    };
  }

  if (result.status === "outside_range") {
    return {
      status: "needs_confirmation",
      label: "Pending",
      color: "orange",
      icon: "needs-confirmation",
      tooltip:
        "Outside customer's approved scheduling preferences.\nCustomer confirmation required.",
    };
  }

  return null;
}

// ── Modifiers (additional operational information) ──────────

/**
 * Modifiers are the second dimension of a booking's status, layered on top of
 * the single operational status (the "cause"). A booking may carry zero or more.
 * Unlike the operational status, modifiers are additive and describe *additional*
 * operational facts a scheduler should know.
 *
 * Phase 1 supports three values. The type is deliberately a closed union so new
 * modifiers (e.g. employee/duration/team changes) slot in without restructuring.
 */
export type BookingModifier = "changed" | "auto_confirmed" | "needs_confirmation";

export interface BookingModifierBadge {
  modifier: BookingModifier;
  label: string;
  color: BookingStatusColor;
  icon: BookingStatusIcon;
  tooltip?: string;
}

export interface BookingModifierInput {
  /**
   * The occurrence is cancelled. Cancelled is dominant and suppresses every
   * modifier — there is nothing to confirm or flag on a cancelled booking.
   */
  isCancelled: boolean;
  /**
   * A manual time override exists on this occurrence (a different planned time
   * applied through the occurrence exception). Phase 1 definition of "Changed".
   * Must come from the same source as {@link buildOccurrenceChangeMessage}'s
   * `timeChanged` so the chip and the change-information copy never diverge.
   */
  isTimeChanged: boolean;
  /**
   * The Preferred Time Evaluation result, or null when the customer has no
   * preferences / the feature is off. Reused to derive the confirmation
   * modifiers without duplicating the classification logic.
   */
  confirmation?: PreferredTimeEvaluationResult | null;
}

/**
 * Resolves the ordered list of modifiers for a booking. Recommended display
 * order: Changed first, then the confirmation modifier (Auto / Pending).
 * Returns an empty list for cancelled bookings. Pure — safe during render.
 */
export function resolveBookingModifiers(input: BookingModifierInput): BookingModifierBadge[] {
  if (input.isCancelled) return [];

  const modifiers: BookingModifierBadge[] = [];

  if (input.isTimeChanged) {
    modifiers.push({
      modifier: "changed",
      label: "Changed",
      color: "neutral",
      icon: "changed",
      tooltip: "This booking's time was manually changed from the generated occurrence.",
    });
  }

  // Reuse the confirmation resolver so the classification lives in one place.
  const confirmation = resolveBookingConfirmationStatus(input.confirmation);
  if (confirmation) {
    modifiers.push({
      modifier: confirmation.status,
      label: confirmation.label,
      color: confirmation.color,
      icon: confirmation.icon,
      tooltip: confirmation.tooltip,
    });
  }

  return modifiers;
}
