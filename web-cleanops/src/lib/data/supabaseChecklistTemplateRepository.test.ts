import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChecklistItem, ChecklistSection, ChecklistTemplateV2 } from "@/types";
import type {
  ChecklistTemplateAggregate,
  ChecklistTemplateUpsertRow,
} from "./supabaseChecklistTemplateRepository";

/**
 * Phase 2C-A3.1 — Checklist Template Supabase repository boundary tests.
 *
 * These tests use an in-memory PostgREST-shaped client only. They prove the new
 * boundary does not touch browser storage, treats empty Supabase as
 * authoritative, scopes global/company visibility, mutates JSON aggregate
 * sections/items, archives/restores via Supabase, supports Supabase-to-Supabase
 * global copy, and excludes deleted_at rows.
 */

type Row = Record<string, unknown>;

const mocks = vi.hoisted(() => {
  class QueryBuilder {
    private filters: Array<(row: Row) => boolean> = [];

    constructor(private rows: Row[]) {}

    eq(column: string, value: unknown): this {
      this.filters.push((row) => row[column] === value);
      return this;
    }

    is(column: string, value: unknown): this {
      this.filters.push((row) =>
        value === null ? row[column] === null || row[column] === undefined : row[column] === value,
      );
      return this;
    }

    or(expression: string): this {
      const clauses = expression.split(",").map((part) => part.trim());
      this.filters.push((row) =>
        clauses.some((clause) => {
          const eqMatch = /^([a-z_]+)\.eq\.(.*)$/.exec(clause);
          if (eqMatch) return row[eqMatch[1]] === eqMatch[2];
          const nullMatch = /^([a-z_]+)\.is\.null$/.exec(clause);
          if (nullMatch) return row[nullMatch[1]] === null || row[nullMatch[1]] === undefined;
          return false;
        }),
      );
      return this;
    }

    private applied(): Row[] {
      return this.rows.filter((row) => this.filters.every((filter) => filter(row)));
    }

    maybeSingle(): Promise<{ data: Row | null; error: null }> {
      return Promise.resolve({ data: this.applied()[0] ?? null, error: null });
    }

    then<R>(onFulfilled: (result: { data: Row[]; error: null }) => R): Promise<R> {
      return Promise.resolve({ data: this.applied(), error: null }).then(onFulfilled);
    }
  }

  class MutationBuilder {
    private filters: Array<(row: Row) => boolean> = [];
    private shouldReturnRows = false;

    constructor(
      private rows: Row[],
      private kind: "insert" | "update",
      private payload: Row | Row[],
    ) {}

    eq(column: string, value: unknown): this {
      this.filters.push((row) => row[column] === value);
      return this;
    }

    is(column: string, value: unknown): this {
      this.filters.push((row) =>
        value === null ? row[column] === null || row[column] === undefined : row[column] === value,
      );
      return this;
    }

    select(): this {
      this.shouldReturnRows = true;
      return this;
    }

    private apply(): Row[] {
      if (this.kind === "insert") {
        const inserted = Array.isArray(this.payload) ? this.payload : [this.payload];
        const copies = inserted.map((row) => ({ ...row }));
        this.rows.push(...copies);
        return this.shouldReturnRows ? copies : [];
      }

      const patch = this.payload as Row;
      const updated: Row[] = [];
      for (let i = 0; i < this.rows.length; i += 1) {
        const row = this.rows[i];
        if (!this.filters.every((filter) => filter(row))) continue;
        const next = { ...row, ...patch };
        this.rows[i] = next;
        updated.push(next);
      }
      return this.shouldReturnRows ? updated : [];
    }

    maybeSingle(): Promise<{ data: Row | null; error: null }> {
      return Promise.resolve({ data: this.apply()[0] ?? null, error: null });
    }

    then<R>(onFulfilled: (result: { data: Row[] | null; error: null }) => R): Promise<R> {
      return Promise.resolve({ data: this.apply(), error: null }).then(onFulfilled);
    }
  }

  class FakeClient {
    tables = new Map<string, Row[]>();

    private table(name: string): Row[] {
      if (!this.tables.has(name)) this.tables.set(name, []);
      return this.tables.get(name) as Row[];
    }

    from(name: string) {
      const rows = this.table(name);
      return {
        select: () => new QueryBuilder(rows),
        insert: (payload: Row | Row[]) => new MutationBuilder(rows, "insert", payload),
        update: (payload: Row) => new MutationBuilder(rows, "update", payload),
      };
    }

    seed(name: string, rows: Row[]): void {
      this.tables.set(name, rows.map((row) => ({ ...row })));
    }

    tableRows(name: string): Row[] {
      return this.table(name);
    }

    reset(): void {
      this.tables.clear();
    }
  }

  return { client: new FakeClient() };
});

