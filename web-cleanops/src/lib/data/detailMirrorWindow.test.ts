import { describe, expect, it } from "vitest";

import {
  isLocalRecordFresher,
  resolveDetailMirrorWindow,
} from "./detailMirrorWindow";

const T0 = "2026-06-04T10:00:00.000Z";
const T1 = "2026-06-04T10:00:05.000Z";

describe("isLocalRecordFresher", () => {
  it("is true when local is strictly newer", () => {
    expect(isLocalRecordFresher({ updatedAt: T1 }, { updatedAt: T0 })).toBe(true);
  });

  it("is false when timestamps are equal (converged)", () => {
    expect(isLocalRecordFresher({ updatedAt: T0 }, { updatedAt: T0 })).toBe(false);
  });

  it("is false when remote is newer (cross-client update wins)", () => {
    expect(isLocalRecordFresher({ updatedAt: T0 }, { updatedAt: T1 })).toBe(false);
  });

  it("is false when local has no usable stamp (remote keeps priority)", () => {
    expect(isLocalRecordFresher({ updatedAt: null }, { updatedAt: T0 })).toBe(false);
    expect(isLocalRecordFresher({}, { updatedAt: T0 })).toBe(false);
    expect(isLocalRecordFresher(undefined, { updatedAt: T0 })).toBe(false);
  });

  it("is true when local is present but remote stamp is missing/unparseable", () => {
    expect(isLocalRecordFresher({ updatedAt: T0 }, { updatedAt: null })).toBe(true);
    expect(isLocalRecordFresher({ updatedAt: T0 }, { updatedAt: "not-a-date" })).toBe(true);
  });
});

describe("resolveDetailMirrorWindow", () => {
  it("returns local synchronously when the Supabase path is disabled", () => {
    const local = { id: "a", updatedAt: T0 };
    const res = resolveDetailMirrorWindow(false, local, null);
    expect(res).toEqual({ record: local, source: "local" });
  });

  it("falls back to local when remote is null", () => {
    const local = { id: "a", updatedAt: T0 };
    const res = resolveDetailMirrorWindow(true, local, null);
    expect(res).toEqual({ record: local, source: "local" });
  });

  it("prefers the fresher local copy during the mirror window", () => {
    const local = { id: "a", updatedAt: T1, rows: [1, 2] };
    const remote = { id: "a", updatedAt: T0, rows: [1] };
    const res = resolveDetailMirrorWindow(true, local, remote);
    expect(res.source).toBe("local");
    expect(res.record).toBe(local);
  });

  it("converges on remote once timestamps match (mirror committed)", () => {
    const local = { id: "a", updatedAt: T1, rows: [1, 2] };
    const remote = { id: "a", updatedAt: T1, rows: [1, 2] };
    const res = resolveDetailMirrorWindow(true, local, remote);
    expect(res.source).toBe("supabase");
    expect(res.record).toBe(remote);
  });

  it("keeps remote primary when remote is newer than local", () => {
    const local = { id: "a", updatedAt: T0 };
    const remote = { id: "a", updatedAt: T1 };
    const res = resolveDetailMirrorWindow(true, local, remote);
    expect(res.source).toBe("supabase");
    expect(res.record).toBe(remote);
  });

  it("returns remote when there is no local copy", () => {
    const remote = { id: "a", updatedAt: T0 };
    const res = resolveDetailMirrorWindow(true, null, remote);
    expect(res.source).toBe("supabase");
    expect(res.record).toBe(remote);
  });
});
