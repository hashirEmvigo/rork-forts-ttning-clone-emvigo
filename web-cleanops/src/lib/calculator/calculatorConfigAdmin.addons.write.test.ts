/**
 * Slice V2-E0E-1 — Admin data-access tests for the generic add-on engine
 * (`calculator_addons`, migration 0074).
 *
 * Proves the new Admin layer end-to-end at the data boundary, against a recording
 * Supabase mock (the real scoped-write path, not idealized data):
 *   • mapAddonRow turns a snake_case row into the camelCase editor view.
 *   • createCalculatorAddon builds the correct insert payload (boolean + quantity)
 *     and NEVER leaks legacy add-on rule fields.
 *   • updateCalculatorAddon writes only the supplied effect/lifecycle columns and
 *     never the locked addon_key / scope.
 *   • archiveCalculatorAddon soft-deletes via deleted_at — NEVER a hard delete.
 *   • No add-on write ever touches pricing_rules or calculator_questions.
 *   • validateNewAddon mirrors the migration CHECK constraints (and rejects
 *     single_select, which is not a valid input type yet).
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
  archiveCalculatorAddon,
  createCalculatorAddon,
  mapAddonRow,
  SUPPORTED_ADDON_INPUT_TYPES,
  updateCalculatorAddon,
  validateNewAddon,
  type NewAddonDraft,
  type NewAddonInput,
} from "./calculatorConfigAdmin";

interface RecordedOp {
  table: string;
  kind: "insert" | "update" | "select" | "delete";
  payload?: Record<string, unknown>;
  columns?: string;
  legacyId?: unknown;
}

let ops: RecordedOp[] = [];

/** A chainable builder that records the terminal operation it represents. */
function installSupabaseMock(): void {
  mocks.from.mockImplementation((table: string) => {
    const state: RecordedOp = { table, kind: "select" };
    const builder: Record<string, unknown> = {
      insert(payload: Record<string, unknown>) {
        state.kind = "insert";
        state.payload = payload;
        return builder;
      },
      update(payload: Record<string, unknown>) {
        state.kind = "update";
        state.payload = payload;
        return builder;
      },
      delete() {
        // The Admin layer must never hard-delete; recorded so a regression fails loudly.
        state.kind = "delete";
        return builder;
      },
      select(columns?: string) {
        state.columns = columns;
        return builder;
      },
      eq(column: string, value: unknown) {
        if (column === "legacy_id") state.legacyId = value;
        return builder;
      },
      is() {
        return builder;
      },
      maybeSingle() {
        ops.push({ ...state });
        return Promise.resolve({ data: { legacy_id: state.legacyId ?? "row" }, error: null });
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

const BOOLEAN_INPUT: NewAddonInput = {
  companyId: "cmp-uuid",
  companyLegacyId: "cmp_legacy",
  serviceId: "svc-home",
  serviceLegacyId: "svc_home_legacy",
  serviceKey: "home_cleaning",
  addonKey: "dog",
  name: "Dog in home",
  publicLabel: "Finns hund i hemmet?",
  inputType: "boolean",
  effectTimeMinutes: 20,
  sortOrder: 3,
};

describe("mapAddonRow", () => {
  function makeRow(over: Record<string, unknown> = {}) {
    return {
      legacy_id: "calc_addon_dog_x",
      calculator_service_id: "svc-home",
      calculator_service_legacy_id: "svc_home_legacy",
      service_key: "home_cleaning",
      addon_key: "dog",
      name: "Dog in home",
      public_label: "Finns hund i hemmet?",
      description: "Pet hair handling",
      input_type: "boolean",
      boolean_default: true,
      quantity_min: "0",
      quantity_max: null,
      quantity_step: "1",
      quantity_default: "0",
      effect_time_minutes: "20",
      effect_fixed_excl_vat: "-50",
      effect_percent: "0",
      active: true,
      public_visible: true,
      required: false,
      sort_order: 2,
      ...over,
    };
  }

  it("maps a calculator_addons row to its camelCase editor view (string numerics coerced)", () => {
    expect(mapAddonRow(makeRow())).toEqual({
      legacyId: "calc_addon_dog_x",
      serviceId: "svc-home",
      serviceLegacyId: "svc_home_legacy",
      serviceKey: "home_cleaning",
      addonKey: "dog",
      name: "Dog in home",
      publicLabel: "Finns hund i hemmet?",
      description: "Pet hair handling",
      inputType: "boolean",
      booleanDefault: true,
      quantityMin: 0,
      quantityMax: null,
      quantityStep: 1,
      quantityDefault: 0,
      effectTimeMinutes: 20,
      effectFixedExclVat: -50,
      effectPercent: 0,
      active: true,
      publicVisible: true,
      required: false,
      sortOrder: 2,
    });
  });

  it("defaults an unknown input_type to boolean (single_select is never surfaced)", () => {
    expect(mapAddonRow(makeRow({ input_type: "single_select" })).inputType).toBe("boolean");
    expect(mapAddonRow(makeRow({ input_type: "quantity" })).inputType).toBe("quantity");
  });
});

describe("createCalculatorAddon", () => {
  it("builds the correct insert payload for a boolean add-on (no legacy fields)", async () => {
    await createCalculatorAddon(BOOLEAN_INPUT);

    const inserts = ops.filter((o) => o.kind === "insert");
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe("calculator_addons");

    const payload = inserts[0].payload ?? {};
    expect(payload).toMatchObject({
      company_id: "cmp-uuid",
      company_legacy_id: "cmp_legacy",
      calculator_service_id: "svc-home",
      calculator_service_legacy_id: "svc_home_legacy",
      service_key: "home_cleaning",
      addon_key: "dog",
      name: "Dog in home",
      public_label: "Finns hund i hemmet?",
      input_type: "boolean",
      boolean_default: false,
      quantity_min: 0,
      quantity_max: null,
      quantity_step: 1,
      quantity_default: 0,
      effect_time_minutes: 20,
      effect_fixed_excl_vat: 0,
      effect_percent: 0,
      active: true,
      public_visible: true,
      required: false,
      sort_order: 3,
    });
    // legacy_id is generated from the addon_key prefix (survives archive → recreate).
    expect(String(payload.legacy_id)).toContain("calc_addon_dog");
    // No legacy add-on rule field is ever seeded into the new model.
    expect(payload).not.toHaveProperty("pet_time_percent");
    expect(payload).not.toHaveProperty("addon_hours_oven");
    expect(payload).not.toHaveProperty("addon_hours_fridge");
  });

  it("builds the correct insert payload for a quantity add-on", async () => {
    await createCalculatorAddon({
      companyId: "cmp-uuid",
      companyLegacyId: "cmp_legacy",
      serviceId: "svc-window",
      serviceLegacyId: "svc_window_legacy",
      serviceKey: "window_cleaning",
      addonKey: "sprojs",
      name: "Spröjs",
      publicLabel: "Antal spröjsade fönster",
      inputType: "quantity",
      quantityMin: 0,
      quantityMax: 50,
      quantityStep: 1,
      quantityDefault: 0,
      effectTimeMinutes: 3,
      sortOrder: 1,
    });

    const inserts = ops.filter((o) => o.kind === "insert");
    expect(inserts).toHaveLength(1);
    expect(inserts[0].payload).toMatchObject({
      service_key: "window_cleaning",
      addon_key: "sprojs",
      input_type: "quantity",
      quantity_min: 0,
      quantity_max: 50,
      quantity_step: 1,
      quantity_default: 0,
      effect_time_minutes: 3,
      effect_fixed_excl_vat: 0,
      effect_percent: 0,
    });
  });
});

describe("updateCalculatorAddon", () => {
  it("writes the three effect channels and nothing else (addon_key/scope locked)", async () => {
    await updateCalculatorAddon("calc_addon_dog_x", {
      effectTimeMinutes: 25,
      effectFixedExclVat: -100,
      effectPercent: 15,
    });

    const updates = ops.filter((o) => o.kind === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0].table).toBe("calculator_addons");
    expect(updates[0].legacyId).toBe("calc_addon_dog_x");
    expect(updates[0].payload).toEqual({
      effect_time_minutes: 25,
      effect_fixed_excl_vat: -100,
      effect_percent: 15,
    });
    expect(updates[0].payload).not.toHaveProperty("addon_key");
    expect(updates[0].payload).not.toHaveProperty("service_key");
    expect(updates[0].payload).not.toHaveProperty("company_id");
  });

  it("writes the lifecycle fields (active / public_visible / required / sort_order)", async () => {
    await updateCalculatorAddon("calc_addon_dog_x", {
      active: false,
      publicVisible: false,
      required: true,
      sortOrder: 7,
    });

    const updates = ops.filter((o) => o.kind === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0].payload).toEqual({
      active: false,
      public_visible: false,
      required: true,
      sort_order: 7,
    });
  });
});

describe("archiveCalculatorAddon", () => {
  it("soft-deletes via deleted_at and never issues a hard delete", async () => {
    await archiveCalculatorAddon("calc_addon_dog_x");

    const updates = ops.filter((o) => o.kind === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0].table).toBe("calculator_addons");
    expect(updates[0].legacyId).toBe("calc_addon_dog_x");
    expect(updates[0].payload).toHaveProperty("deleted_at");
    expect(typeof updates[0].payload?.deleted_at).toBe("string");
    // No DELETE statement was ever issued.
    expect(ops.some((o) => o.kind === "delete")).toBe(false);
  });
});

describe("add-on writes never touch legacy tables", () => {
  it("only ever writes to calculator_addons (not pricing_rules / calculator_questions)", async () => {
    await createCalculatorAddon(BOOLEAN_INPUT);
    await updateCalculatorAddon("calc_addon_dog_x", { active: false });
    await archiveCalculatorAddon("calc_addon_dog_x");

    expect(ops.length).toBeGreaterThan(0);
    expect(ops.every((o) => o.table === "calculator_addons")).toBe(true);
    expect(ops.some((o) => o.table === "pricing_rules")).toBe(false);
    expect(ops.some((o) => o.table === "calculator_questions")).toBe(false);
  });
});

describe("validateNewAddon", () => {
  const base: NewAddonDraft = {
    addonKey: "dog",
    name: "Dog in home",
    publicLabel: "Finns hund i hemmet?",
    inputType: "boolean",
    quantityMin: 0,
    quantityMax: null,
    quantityStep: 1,
    quantityDefault: 0,
    effectTimeMinutes: 20,
    effectFixedExclVat: 0,
    effectPercent: 0,
  };

  it("accepts a valid boolean add-on", () => {
    expect(validateNewAddon(base, [])).toEqual([]);
  });

  it("catches a missing / malformed / duplicate addon_key", () => {
    expect(validateNewAddon({ ...base, addonKey: "" }, [])).toContain("Add-on key is required.");
    expect(validateNewAddon({ ...base, addonKey: "Bad Key" }, [])[0]).toMatch(/lowercase letters/);
    expect(validateNewAddon({ ...base, addonKey: "dog" }, ["dog"])[0]).toMatch(/already used/);
  });

  it("requires name and public label", () => {
    const errors = validateNewAddon({ ...base, name: "  ", publicLabel: "" }, []);
    expect(errors).toContain("Name is required.");
    expect(errors).toContain("Public label is required.");
  });

  it("catches invalid quantity bounds", () => {
    expect(validateNewAddon({ ...base, quantityMin: -1 }, [])).toContain(
      "Quantity min must be zero or greater.",
    );
    expect(validateNewAddon({ ...base, quantityStep: 0 }, [])).toContain(
      "Quantity step must be greater than zero.",
    );
    expect(validateNewAddon({ ...base, quantityMin: 5, quantityMax: 2 }, [])).toContain(
      "Quantity max must be greater than or equal to quantity min.",
    );
    expect(validateNewAddon({ ...base, quantityMin: 2, quantityDefault: 1 }, [])).toContain(
      "Quantity default must be greater than or equal to quantity min.",
    );
    expect(validateNewAddon({ ...base, quantityMax: 3, quantityDefault: 5 }, [])).toContain(
      "Quantity default must be less than or equal to quantity max.",
    );
  });

  it("catches invalid time and percent effects (typo guards mirror the DB CHECKs)", () => {
    expect(validateNewAddon({ ...base, effectTimeMinutes: -1 }, [])).toContain(
      "Time effect must be between 0 and 1440 minutes.",
    );
    expect(validateNewAddon({ ...base, effectTimeMinutes: 5000 }, [])).toContain(
      "Time effect must be between 0 and 1440 minutes.",
    );
    expect(validateNewAddon({ ...base, effectPercent: -150 }, [])).toContain(
      "Percent effect must be between -100 and 100.",
    );
    expect(validateNewAddon({ ...base, effectPercent: 150 }, [])).toContain(
      "Percent effect must be between -100 and 100.",
    );
  });

  it("allows a negative fixed effect (a discount)", () => {
    expect(validateNewAddon({ ...base, effectFixedExclVat: -250 }, [])).toEqual([]);
  });

  it("rejects single_select as an input type (not supported yet)", () => {
    expect(validateNewAddon({ ...base, inputType: "single_select" }, [])).toContain(
      "Input type must be boolean or quantity.",
    );
    expect([...SUPPORTED_ADDON_INPUT_TYPES]).toEqual(["boolean", "quantity"]);
  });
});
