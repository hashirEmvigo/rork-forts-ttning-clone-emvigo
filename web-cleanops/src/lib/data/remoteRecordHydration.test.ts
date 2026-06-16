import { describe, expect, it } from "vitest";

import {
  reconcileHydratedRecord,
  reconcileHydratedRecords,
} from "./remoteRecordHydration";

const T0 = "2026-06-04T10:00:00.000Z";
const T1 = "2026-06-04T10:00:05.000Z";

interface Rec {
  id: string;
  updatedAt?: string | null;
  name?: string;
}

describe("reconcileHydratedRecord", () => {
  it("adds a record that is missing locally (the common remote-only case)", () => {
    const list: Rec[] = [{ id: "a", updatedAt: T0 }];
    const res = reconcileHydratedRecord(list, { id: "b", updatedAt: T0 });
    expect(res.changed).toBe(true);
    expect(res.list.map((r) => r.id).sort()).toEqual(["a", "b"]);
  });

  it("never duplicates: hydrating a present record is a no-op", () => {
    const list: Rec[] = [{ id: "a", updatedAt: T0 }];
    const res = reconcileHydratedRecord(list, { id: "a", updatedAt: T0 });
    expect(res.changed).toBe(false);
    expect(res.list).toBe(list); // same reference, no churn
    expect(res.list.filter((r) => r.id === "a")).toHaveLength(1);
  });

  it("does NOT overwrite newer local state with an older remote snapshot", () => {
    const list: Rec[] = [{ id: "a", updatedAt: T1, name: "local-newer" }];
    const res = reconcileHydratedRecord(list, { id: "a", updatedAt: T0, name: "remote-older" });
    expect(res.changed).toBe(false);
    expect(res.list[0].name).toBe("local-newer");
  });

  it("does NOT overwrite when timestamps are equal (already converged)", () => {
    const list: Rec[] = [{ id: "a", updatedAt: T0, name: "local" }];
    const res = reconcileHydratedRecord(list, { id: "a", updatedAt: T0, name: "remote" });
    expect(res.changed).toBe(false);
    expect(res.list[0].name).toBe("local");
  });

  it("refreshes a present record when the remote copy is strictly newer", () => {
    const list: Rec[] = [{ id: "a", updatedAt: T0, name: "local-stale" }];
    const res = reconcileHydratedRecord(list, { id: "a", updatedAt: T1, name: "remote-newer" });
    expect(res.changed).toBe(true);
    expect(res.list[0].name).toBe("remote-newer");
    expect(res.list.filter((r) => r.id === "a")).toHaveLength(1);
  });
});

describe("reconcileHydratedRecords (batch)", () => {
  it("hydrates every missing record in one pass", () => {
    const list: Rec[] = [{ id: "a", updatedAt: T0 }];
    const res = reconcileHydratedRecords(list, [
      { id: "b", updatedAt: T0 },
      { id: "c", updatedAt: T0 },
    ]);
    expect(res.changed).toBe(true);
    expect(res.list.map((r) => r.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("returns the same reference when nothing changes (all present/older)", () => {
    const list: Rec[] = [
      { id: "a", updatedAt: T1, name: "local-newer" },
      { id: "b", updatedAt: T0 },
    ];
    const res = reconcileHydratedRecords(list, [
      { id: "a", updatedAt: T0, name: "remote-older" },
      { id: "b", updatedAt: T0 },
    ]);
    expect(res.changed).toBe(false);
    expect(res.list).toBe(list);
  });

  it("never duplicates and mixes add + refresh correctly", () => {
    const list: Rec[] = [{ id: "a", updatedAt: T0, name: "local-stale" }];
    const res = reconcileHydratedRecords(list, [
      { id: "a", updatedAt: T1, name: "remote-newer" },
      { id: "b", updatedAt: T0 },
    ]);
    expect(res.changed).toBe(true);
    expect(res.list.filter((r) => r.id === "a")).toHaveLength(1);
    expect(res.list.find((r) => r.id === "a")?.name).toBe("remote-newer");
    expect(res.list.map((r) => r.id).sort()).toEqual(["a", "b"]);
  });

  it("is a no-op on an empty record set", () => {
    const list: Rec[] = [{ id: "a", updatedAt: T0 }];
    const res = reconcileHydratedRecords(list, []);
    expect(res.changed).toBe(false);
    expect(res.list).toBe(list);
  });
});
