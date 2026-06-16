import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Customer, User } from "@/types";
import { assignedUsersFromProfiles } from "@/lib/assignedUsersRoster";
import {
  CLIENT_DOMAIN_STORAGE_EPOCH,
  CLIENT_DOMAIN_STORAGE_EPOCH_KEY,
  invalidateDomainQueryCaches,
  purgeClientDomainStorageForCurrentEpoch,
} from "./clientDomainStorage";

const staleUser: User = {
  id: "usr_stale",
  name: "Kund2116",
  email: "kund2116@example.com",
  role: "customer",
  companyId: "cmp_deleted",
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const staleCustomer: Customer = {
  id: "cust_stale",
  companyId: "cmp_deleted",
  name: "delete-test-005",
  customerNumber: "C-STale",
  email: "delete-test-005@example.com",
  status: "active",
  customerType: "commercial",
  userIds: [],
  createdAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("client domain storage epoch purge", () => {
  it("purges dirty CleanOps domain keys on startup and writes the epoch marker", () => {
    localStorage.setItem("cleanops.users", JSON.stringify([staleUser]));
    localStorage.setItem("cleanops.customers", JSON.stringify([staleCustomer]));
    localStorage.setItem("cleanops.services", JSON.stringify([{ id: "svc_stale" }]));
    localStorage.setItem("cleanops.recentCustomers.cmp_deleted", JSON.stringify(["cust_stale"]));

    const result = purgeClientDomainStorageForCurrentEpoch();

    expect(result.didPurge).toBe(true);
    expect(result.previousEpoch).toBeNull();
    expect(result.currentEpoch).toBe(CLIENT_DOMAIN_STORAGE_EPOCH);
    expect(localStorage.getItem("cleanops.users")).toBeNull();
    expect(localStorage.getItem("cleanops.customers")).toBeNull();
    expect(localStorage.getItem("cleanops.services")).toBeNull();
    expect(localStorage.getItem("cleanops.recentCustomers.cmp_deleted")).toBeNull();
    expect(localStorage.getItem(CLIENT_DOMAIN_STORAGE_EPOCH_KEY)).toBe(CLIENT_DOMAIN_STORAGE_EPOCH);
    expect(result.purgedKeys).toEqual(
      expect.arrayContaining([
        "cleanops.users",
        "cleanops.customers",
        "cleanops.services",
        "cleanops.recentCustomers.cmp_deleted",
      ]),
    );
  });

  it("preserves Supabase Auth keys and unknown non-CleanOps keys", () => {
    localStorage.setItem("cleanops.users", JSON.stringify([staleUser]));
    localStorage.setItem("sb-project-auth-token", "supabase-session");
    localStorage.setItem("third-party.analytics", "keep");

    const result = purgeClientDomainStorageForCurrentEpoch();

    expect(localStorage.getItem("cleanops.users")).toBeNull();
    expect(localStorage.getItem("sb-project-auth-token")).toBe("supabase-session");
    expect(localStorage.getItem("third-party.analytics")).toBe("keep");
    expect(result.preservedSupabaseAuthKeys).toContain("sb-project-auth-token");
  });

  it("does not call localStorage.clear or sign the user out during purge", () => {
    localStorage.setItem("cleanops.users", JSON.stringify([staleUser]));
    const clearSpy = vi.spyOn(Storage.prototype, "clear");

    purgeClientDomainStorageForCurrentEpoch();

    expect(clearSpy).not.toHaveBeenCalled();
    expect(localStorage.getItem(CLIENT_DOMAIN_STORAGE_EPOCH_KEY)).toBe(CLIENT_DOMAIN_STORAGE_EPOCH);
  });

  it("keeps a clean browser unaffected apart from the epoch marker", () => {
    const result = purgeClientDomainStorageForCurrentEpoch();

    expect(result.didPurge).toBe(true);
    expect(result.purgedKeys).toEqual([]);
    expect(localStorage.getItem(CLIENT_DOMAIN_STORAGE_EPOCH_KEY)).toBe(CLIENT_DOMAIN_STORAGE_EPOCH);
  });

  it("does not repeat the purge when the current epoch marker already exists", () => {
    localStorage.setItem(CLIENT_DOMAIN_STORAGE_EPOCH_KEY, CLIENT_DOMAIN_STORAGE_EPOCH);
    localStorage.setItem("cleanops.users", JSON.stringify([staleUser]));

    const result = purgeClientDomainStorageForCurrentEpoch();

    expect(result.didPurge).toBe(false);
    expect(result.previousEpoch).toBe(CLIENT_DOMAIN_STORAGE_EPOCH);
    expect(result.purgedKeys).toEqual([]);
    expect(localStorage.getItem("cleanops.users")).toBe(JSON.stringify([staleUser]));
  });

  it("purges again when an older epoch marker exists", () => {
    localStorage.setItem(CLIENT_DOMAIN_STORAGE_EPOCH_KEY, "old-epoch");
    localStorage.setItem("cleanops.users", JSON.stringify([staleUser]));

    const result = purgeClientDomainStorageForCurrentEpoch();

    expect(result.didPurge).toBe(true);
    expect(result.previousEpoch).toBe("old-epoch");
    expect(localStorage.getItem("cleanops.users")).toBeNull();
    expect(localStorage.getItem(CLIENT_DOMAIN_STORAGE_EPOCH_KEY)).toBe(CLIENT_DOMAIN_STORAGE_EPOCH);
  });

  it("ignores stale Assigned Users local rows even before purge", () => {
    localStorage.setItem("cleanops.users", JSON.stringify([staleUser]));
    localStorage.setItem("cleanops.customers", JSON.stringify([staleCustomer]));

    const roster = assignedUsersFromProfiles([]);

    expect(roster).toEqual([]);
    purgeClientDomainStorageForCurrentEpoch();
    expect(localStorage.getItem("cleanops.users")).toBeNull();
    expect(localStorage.getItem("cleanops.customers")).toBeNull();
  });

  it("invalidates React Query domain caches without clearing auth storage", async () => {
    localStorage.setItem("sb-project-auth-token", "supabase-session");
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    queryClient.setQueryData(["directory-profiles-roster"], [{ id: "profile_1" }]);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await invalidateDomainQueryCaches(queryClient);

    expect(invalidateSpy).toHaveBeenCalledWith({ predicate: expect.any(Function) });
    expect(localStorage.getItem("sb-project-auth-token")).toBe("supabase-session");
  });
});