vi.mock("@/lib/supabase", () => ({
  supabase: mocks.client,
  isSupabaseConfigured: true,
}));

vi.mock("@/lib/perf", () => ({
  perf: {
    start: () => () => undefined,
    count: () => undefined,
  },
}));

import {
  supabaseChecklistTemplateRepository,
  toChecklistTemplateUpsertRow,
} from "./supabaseChecklistTemplateRepository";

const COMPANY = "cmp_nord";
const OTHER_COMPANY = "cmp_fjord";
const COMPANY_UUID = "11111111-1111-4111-8111-111111111111";
const CREATED = "2026-06-01T08:00:00.000Z";
const LATER = "2026-06-01T09:00:00.000Z";

function template(overrides: Partial<ChecklistTemplateV2> = {}): ChecklistTemplateV2 {
  return {
    id: "tpl_1",
    companyId: COMPANY,
    scope: "company",
    audience: "b2b",
    name: "Office weekly",
    description: "Weekly office checklist",
    categoryIds: ["cat_1"],
    floorPresetIds: ["floor_1"],
    sortOrder: 10,
    isArchived: false,
    version: 1,
    schemaVersion: 1,
    createdAt: CREATED,
    updatedAt: CREATED,
    ...overrides,
  };
}

function sections(templateId = "tpl_1", companyId: string | null = COMPANY): ChecklistSection[] {
  return [
    {
      id: "sec_b",
      templateId,
      companyId,
      title: "Bathrooms",
      sortOrder: 2,
      createdAt: CREATED,
      updatedAt: CREATED,
    },
    {
      id: "sec_a",
      templateId,
      companyId,
      title: "Entrance",
      sortOrder: 1,
      createdAt: CREATED,
      updatedAt: CREATED,
    },
  ];
}

function items(templateId = "tpl_1", companyId: string | null = COMPANY): ChecklistItem[] {
  return [
    {
      id: "item_b",
      templateId,
      companyId,
      sectionId: "sec_a",
      title: "Mop floor",
      required: true,
      sortOrder: 2,
      createdAt: CREATED,
      updatedAt: CREATED,
    },
    {
      id: "item_a",
      templateId,
      companyId,
      sectionId: "sec_a",
      title: "Check entrance mat",
      description: "Replace if wet",
      required: false,
      sortOrder: 1,
      createdAt: CREATED,
      updatedAt: CREATED,
    },
  ];
}

function aggregate(overrides: Partial<ChecklistTemplateV2> = {}): ChecklistTemplateAggregate {
  const t = template(overrides);
  return {
    template: t,
    sections: sections(t.id, t.companyId),
    items: items(t.id, t.companyId),
  };
}

function globalAggregate(overrides: Partial<ChecklistTemplateV2> = {}): ChecklistTemplateAggregate {
  return aggregate({
    id: "tpl_global",
    companyId: null,
    scope: "global",
    name: "Global office standard",
    originType: "global",
    ...overrides,
  });
}

function row(
  aggregateInput: ChecklistTemplateAggregate,
  companyUuid: string | null = COMPANY_UUID,
  overrides: Partial<ChecklistTemplateUpsertRow> = {},
): Row {
  return { ...toChecklistTemplateUpsertRow(aggregateInput, companyUuid), ...overrides } satisfies Row;
}

beforeEach(() => {
  mocks.client.reset();
  vi.restoreAllMocks();
});

