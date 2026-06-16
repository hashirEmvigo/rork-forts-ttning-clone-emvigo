/**
 * GPM-CALC-LIBRARY-3 — activation plumbing tests for linking a service question
 * back to its reusable library source.
 *   • buildQuestionLibraryActivationInput copies the library defaults and stamps
 *     libraryItemId (pure — no I/O).
 *   • createCalculatorQuestion writes library_item_id ONLY when supplied, so an
 *     ordinary custom-question insert is byte-identical to before (existing
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
  buildQuestionLibraryActivationInput,
  createCalculatorQuestion,
  type NewQuestionInput,
} from "./calculatorConfigAdmin";
import type { QuestionLibraryItem } from "./libraryItems";

interface RecordedOp {
  table: string;
  kind: "insert" | "update" | "select";
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

const LIBRARY_ITEM: QuestionLibraryItem = {
  id: "lib-uuid-pets",
  legacyId: "calc_qlib_has_pets_x",
  companyId: "cmp-uuid",
  companyLegacyId: "cmp_legacy",
  questionKey: "has_pets",
  label: "Vi har husdjur",
  helpText: "Markera om husdjur finns.",
  inputType: "boolean",
  defaultRequired: false,
  defaultAffectsPricing: true,
  defaultOptions: [],
  defaultValidation: {},
  defaultSortOrder: 5,
  description: null,
  active: true,
};

const TARGET = {
  companyId: "cmp-uuid",
  companyLegacyId: "cmp_legacy",
  serviceId: "svc-home",
  serviceLegacyId: "svc_home_legacy",
};

describe("buildQuestionLibraryActivationInput", () => {
  it("copies the library defaults and stamps libraryItemId", () => {
    const input = buildQuestionLibraryActivationInput(LIBRARY_ITEM, TARGET, 9);
    expect(input).toEqual({
      companyId: "cmp-uuid",
      companyLegacyId: "cmp_legacy",
      serviceId: "svc-home",
      serviceLegacyId: "svc_home_legacy",
      questionKey: "has_pets",
      label: "Vi har husdjur",
      helpText: "Markera om husdjur finns.",
      inputType: "boolean",
      required: false,
      affectsPricing: true,
      sortOrder: 9,
      options: [],
      libraryItemId: "lib-uuid-pets",
    });
  });

  it("coerces an unsupported input type to a safe fallback", () => {
    const input = buildQuestionLibraryActivationInput(
      { ...LIBRARY_ITEM, inputType: "not-a-real-type" },
      TARGET,
      1,
    );
    expect(input.inputType).toBe("text");
  });
});

describe("createCalculatorQuestion — library_item_id plumbing", () => {
  const BASE: NewQuestionInput = {
    companyId: "cmp-uuid",
    companyLegacyId: "cmp_legacy",
    serviceId: "svc-home",
    serviceLegacyId: "svc_home_legacy",
    questionKey: "has_pets",
    label: "Vi har husdjur",
    helpText: null,
    inputType: "boolean",
    required: false,
    affectsPricing: true,
    sortOrder: 9,
    options: [],
  };

  it("writes library_item_id when activating from a library item", async () => {
    await createCalculatorQuestion({ ...BASE, libraryItemId: "lib-uuid-pets" });
    const insert = ops.find((o) => o.kind === "insert");
    expect(insert?.table).toBe("calculator_questions");
    expect(insert?.payload).toMatchObject({ library_item_id: "lib-uuid-pets", question_key: "has_pets" });
  });

  it("omits library_item_id entirely for a plain custom question (unchanged behaviour)", async () => {
    await createCalculatorQuestion(BASE);
    const insert = ops.find((o) => o.kind === "insert");
    expect(insert?.payload).not.toHaveProperty("library_item_id");
  });
});
