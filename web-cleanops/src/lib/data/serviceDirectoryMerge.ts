/**
 * Service-catalog mirror-window merge (SVC consistency fix).
 *
 * Under the Supabase-authoritative service read path
 * ({@link import("./serviceCutover").shouldReadServicesFromSupabase}) the
 * Settings → Services catalog renders the Supabase snapshot. Writes, however,
 * run localStorage-first with a fire-and-forget Supabase mirror. That opens the
 * same dual-write race the detail bridge solves, but for a COLLECTION:
 *
 *   1. The user creates a service. localStorage gets the new row synchronously
 *      and the mirror INSERT is dispatched in the background.
 *   2. The directory read returns the PRE-write Supabase snapshot (the mirror
 *      has not committed yet) — the brand-new service is absent.
 *   3. Blindly serving the remote snapshot ({@code setServices(remote)}) drops
 *      the just-created service from the UI until the mirror commits and a later
 *      scope-change refetch happens (typically only on reload).
 *
 * This merge keeps the remote catalog authoritative while bridging that window:
 *   • Remote rows win by default (Supabase is the target authority).
 *   • A local copy of the SAME id that is strictly newer than the remote row is
 *     preferred (a just-edited service not yet committed).
 *   • A LOCAL-ONLY row (absent from remote) is preserved ONLY while it is inside
 *     the mirror window — i.e. it was written locally within {@link DEFAULT_MIRROR_WINDOW_MS}.
 *     This shows a freshly-created service immediately, yet never permanently
 *     resurrects a service deleted on another client (its stale `updatedAt`
 *     falls outside the window, so it is not re-added).
 *
 * Pure and synchronous — no fetches, timers, or state. Computed at render time
 * against the latest local array so a new local service appears instantly.
 */

import type { Service } from "@/types";
import { isLocalRecordFresher } from "./detailMirrorWindow";

/**
 * How long a local-only service is preserved over a remote snapshot that does
 * not (yet) contain it. Generously larger than a typical mirror commit (sub-second
 * to a few seconds) while small enough that a row deleted elsewhere is not kept
 * indefinitely. Ten minutes.
 */
export const DEFAULT_MIRROR_WINDOW_MS = 10 * 60 * 1000;

/** Parses an ISO timestamp to epoch ms, or null when missing/unparseable. */
function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/** True when `updatedAt` falls within `windowMs` of `nowMs` (recently written). */
function isWithinMirrorWindow(
  updatedAt: string | null | undefined,
  nowMs: number,
  windowMs: number,
): boolean {
  const t = parseTime(updatedAt);
  if (t === null) return false;
  return nowMs - t <= windowMs;
}

/**
 * Merges the authoritative remote service catalog with the local array,
 * bridging the dual-write mirror window so a just-created/edited local service
 * is not lost while the Supabase mirror is still committing.
 *
 * @param remote   The Supabase snapshot (authoritative target).
 * @param local    The localStorage services (backout copy + mirror window).
 * @param nowMs    Current epoch ms (injectable for tests). Defaults to now.
 * @param windowMs Mirror-window size in ms. Defaults to {@link DEFAULT_MIRROR_WINDOW_MS}.
 */
export function mergeServiceDirectory(
  remote: Service[],
  local: Service[],
  nowMs: number = Date.now(),
  windowMs: number = DEFAULT_MIRROR_WINDOW_MS,
): Service[] {
  const localById = new Map<string, Service>(local.map((s) => [s.id, s]));
  const remoteIds = new Set<string>(remote.map((s) => s.id));

  // Remote rows win, unless a strictly-newer local edit is pending its mirror.
  const merged: Service[] = remote.map((r) => {
    const l = localById.get(r.id);
    if (l && isLocalRecordFresher(l, r)) return l;
    return r;
  });

  // Preserve local-only rows that are still inside the mirror window (a freshly
  // created service not yet visible in the remote snapshot). Prepended so a new
  // service surfaces at the top, matching the optimistic-append pattern used by
  // the list read surfaces.
  const localOnlyFresh: Service[] = [];
  for (const l of local) {
    if (!remoteIds.has(l.id) && isWithinMirrorWindow(l.updatedAt, nowMs, windowMs)) {
      localOnlyFresh.push(l);
    }
  }

  return localOnlyFresh.length > 0 ? [...localOnlyFresh, ...merged] : merged;
}
