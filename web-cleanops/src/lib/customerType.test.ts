import { describe, expect, it } from "vitest";

import {
  CUSTOMER_TYPE_LABELS,
  CUSTOMER_TYPES,
  type CustomerType,
} from "@/types";
import {
  customerTypeLabel,
  isCustomerType,
  normalizeCustomerType,
  recommendedProtocolsForType,
  recommendedServicesForType,
  segmentForCustomerType,
} from "@/lib/customerType";

describe("customer type — fixed classification", () => {
  it("exposes exactly four hardcoded types with labels", () => {
    expect(CUSTOMER_TYPES).toEqual([
      "commercial",
      "private",
      "one_time",
      "special_services",
    ]);
    expect(CUSTOMER_TYPE_LABELS.commercial).toBe("Commercial");
    expect(CUSTOMER_TYPE_LABELS.private).toBe("Private");
    expect(CUSTOMER_TYPE_LABELS.one_time).toBe("One-Time Customer");
    expect(CUSTOMER_TYPE_LABELS.special_services).toBe("Special Services");
  });

  it("guards arbitrary values", () => {
    expect(isCustomerType("commercial")).toBe(true);
    expect(isCustomerType("Commercial")).toBe(false);
    expect(isCustomerType("residential")).toBe(false);
    expect(isCustomerType(undefined)).toBe(false);
    expect(isCustomerType(42)).toBe(false);
  });
});

describe("normalizeCustomerType — legacy migration", () => {
  it("passes through canonical values", () => {
    for (const type of CUSTOMER_TYPES) {
      expect(normalizeCustomerType(type)).toBe(type);
    }
  });

  it("maps legacy commercial/business labels", () => {
    expect(normalizeCustomerType("Commercial")).toBe("commercial");
    expect(normalizeCustomerType("Office")).toBe("commercial");
    expect(normalizeCustomerType("Företag")).toBe("commercial");
    expect(normalizeCustomerType("Bedrift")).toBe("commercial");
    expect(normalizeCustomerType("Erhverv")).toBe("commercial");
  });

  it("maps legacy private/residential labels", () => {
    expect(normalizeCustomerType("Residential")).toBe("private");
    expect(normalizeCustomerType("Privat")).toBe("private");
    expect(normalizeCustomerType("Domestic")).toBe("private");
    expect(normalizeCustomerType("Home")).toBe("private");
  });

  it("maps one-time and special-service labels", () => {
    expect(normalizeCustomerType("Move-out")).toBe("one_time");
    expect(normalizeCustomerType("One Time")).toBe("one_time");
    expect(normalizeCustomerType("Sanitization")).toBe("special_services");
    expect(normalizeCustomerType("Floor care")).toBe("special_services");
  });

  it("returns undefined for empty/unknown values", () => {
    expect(normalizeCustomerType(undefined)).toBeUndefined();
    expect(normalizeCustomerType(null)).toBeUndefined();
    expect(normalizeCustomerType("")).toBeUndefined();
    expect(normalizeCustomerType("   ")).toBeUndefined();
    expect(normalizeCustomerType("xyzzy")).toBeUndefined();
  });
});

describe("segmentForCustomerType — derived recommendation axis", () => {
  it("maps each type to a segment", () => {
    expect(segmentForCustomerType("commercial")).toBe("b2b");
    expect(segmentForCustomerType("special_services")).toBe("b2b");
    expect(segmentForCustomerType("private")).toBe("b2c");
    expect(segmentForCustomerType("one_time")).toBe("one_time");
    expect(segmentForCustomerType(undefined)).toBeUndefined();
  });
});

describe("recommendations by type", () => {
  it("returns services per type and nothing when unclassified", () => {
    expect(recommendedServicesForType("private")).toContain("Home Cleaning");
    expect(recommendedServicesForType("commercial")).toContain("Office Cleaning");
    expect(recommendedServicesForType("special_services")).toContain("Floor Care");
    expect(recommendedServicesForType(undefined)).toEqual([]);
  });

  it("returns protocols per type and nothing when unclassified", () => {
    expect(recommendedProtocolsForType("commercial")).toContain(
      "Office Cleaning Checklist",
    );
    expect(recommendedProtocolsForType("private")).toContain(
      "Home Cleaning Checklist",
    );
    expect(recommendedProtocolsForType(undefined)).toEqual([]);
  });
});

describe("customerTypeLabel", () => {
  it("renders labels and a placeholder when unset", () => {
    const type: CustomerType = "one_time";
    expect(customerTypeLabel(type)).toBe("One-Time Customer");
    expect(customerTypeLabel(undefined)).toBe("—");
  });
});