describe("Phase 2C-A3.1 checklist template mapping", () => {
  it("maps aggregate fields to flat checklist_templates columns and sorted JSON data", () => {
    const mapped = toChecklistTemplateUpsertRow(aggregate(), COMPANY_UUID);

    expect(mapped).toMatchObject({
      legacy_id: "tpl_1",
      company_id: COMPANY_UUID,
      company_legacy_id: COMPANY,
      scope: "company",
      name: "Office weekly",
      is_archived: false,
      deleted_at: null,
    });
    expect(mapped.data.sections.map((section) => section.id)).toEqual(["sec_a", "sec_b"]);
    expect(mapped.data.items.map((item) => item.id)).toEqual(["item_a", "item_b"]);
  });

  it("maps global templates with null company scope", () => {
    const mapped = toChecklistTemplateUpsertRow(globalAggregate(), null);

    expect(mapped).toMatchObject({
      legacy_id: "tpl_global",
      company_id: null,
      company_legacy_id: null,
      scope: "global",
    });
  });
});

describe("Phase 2C-A3.1 checklist template empty reads and scoping", () => {
  it("returns [] / null when Supabase is empty with no fallback or seed", async () => {
    await expect(supabaseChecklistTemplateRepository.listGlobal()).resolves.toEqual([]);
    await expect(supabaseChecklistTemplateRepository.listCompany(COMPANY)).resolves.toEqual([]);
    await expect(supabaseChecklistTemplateRepository.listCompanyAndGlobal(COMPANY)).resolves.toEqual([]);
    await expect(
      supabaseChecklistTemplateRepository.getByLegacyId("missing", { companyId: COMPANY }),
    ).resolves.toBeNull();
  });

  it("does not read or write localStorage/sessionStorage", async () => {
    const getSpy = vi.spyOn(Storage.prototype, "getItem");
    const setSpy = vi.spyOn(Storage.prototype, "setItem");

    await supabaseChecklistTemplateRepository.createAggregate(aggregate(), { companyUuid: COMPANY_UUID });
    await supabaseChecklistTemplateRepository.listCompanyAndGlobal(COMPANY);
    await supabaseChecklistTemplateRepository.updateMetadata("tpl_1", { name: "Updated" }, { now: LATER });

    expect(getSpy).not.toHaveBeenCalled();
    expect(setSpy).not.toHaveBeenCalled();
  });

  it("keeps global, company, and company+global visibility distinct", async () => {
    mocks.client.seed("checklist_templates", [
      row(globalAggregate(), null),
      row(aggregate({ id: "tpl_company" })),
      row(aggregate({ id: "tpl_other", companyId: OTHER_COMPANY })),
      row(aggregate({ id: "tpl_deleted" }), COMPANY_UUID, {
        deleted_at: "2026-06-02T08:00:00.000Z",
      }),
    ]);

    const globals = await supabaseChecklistTemplateRepository.listGlobal();
    expect(globals.map((item) => item.template.id)).toEqual(["tpl_global"]);

    const companyOnly = await supabaseChecklistTemplateRepository.listCompany(COMPANY);
    expect(companyOnly.map((item) => item.template.id)).toEqual(["tpl_company"]);

    const companyAndGlobal = await supabaseChecklistTemplateRepository.listCompanyAndGlobal(COMPANY);
    expect(companyAndGlobal.map((item) => item.template.id)).toEqual(["tpl_global", "tpl_company"]);
  });

  it("returns null when getByLegacyId is out of requested company or scope", async () => {
    mocks.client.seed("checklist_templates", [row(aggregate())]);

    await expect(
      supabaseChecklistTemplateRepository.getByLegacyId("tpl_1", { companyId: OTHER_COMPANY }),
    ).resolves.toBeNull();
    await expect(
      supabaseChecklistTemplateRepository.getByLegacyId("tpl_1", { scope: "global" }),
    ).resolves.toBeNull();
  });
});

