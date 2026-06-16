import { describe, expect, it } from "vitest";

import { customerNumberDisplay } from "@/lib/format";

describe("customerNumberDisplay", () => {
  it("strips the stored C- prefix and shows the numeric visible part", () => {
    expect(customerNumberDisplay("C-1042")).toBe("1042");
    expect(customerNumberDisplay("C-1")).toBe("1");
    expect(customerNumberDisplay("C-1001")).toBe("1001");
  });

  it("is case-insensitive on the prefix", () => {
    expect(customerNumberDisplay("c-5")).toBe("5");
  });

  it("only strips the single leading C- prefix", () => {
    expect(customerNumberDisplay("C-SOAK-3")).toBe("SOAK-3");
  });

  it("returns non-prefixed values unchanged", () => {
    expect(customerNumberDisplay("1042")).toBe("1042");
  });

  it("renders an em dash for empty / missing values", () => {
    expect(customerNumberDisplay("")).toBe("—");
    expect(customerNumberDisplay("   ")).toBe("—");
    expect(customerNumberDisplay(null)).toBe("—");
    expect(customerNumberDisplay(undefined)).toBe("—");
  });
});
