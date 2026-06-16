/**
 * GPM-CALC-LIBRARY-4 — activation plumbing tests for linking a service add-on
 * back to its reusable library source.
 *   • buildAddonLibraryActivationInput copies the library defaults (copy + input
 *     model + the three effect channels) and stamps libraryItemId (pure — no I/O).
 *   • createCalculatorAddon writes library_item_id ONLY when supplied, so an
 *     ordinary custom-add-on insert is byte-identical to before (existing
 *     service-scoped behaviour unchanged).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: (table: string) => mocks.from(table),
  },
}));

import {
  buildAddonLibraryActivationInput,
  createCalculatorAddon,
  type NewAddonInput,
} from "./calculatorConfigAdmin";
import type { AddonLibraryItem } from "./libraryItems";

interface RecordedOp {
  table: string;
  kind: "insert" | "select";
  payload?: Record<string, unknown>;
}

let ops: RecordedOp[] = [];

function installSupabaseMock(): void {
  mocks.from.mockImplementation((table: string) => {
    const state: RecordedOp = { table, kind: "select" };
    const builder: Record<string, unknown> = {
      insert(payload: Record<string, unknown>) {
        state.kind = "insert";
        state.payload = payload;
        return builder;
      },
      select() {
        return builder;
      },
      maybeSingle() {
        ops.push({ ...state });
        return Promise.resolve({ data: { legacy_id: "row" }, error: null });
      },
    };
    return builder;
  });
}

beforeEach(() => {
  ops = [];
  vi.clearAllMocks();
  installSupabaseMock();
});

const LIBRARY_ITEM: AddonLibraryItem = {
  id: "alib-uuid-oven",
  legacyId: "calc_alib_oven_x",
  companyId: "cmp-uuid",
  companyLegacyId: "cmp_legacy",
  addonKey: "oven_cleaning",
  name: "Ugnsrengöring",
  publicLabel: "Rengöring av ugn",
  description: "Städning av ugn inuti.",
  inputType: "boolean",
  booleanDefault: false,
  quantityMin: 0,
  quantityMax: null,
  quantityStep: 1,
  quantityDefault: 0,
  effectTimeMinutes: 30,
  effectFixedExclVat: 150,
  effectPercent: 0,
  defaultSortOrder: 5,
  active: true,
};

const TARGET = {
  companyId: "cmp-uuid",
  companyLegacyId: "cmp_legacy",
  serviceId: "svc-home",
  serviceLegacyId: "svc_home_legacy",
  serviceKey: "home_cleaning",
};

describe("buildAddonLibraryActivationInput", () => {
  it("copies the library defaults and stamps libraryItemId", () => {
    const input = buildAddonLibraryActivationInput(LIBRARY_ITEM, TARGET, 20);
    expect(input).toEqual({
      companyId: "cmp-uuid",
      companyLegacyId: "cmp_legacy",
      serviceId: "svc-home",
      serviceLegacyId: "svc_home_legacy",
      serviceKey: "home_cleaning",
      addonKey: "oven_cleaning",
      name: "Ugnsrengöring",
      publicLabel: "Rengöring av ugn",
      description: "Städning av ugn inuti.",
      inputType: "boolean",
      booleanDefault: false,
      quantityMin: 0,
      quantityMax: null,
      quantityStep: 1,
      quantityDefault: 0,
      effectTimeMinutes: 30,
      effectFixedExclVat: 150,
      effectPercent: 0,
      sortOrder: 20,
      libraryItemId: "alib-uuid-oven",
    });
  });
});

describe("createCalculatorAddon — library_item_id plumbing", () => {
  const BASE: NewAddonInput = {
    companyId: "cmp-uuid",
    companyLegacyId: "cmp_legacy",
    serviceId: "svc-home",
    serviceLegacyId: "svc_home_legacy",
    serviceKey: "home_cleaning",
    addonKey: "oven_cleaning",
    name: "Ugnsrengöring",
    publicLabel: "Rengöring av ugn",
    inputType: "boolean",
    effectTimeMinutes: 30,
    sortOrder: 20,
  };

  it("writes library_item_id when activating from a library item", async () => {
    await createCalculatorAddon({ ...BASE, libraryItemId: "alib-uuid-oven" });
    const insert = ops.find((o) => o.kind === "insert");
    expect(insert?.table).toBe("calculator_addons");
    expect(insert?.payload).toMatchObject({ library_item_id: "alib-uuid-oven", addon_key: "oven_cleaning" });
  });

  it("omits library_item_id entirely for a plain custom add-on (unchanged behaviour)", async () => {
    await createCalculatorAddon(BASE);
    const insert = ops.find((o) => o.kind === "insert");
    expect(insert?.payload).not.toHaveProperty("library_item_id");
  });
});
