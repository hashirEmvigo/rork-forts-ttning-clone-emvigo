/**
 * GPM-CALC-LIBRARY-2B — Admin data-access tests for the reusable calculator
 * library tables (`calculator_question_library_items` /
 * `calculator_addon_library_items`, migration 0077).
 *
 * Proves the new adapter layer end-to-end at the data boundary, against a
 * recording Supabase mock (the real scoped read/write path, not idealized data):
 *   • listQuestionLibraryItems / listAddonLibraryItems map rows to camelCase views
 *     and tolerate a missing table (older environment) by returning an empty list.
 *   • createQuestionLibraryItem / createAddonLibraryItem build the correct insert
 *     payload and ONLY ever touch the library table — NEVER calculator_questions /
 *     calculator_addons (so existing service-scoped behaviour is untouched).
 *   • updateQuestionLibraryItem / updateAddonLibraryItem write only the supplied
 *     columns, scoped by stable legacy_id; the locked machine key + scope are never
 *     written.
 *   • archiveQuestionLibraryItem / archiveAddonLibraryItem soft-delete via
 *     deleted_at — NEVER a hard delete.
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
  archiveAddonLibraryItem,
  archiveQuestionLibraryItem,
  createAddonLibraryItem,
  createQuestionLibraryItem,
  listAddonLibraryItems,
  listQuestionLibraryItems,
  updateAddonLibraryItem,
  updateQuestionLibraryItem,
  type NewAddonLibraryItemInput,
  type NewQuestionLibraryItemInput,
} from "./calculatorConfigAdmin";

interface RecordedOp {
  table: string;
  kind: "insert" | "update" | "select" | "delete";
  payload?: Record<string, unknown>;
  columns?: string;
  legacyId?: unknown;
}

interface QueryResult {
  data: unknown;
  error: { message: string } | null;
}

let ops: RecordedOp[] = [];
/** Per-table result returned to a READ (awaited chain ending in .order()). */
let readResults: Record<string, QueryResult> = {};
/** Result returned to a WRITE (chain ending in .maybeSingle()). */
let writeResult: QueryResult = { data: { legacy_id: "row" }, error: null };

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
      order() {
        return builder;
      },
      maybeSingle() {
        ops.push({ ...state });
        return Promise.resolve(writeResult);
      },
      // A read chain (…order().order()) is awaited directly → resolves the rows.
      then(onFulfilled: (value: unknown) => unknown) {
        ops.push({ ...state });
        return Promise.resolve(readResults[table] ?? { data: [], error: null }).then(onFulfilled);
      },
    };
    return builder;
  });
}

beforeEach(() => {
  ops = [];
  readResults = {};
  writeResult = { data: { legacy_id: "row" }, error: null };
  vi.clearAllMocks();
  installSupabaseMock();
});

const QUESTION_LIBRARY_ROW = {
  id: "qlib-1",
  legacy_id: "calc_qlib_has_pets_x",
  company_id: "cmp-uuid",
  company_legacy_id: "cmp_legacy",
  question_key: "has_pets",
  label: "Vi har husdjur",
  help_text: null,
  input_type: "boolean",
  default_required: false,
  default_affects_pricing: true,
  default_options_json: [],
  default_validation_json: {},
  default_sort_order: 5,
  description: "Reusable pets question",
  active: true,
};

const ADDON_LIBRARY_ROW = {
  id: "alib-1",
  legacy_id: "calc_alib_oven_x",
  company_id: "cmp-uuid",
  company_legacy_id: "cmp_legacy",
  addon_key: "oven_cleaning",
  name: "Ugnsreng\u00f6ring",
  public_label: "Reng\u00f6ring av ugn",
  description: null,
  input_type: "boolean",
  boolean_default: false,
  quantity_min: "0",
  quantity_max: null,
  quantity_step: "1",
  quantity_default: "0",
  effect_time_minutes: "30",
  effect_fixed_excl_vat: "0",
  effect_percent: "0",
  default_sort_order: 2,
  active: true,
};

describe("listQuestionLibraryItems", () => {
  it("maps question library rows to camelCase views", async () => {
    readResults["calculator_question_library_items"] = { data: [QUESTION_LIBRARY_ROW], error: null };
    const items = await listQuestionLibraryItems("cmp-uuid");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "qlib-1",
      legacyId: "calc_qlib_has_pets_x",
      questionKey: "has_pets",
      label: "Vi har husdjur",
      inputType: "boolean",
      defaultAffectsPricing: true,
      defaultSortOrder: 5,
      active: true,
    });
  });

  it("tolerates a missing table by returning an empty list", async () => {
    readResults["calculator_question_library_items"] = {
      data: null,
      error: { message: 'relation "calculator_question_library_items" does not exist' },
    };
    await expect(listQuestionLibraryItems("cmp-uuid")).resolves.toEqual([]);
  });
});

describe("listAddonLibraryItems", () => {
  it("maps add-on library rows to camelCase views (string numerics coerced)", async () => {
    readResults["calculator_addon_library_items"] = { data: [ADDON_LIBRARY_ROW], error: null };
    const items = await listAddonLibraryItems("cmp-uuid");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "alib-1",
      addonKey: "oven_cleaning",
      name: "Ugnsreng\u00f6ring",
      publicLabel: "Reng\u00f6ring av ugn",
      inputType: "boolean",
      quantityMin: 0,
      effectTimeMinutes: 30,
      defaultSortOrder: 2,
    });
  });

  it("tolerates a missing table by returning an empty list", async () => {
    readResults["calculator_addon_library_items"] = {
      data: null,
      error: { message: 'relation "calculator_addon_library_items" does not exist' },
    };
    await expect(listAddonLibraryItems("cmp-uuid")).resolves.toEqual([]);
  });
});