describe("Phase 2C-A3.1 checklist template writes and JSON aggregate updates", () => {
  it("creates a checklist template aggregate in Supabase only", async () => {
    const created = await supabaseChecklistTemplateRepository.createAggregate(aggregate(), {
      companyUuid: COMPANY_UUID,
    });

    expect(created.template.id).toBe("tpl_1");
    expect(mocks.client.tableRows("checklist_templates")).toHaveLength(1);
    expect(mocks.client.tableRows("checklist_templates")[0]).toMatchObject({
      legacy_id: "tpl_1",
      company_id: COMPANY_UUID,
      company_legacy_id: COMPANY,
      scope: "company",
    });
  });

  it("updates aggregate metadata", async () => {
    mocks.client.seed("checklist_templates", [row(aggregate())]);

    const updated = await supabaseChecklistTemplateRepository.updateMetadata(
      "tpl_1",
      { name: "Office premium", description: "Expanded checklist" },
      { companyId: COMPANY, now: LATER },
    );

    expect(updated?.template).toMatchObject({
      name: "Office premium",
      description: "Expanded checklist",
      updatedAt: LATER,
    });
    expect(mocks.client.tableRows("checklist_templates")[0]).toMatchObject({ name: "Office premium" });
  });

  it("updates sections/items inside the JSON aggregate", async () => {
    mocks.client.seed("checklist_templates", [row(aggregate())]);

    const updated = await supabaseChecklistTemplateRepository.updateSectionsAndItems(
      "tpl_1",
      [{ ...sections()[0], title: "Updated section", sortOrder: 1 }],
      [{ ...items()[0], title: "Updated item", sortOrder: 1 }],
      { companyId: COMPANY, now: LATER },
    );

    expect(updated?.sections).toHaveLength(1);
    expect(updated?.sections[0].title).toBe("Updated section");
    expect(updated?.items).toHaveLength(1);
    expect(updated?.items[0].title).toBe("Updated item");
    expect(updated?.template.updatedAt).toBe(LATER);

    const stored = mocks.client.tableRows("checklist_templates")[0].data as ChecklistTemplateAggregate;
    expect(stored.sections[0].title).toBe("Updated section");
  });

  it("archives and restores without hard delete", async () => {
    mocks.client.seed("checklist_templates", [row(aggregate())]);

    const archived = await supabaseChecklistTemplateRepository.archive("tpl_1", {
      companyId: COMPANY,
      now: LATER,
    });
    expect(archived?.template.isArchived).toBe(true);
    expect(mocks.client.tableRows("checklist_templates")[0].deleted_at).toBeNull();

    const activeOnly = await supabaseChecklistTemplateRepository.listCompany(COMPANY, {
      includeArchived: false,
    });
    expect(activeOnly).toEqual([]);

    const restored = await supabaseChecklistTemplateRepository.restore("tpl_1", {
      companyId: COMPANY,
      now: "2026-06-01T10:00:00.000Z",
    });
    expect(restored?.template.isArchived).toBe(false);
  });

  it("copies a Supabase global template to a company without local seed or browser rescue", async () => {
    mocks.client.seed("checklist_templates", [row(globalAggregate(), null)]);

    const copied = await supabaseChecklistTemplateRepository.copyGlobalToCompany("tpl_global", {
      targetCompanyId: COMPANY,
      targetCompanyUuid: COMPANY_UUID,
      newTemplateId: "tpl_company_copy",
      sectionIdFor: (section) => `copy_${section.id}`,
      itemIdFor: (item) => `copy_${item.id}`,
      name: "Company office standard",
      now: LATER,
    });

    expect(copied?.template).toMatchObject({
      id: "tpl_company_copy",
      companyId: COMPANY,
      scope: "company",
      name: "Company office standard",
      sourceGlobalTemplateId: "tpl_global",
      sourceGlobalTemplateName: "Global office standard",
    });
    expect(copied?.sections.map((section) => section.id)).toEqual(["copy_sec_a", "copy_sec_b"]);
    expect(copied?.items.map((item) => item.id)).toEqual(["copy_item_a", "copy_item_b"]);
    expect(mocks.client.tableRows("checklist_templates")).toHaveLength(2);
  });

  it("soft-deletes a row and excludes it from later reads", async () => {
    mocks.client.seed("checklist_templates", [row(aggregate())]);

    await expect(
      supabaseChecklistTemplateRepository.softDelete("tpl_1", { companyId: COMPANY, now: LATER }),
    ).resolves.toBe(true);
    await expect(supabaseChecklistTemplateRepository.listCompany(COMPANY)).resolves.toEqual([]);
    await expect(
      supabaseChecklistTemplateRepository.getByLegacyId("tpl_1", { companyId: COMPANY }),
    ).resolves.toBeNull();
  });
});
