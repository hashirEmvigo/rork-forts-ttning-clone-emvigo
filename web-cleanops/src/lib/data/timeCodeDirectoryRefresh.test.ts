/**
 * TIMECODE-5 — time-code directory refresh signal.
 *
 * The authoritative mutations bump this AFTER a confirmed Supabase write so the
 * directory hook refetches. Proves the version increments monotonically and that
 * subscribers are notified (the mechanism that makes the UI reflect the true
 * persisted state instead of optimistic state).
 */
import {
  bumpTimeCodeDirectoryRefresh,
  getTimeCodeDirectoryRefreshVersion,
  subscribeTimeCodeDirectoryRefresh,
} from "./timeCodeDirectoryRefresh";

describe("TIMECODE-5 · time-code directory refresh signal", () => {
  it("increments the version on each bump", () => {
    const start = getTimeCodeDirectoryRefreshVersion();
    bumpTimeCodeDirectoryRefresh();
    expect(getTimeCodeDirectoryRefreshVersion()).toBe(start + 1);
    bumpTimeCodeDirectoryRefresh();
    expect(getTimeCodeDirectoryRefreshVersion()).toBe(start + 2);
  });

  it("notifies subscribers and stops after unsubscribe", () => {
    let calls = 0;
    const unsubscribe = subscribeTimeCodeDirectoryRefresh(() => {
      calls += 1;
    });

    bumpTimeCodeDirectoryRefresh();
    bumpTimeCodeDirectoryRefresh();
    expect(calls).toBe(2);

    unsubscribe();
    bumpTimeCodeDirectoryRefresh();
    expect(calls).toBe(2);
  });
});
