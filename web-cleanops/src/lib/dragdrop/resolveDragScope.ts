/**
 * Scope resolution — decides how far a {@link DragAction} reaches and whether
 * the UI should prompt the dispatcher to choose. Pure.
 *
 * EMPLOYEE deltas keep Phase 2 behaviour:
 *  - One-time booking → always `series`, never prompt (one occurrence IS the
 *    row, so there's no scope ambiguity).
 *  - Recurring booking → locked to `occurrence` (writes a per-occurrence
 *    exception; the series stays untouched). `from_here_forward` / `series` are
 *    intentionally NOT offered yet — they need the variation writer (later
 *    phase), so they're left out of `allowedScopes` and `prompt` stays false.
 *
 * DATE/TIME deltas (Phase 3A onward) ALWAYS persist as a per-occurrence
 * reschedule exception — the reschedule writer overlays just this occurrence for
 * BOTH one-time and recurring bookings — so the writable scope is `occurrence`
 * regardless. For recurring date moves `prompt` is true so the UI can show the
 * scope-selector shell ("Only this occurrence" enabled; "From this date forward"
 * / "Entire work order" disabled until their writers land); only `occurrence` is
 * ever in `allowedScopes` because it's the only scope that can be written today.
 */
import type { DragAction, DragScopeResolution } from "./dragTypes";

/**
 * Maps an action to the scope it writes at. One-time bookings collapse to the
 * service row; recurring drags are pinned to the single occurrence for now.
 */
export function resolveDragScope(action: DragAction): DragScopeResolution {
  const hasSchedule = Boolean(action.deltas.date || action.deltas.time);
  const hasEmployee = Boolean(action.deltas.employee);

  // Date/time move (no employee change): per-occurrence reschedule exception for
  // both one-time and recurring. Recurring prompts the scope-selector shell.
  if (hasSchedule && !hasEmployee) {
    return {
      scope: "occurrence",
      prompt: action.isRecurring,
      allowedScopes: ["occurrence"],
    };
  }

  if (!action.isRecurring) {
    // A one-time occurrence is the whole row — no ambiguity, no prompt.
    return { scope: "series", prompt: false, allowedScopes: ["series"] };
  }
  // Recurring: safe default is occurrence-only. Wider scopes ship in Phase 4.
  return { scope: "occurrence", prompt: false, allowedScopes: ["occurrence"] };
}
