/**
 * Mirror-window bridge for single-entity DETAIL reads (shared, reusable).
 *
 * Under an authoritative Supabase read path (e.g.
 * {@link import("../featureFlags").WORK_ORDERS_SUPABASE_AUTHORITATIVE} /
 * {@link import("../featureFlags").CUSTOMERS_SUPABASE_AUTHORITATIVE}) a detail
 * page renders the Supabase snapshot as primary. Writes, however, run
 * localStorage-first with a fire-and-forget Supabase mirror. That opens a race:
 *
 *   1. The user edits a child collection (e.g. adds a work-order service row).
 *   2. localStorage is updated synchronously and the parent record's `updatedAt`
 *      is bumped; the mirror UPDATE is dispatched in the background.
 *   3. The detail read re-fetches because its local dependency changed — but that
 *      read frequently wins the race against the mirror COMMIT and returns the
 *      PRE-write snapshot (missing the new row / still showing a deleted one).
 *   4. With no bridge, the page shows that stale remote snapshot until a later
 *      read happens after the commit (typically only on manual reload).
 *
 * This is the same class of bug fixed for the Customer LIST via optimistic
 * append + tombstones. For a single DETAIL record the correct, minimal bridge is
 * "prefer the locally-written record while it is strictly newer than the remote
 * snapshot" — because every mutation bumps the parent `updatedAt`, the local copy
 * is provably ahead of a stale remote until the mirror commits and a fresh read
 * returns an equal/newer remote, at which point both converge on remote.
 *
 * Safety properties:
 *   • Never hides genuinely newer remote data — a remote edited by another client
 *     (newer `updatedAt`) still wins, so cross-client updates are not masked.
 *   • Never resurrects access-denied / deleted records — this only chooses
 *     between a local and a remote copy of the SAME record the caller already
 *     resolved; access gating and list-level tombstones are unchanged.
 *   • Pure and synchronous — no extra fetches, timers, or state.
 */

/** Carries the monotonically-increasing ISO timestamp the bridge compares on. */
export interface MirrorWindowRecord {
  /** ISO-8601 last-modified stamp. Bumped on every write to the record. */
  updatedAt?: string | null;
}

/** Which copy the bridge selected, for accurate telemetry / source labelling. */
export type DetailMirrorSource = "local" | "supabase";

export interface DetailMirrorResolution<T> {
  /** The record the detail page should render. */
  record: T | null;
  /** The copy actually backing `record`. */
  source: DetailMirrorSource;
}

/**
 * True when `local` is strictly newer than `remote` by ISO `updatedAt`.
 *
 * Conservative on missing/unparseable data: a local copy with no usable stamp is
 * NOT considered fresher (the authoritative remote keeps priority), so the bridge
 * can never override remote based on absent metadata. A present, parseable local
 * stamp beats a remote with a missing/unparseable one (a freshly written local
 * record should win the window).
 */
export function isLocalRecordFresher(
  local: MirrorWindowRecord | null | undefined,
  remote: MirrorWindowRecord | null | undefined,
): boolean {
  const localTime = parseTime(local?.updatedAt);
  if (localTime === null) return false;
  const remoteTime = parseTime(remote?.updatedAt);
  if (remoteTime === null) return true;
  return localTime > remoteTime;
}

/**
 * Resolves which copy of a single DETAIL record to render, bridging the
 * dual-write mirror window.
 *
 * @param enabled Whether the Supabase-primary read path is active. When false,
 *                the local copy is always returned (zero behaviour change).
 * @param local   The localStorage record (already access-checked by the caller).
 * @param remote  The Supabase snapshot, or null when not enabled / not migrated /
 *                read failed (caller falls back to local).
 */
export function resolveDetailMirrorWindow<T extends MirrorWindowRecord>(
  enabled: boolean,
  local: T | null | undefined,
  remote: T | null,
): DetailMirrorResolution<T> {
  if (enabled && remote !== null) {
    // Bridge the mirror window: a just-written local copy that is newer than the
    // remote snapshot is shown until the mirror commits and a fresh read catches
    // up. Otherwise the authoritative remote stays primary.
    if (local && isLocalRecordFresher(local, remote)) {
      return { record: local, source: "local" };
    }
    return { record: remote, source: "supabase" };
  }
  return { record: local ?? null, source: "local" };
}

/** Parses an ISO timestamp to epoch ms, or null when missing/unparseable. */
function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}