describe("createQuestionLibraryItem", () => {
  const INPUT: NewQuestionLibraryItemInput = {
    companyId: "cmp-uuid",
    companyLegacyId: "cmp_legacy",
    questionKey: "has_pets",
    label: "Vi har husdjur",
    inputType: "boolean",
    defaultAffectsPricing: true,
    defaultSortOrder: 5,
  };

  it("inserts into the question library table with the correct payload", async () => {
    await createQuestionLibraryItem(INPUT);
    const inserts = ops.filter((o) => o.kind === "insert");
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe("calculator_question_library_items");
    expect(inserts[0].payload).toMatchObject({
      company_id: "cmp-uuid",
      company_legacy_id: "cmp_legacy",
      question_key: "has_pets",
      label: "Vi har husdjur",
      input_type: "boolean",
      default_required: false,
      default_affects_pricing: true,
      default_sort_order: 5,
      active: true,
    });
  });

  it("NEVER writes to the service-scoped calculator_questions table", async () => {
    await createQuestionLibraryItem(INPUT);
    expect(ops.every((o) => o.table === "calculator_question_library_items")).toBe(true);
    expect(ops.some((o) => o.table === "calculator_questions")).toBe(false);
  });
});

describe("createAddonLibraryItem", () => {
  const INPUT: NewAddonLibraryItemInput = {
    companyId: "cmp-uuid",
    companyLegacyId: "cmp_legacy",
    addonKey: "oven_cleaning",
    name: "Ugnsreng\u00f6ring",
    publicLabel: "Reng\u00f6ring av ugn",
    inputType: "boolean",
    effectTimeMinutes: 30,
    defaultSortOrder: 2,
  };

  it("inserts into the add-on library table with the correct payload", async () => {
    await createAddonLibraryItem(INPUT);
    const inserts = ops.filter((o) => o.kind === "insert");
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe("calculator_addon_library_items");
    expect(inserts[0].payload).toMatchObject({
      company_id: "cmp-uuid",
      addon_key: "oven_cleaning",
      name: "Ugnsreng\u00f6ring",
      public_label: "Reng\u00f6ring av ugn",
      input_type: "boolean",
      effect_time_minutes: 30,
      effect_fixed_excl_vat: 0,
      effect_percent: 0,
      default_sort_order: 2,
      active: true,
    });
  });

  it("NEVER writes to the service-scoped calculator_addons table", async () => {
    await createAddonLibraryItem(INPUT);
    expect(ops.every((o) => o.table === "calculator_addon_library_items")).toBe(true);
    expect(ops.some((o) => o.table === "calculator_addons")).toBe(false);
  });
});

describe("updateQuestionLibraryItem", () => {
  it("writes only the supplied columns, scoped by legacy_id (machine key locked)", async () => {
    await updateQuestionLibraryItem("calc_qlib_has_pets_x", {
      helpText: "Markera om husdjur finns.",
      defaultRequired: true,
    });
    const updates = ops.filter((o) => o.kind === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0].table).toBe("calculator_question_library_items");
    expect(updates[0].legacyId).toBe("calc_qlib_has_pets_x");
    expect(updates[0].payload).toEqual({
      help_text: "Markera om husdjur finns.",
      default_required: true,
    });
    expect(updates[0].payload).not.toHaveProperty("question_key");
    expect(updates[0].payload).not.toHaveProperty("company_id");
  });
});

describe("updateAddonLibraryItem", () => {
  it("writes only the supplied effect columns, scoped by legacy_id (addon_key locked)", async () => {
    await updateAddonLibraryItem("calc_alib_oven_x", {
      effectTimeMinutes: 45,
      active: false,
    });
    const updates = ops.filter((o) => o.kind === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0].table).toBe("calculator_addon_library_items");
    expect(updates[0].legacyId).toBe("calc_alib_oven_x");
    expect(updates[0].payload).toEqual({
      effect_time_minutes: 45,
      active: false,
    });
    expect(updates[0].payload).not.toHaveProperty("addon_key");
  });
});

describe("archive library items (soft-delete only)", () => {
  it("archives a question library item via deleted_at, never a hard delete", async () => {
    await archiveQuestionLibraryItem("calc_qlib_has_pets_x");
    expect(ops.some((o) => o.kind === "delete")).toBe(false);
    const update = ops.find((o) => o.kind === "update");
    expect(update?.table).toBe("calculator_question_library_items");
    expect(update?.legacyId).toBe("calc_qlib_has_pets_x");
    expect(update?.payload).toHaveProperty("deleted_at");
  });

  it("archives an add-on library item via deleted_at, never a hard delete", async () => {
    await archiveAddonLibraryItem("calc_alib_oven_x");
    expect(ops.some((o) => o.kind === "delete")).toBe(false);
    const update = ops.find((o) => o.kind === "update");
    expect(update?.table).toBe("calculator_addon_library_items");
    expect(update?.payload).toHaveProperty("deleted_at");
  });
});
