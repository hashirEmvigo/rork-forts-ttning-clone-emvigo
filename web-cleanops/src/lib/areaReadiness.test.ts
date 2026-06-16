import { describe, expect, it } from "vitest";

import {
  buildAreaReadinessSummary,
  classifyCustomerAreaReadiness,
  getApplicableAreaSuggestions,
  resolveSuggestedArea,
} from "./areaReadiness";
import type { Area, Customer, PostalCity } from "@/types";

const COMPANY = "cmp_nordlys";

function makeArea(over: Partial<Area> = {}): Area {
  const now = new Date().toISOString();
  return {
    id: "area_gbg",
    companyId: COMPANY,
    name: "Gothenburg",
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

function makeCity(over: Partial<PostalCity> = {}): PostalCity {
  const now = new Date().toISOString();
  return {
    id: "pc_molndal",
    companyId: COMPANY,
    name: "Mölndal",
    areaId: "area_gbg",
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

function makeCustomer(over: Partial<Customer> = {}): Customer {
  return {
    id: "cust_1",
    companyId: COMPANY,
    name: "Test",
    customerNumber: "C-1",
    email: "a@b.c",
    status: "active",
    userIds: [],
    createdAt: new Date().toISOString(),
    ...over,
  };
}

describe("areaReadiness — classification", () => {
  const areas = [makeArea()];
  const cities = [makeCity()];

  it("classifies a customer with a resolved Area as 'has'", () => {
    expect(
      classifyCustomerAreaReadiness(makeCustomer({ areaId: "area_gbg" }), areas, cities),
    ).toBe("has");
    // Legacy free-text that matches a real area also counts as 'has'.
    expect(
      classifyCustomerAreaReadiness(makeCustomer({ area: "Gothenburg" }), areas, cities),
    ).toBe("has");
  });

  it("classifies a customer with a usable Postal City suggestion as 'suggested'", () => {
    expect(
      classifyCustomerAreaReadiness(
        makeCustomer({ postalCityId: "pc_molndal" }),
        areas,
        cities,
      ),
    ).toBe("suggested");
  });

  it("classifies a customer with no Area and no suggestion as 'manual'", () => {
    expect(classifyCustomerAreaReadiness(makeCustomer({}), areas, cities)).toBe("manual");
    // Postal city whose area is inactive cannot suggest → manual review.
    const inactiveArea = [makeArea({ isActive: false })];
    expect(
      classifyCustomerAreaReadiness(
        makeCustomer({ postalCityId: "pc_molndal" }),
        inactiveArea,
        cities,
      ),
    ).toBe("manual");
  });

  it("does not suggest when postal city is missing or its area is inactive", () => {
    expect(resolveSuggestedArea(makeCustomer({}), areas, cities)).toBeUndefined();
    expect(
      resolveSuggestedArea(makeCustomer({ postalCityId: "unknown" }), areas, cities),
    ).toBeUndefined();
    expect(
      resolveSuggestedArea(
        makeCustomer({ postalCityId: "pc_molndal" }),
        [makeArea({ isActive: false })],
        cities,
      ),
    ).toBeUndefined();
  });
});

describe("areaReadiness — summary", () => {
  it("counts areas, cities and the readiness buckets consistently", () => {
    const areas = [makeArea(), makeArea({ id: "area_sthlm", name: "Stockholm" })];
    const cities = [makeCity()];
    const customers = [
      makeCustomer({ id: "c1", areaId: "area_gbg" }), // has
      makeCustomer({ id: "c2", area: "Stockholm" }), // has (legacy match)
      makeCustomer({ id: "c3", postalCityId: "pc_molndal" }), // suggested
      makeCustomer({ id: "c4" }), // manual
      makeCustomer({ id: "c5" }), // manual
    ];

    const summary = buildAreaReadinessSummary({
      customers,
      areas,
      postalCities: cities,
      areaScopedAccessReady: false,
    });

    expect(summary.areasConfigured).toBe(2);
    expect(summary.postalCitiesConfigured).toBe(1);
    expect(summary.customersWithoutArea).toBe(3);
    expect(summary.customersWithSuggestedArea).toBe(1);
    expect(summary.customersRequiringManualReview).toBe(2);
    // without === suggested + manual
    expect(summary.customersWithoutArea).toBe(
      summary.customersWithSuggestedArea + summary.customersRequiringManualReview,
    );
    expect(summary.areaScopedAccessReady).toBe(false);
  });

  it("reflects the supplied Area Scoped Access ready flag", () => {
    const summary = buildAreaReadinessSummary({
      customers: [],
      areas: [makeArea()],
      postalCities: [makeCity()],
      areaScopedAccessReady: true,
    });
    expect(summary.areaScopedAccessReady).toBe(true);
  });

  it("excludes inactive areas and postal cities from configured counts", () => {
    const summary = buildAreaReadinessSummary({
      customers: [],
      areas: [makeArea(), makeArea({ id: "area_x", isActive: false })],
      postalCities: [makeCity(), makeCity({ id: "pc_x", isActive: false })],
      areaScopedAccessReady: true,
    });
    expect(summary.areasConfigured).toBe(1);
    expect(summary.postalCitiesConfigured).toBe(1);
  });
});

describe("areaReadiness — applicable suggestions", () => {
  const areas = [makeArea()];
  const cities = [makeCity()];

  it("returns only customers missing an Area whose city maps to an active area", () => {
    const customers = [
      makeCustomer({ id: "c1", postalCityId: "pc_molndal" }), // applicable
      makeCustomer({ id: "c2", areaId: "area_gbg", postalCityId: "pc_molndal" }), // already has area
      makeCustomer({ id: "c3" }), // no suggestion
    ];
    const result = getApplicableAreaSuggestions(customers, areas, cities);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      customerId: "c1",
      areaId: "area_gbg",
      areaName: "Gothenburg",
    });
  });

  it("never overwrites an existing areaId", () => {
    const customers = [
      makeCustomer({ id: "c2", areaId: "area_gbg", postalCityId: "pc_molndal" }),
    ];
    expect(getApplicableAreaSuggestions(customers, areas, cities)).toEqual([]);
  });

  it("does not suggest when the city's area is inactive or missing", () => {
    const inactive = [makeArea({ isActive: false })];
    const customers = [makeCustomer({ id: "c1", postalCityId: "pc_molndal" })];
    expect(getApplicableAreaSuggestions(customers, inactive, cities)).toEqual([]);
    expect(getApplicableAreaSuggestions(customers, [], cities)).toEqual([]);
  });
});
