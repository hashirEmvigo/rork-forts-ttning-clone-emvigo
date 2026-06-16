import { describe, expect, it } from "vitest";

import {
  DEFAULT_REQUEST_LIST_FILTERS,
  filterAndSortRequests,
  hasActiveRequestFilters,
} from "@/lib/requestCrm/requestListFilters";
import { REQUEST_CRM_REQUESTS } from "@/lib/requestCrm/mockData";

describe("filterAndSortRequests", () => {
  it("returns every row with the default (neutral) filters", () => {
    const result = filterAndSortRequests(REQUEST_CRM_REQUESTS, DEFAULT_REQUEST_LIST_FILTERS);
    expect(result).toHaveLength(REQUEST_CRM_REQUESTS.length);
  });

  it("does not mutate the source array", () => {
    const before = REQUEST_CRM_REQUESTS.map((row) => row.id);
    filterAndSortRequests(REQUEST_CRM_REQUESTS, {
      ...DEFAULT_REQUEST_LIST_FILTERS,
      sort: "severity_desc",
    });
    expect(REQUEST_CRM_REQUESTS.map((row) => row.id)).toEqual(before);
  });

  it("filters by status", () => {
    const result = filterAndSortRequests(REQUEST_CRM_REQUESTS, {
      ...DEFAULT_REQUEST_LIST_FILTERS,
      status: "open",
    });
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((row) => row.status === "open")).toBe(true);
  });

  it("filters by severity (emergency)", () => {
    const result = filterAndSortRequests(REQUEST_CRM_REQUESTS, {
      ...DEFAULT_REQUEST_LIST_FILTERS,
      severity: "emergency",
    });
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((row) => row.severity === "emergency")).toBe(true);
  });

  it("filters unassigned requests", () => {
    const result = filterAndSortRequests(REQUEST_CRM_REQUESTS, {
      ...DEFAULT_REQUEST_LIST_FILTERS,
      ownerAdminId: "unassigned",
    });
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((row) => row.ownerAdminId === null)).toBe(true);
  });

  it("filters automation-linked rows only", () => {
    const result = filterAndSortRequests(REQUEST_CRM_REQUESTS, {
      ...DEFAULT_REQUEST_LIST_FILTERS,
      onlyAutomationLinked: true,
    });
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((row) => Boolean(row.automationQuickReviewKey))).toBe(true);
  });

  it("searches across number, title, owner and customer", () => {
    const byNumber = filterAndSortRequests(REQUEST_CRM_REQUESTS, {
      ...DEFAULT_REQUEST_LIST_FILTERS,
      search: "REQ-5551",
    });
    expect(byNumber).toHaveLength(1);
    expect(byNumber[0]?.requestNumber).toBe("REQ-5551");

    const byTitle = filterAndSortRequests(REQUEST_CRM_REQUESTS, {
      ...DEFAULT_REQUEST_LIST_FILTERS,
      search: "water leak",
    });
    expect(byTitle.every((row) => row.title.toLowerCase().includes("water leak"))).toBe(true);
    expect(byTitle.length).toBeGreaterThan(0);
  });

  it("sorts emergency severity first", () => {
    const result = filterAndSortRequests(REQUEST_CRM_REQUESTS, {
      ...DEFAULT_REQUEST_LIST_FILTERS,
      sort: "severity_desc",
    });
    expect(result[0]?.severity).toBe("emergency");
  });

  it("sorts unassigned first", () => {
    const result = filterAndSortRequests(REQUEST_CRM_REQUESTS, {
      ...DEFAULT_REQUEST_LIST_FILTERS,
      sort: "unassigned_first",
    });
    expect(result[0]?.ownerAdminId).toBeNull();
  });

  it("returns an empty list when no row matches", () => {
    const result = filterAndSortRequests(REQUEST_CRM_REQUESTS, {
      ...DEFAULT_REQUEST_LIST_FILTERS,
      search: "no-such-request-xyz",
    });
    expect(result).toHaveLength(0);
  });
});

describe("hasActiveRequestFilters", () => {
  it("is false for the default filters", () => {
    expect(hasActiveRequestFilters(DEFAULT_REQUEST_LIST_FILTERS)).toBe(false);
  });

  it("is true once any filter narrows the set", () => {
    expect(
      hasActiveRequestFilters({ ...DEFAULT_REQUEST_LIST_FILTERS, status: "open" }),
    ).toBe(true);
    expect(
      hasActiveRequestFilters({ ...DEFAULT_REQUEST_LIST_FILTERS, onlyUnreadExternal: true }),
    ).toBe(true);
    expect(
      hasActiveRequestFilters({ ...DEFAULT_REQUEST_LIST_FILTERS, search: "abc" }),
    ).toBe(true);
  });
});

describe("REQUEST CRM mock request data", () => {
  it("marks every row as test/demo data with the shared batch id", () => {
    expect(REQUEST_CRM_REQUESTS.length).toBeGreaterThan(0);
    expect(REQUEST_CRM_REQUESTS.every((row) => row.isTestData === true)).toBe(true);
    expect(REQUEST_CRM_REQUESTS.every((row) => row.testBatchId === "RC-DEMO")).toBe(true);
  });
});
