import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { GENERIC_PRICING_MODELS } from "./v2/pricingModel";

/**
 * Slice GPM-3a — migration 0075 widens the `calculator_services_pricing_model_check`
 * CHECK constraint so a service may use a legacy, service-named model OR a generic
 * GPM-1 model. These tests lock the constraint's contract from the migration TEXT
 * (no DB needed), mirroring publicRequestThrottle.migration.test.ts:
 *   • every legacy value from migration 0065 stays allowed (pure superset),
 *   • all five generic models are added,
 *   • the migration only swaps the CHECK — it seeds / rewrites / deletes nothing.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readMigration(file: string): string {
  return readFileSync(path.resolve(__dirname, "../../../supabase/migrations", file), "utf8");
}

function stripSqlComments(sql: string): string {
  return sql
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .toLowerCase();
}

const rawSql = readMigration("0075_calculator_services_generic_pricing_models.sql");
const sql = stripSqlComments(rawSql);

/** The legacy values migration 0065 allowed — must ALL remain valid after 0075. */
const LEGACY_0065_MODELS = [
  "home_cleaning_recommended_hours",
  "move_out_fixed_plus_addons",
  "office_cleaning_recurring_area_frequency",
  "window_cleaning_count_based",
  "deep_cleaning_area_addons",
  "stairwell_cleaning_floors_frequency",
  "inquiry_only_no_price",
] as const;

describe("0075 — generic pricing-model CHECK widening", () => {
  it("re-creates the CHECK idempotently (drop-if-exists + add)", () => {
    expect(sql).toContain("drop constraint if exists calculator_services_pricing_model_check");
    expect(sql).toContain("add constraint calculator_services_pricing_model_check");
    expect(sql).toContain("check (pricing_model in (");
  });

  it("preserves every legacy value from migration 0065 (pure superset)", () => {
    for (const model of LEGACY_0065_MODELS) {
      expect(sql).toContain(`'${model}'`);
    }
  });

  it("adds the historical deep_cleaning_area_based spelling for code-compat", () => {
    // Listed in LEGACY_PRICING_MODELS (v2/pricingModel.ts) but absent from the
    // live 0065 constraint — 0075 makes the DB a superset of the code's view.
    expect(sql).toContain("'deep_cleaning_area_based'");
  });

  it("allows all five generic GPM-1 models", () => {
    for (const model of GENERIC_PRICING_MODELS) {
      expect(sql).toContain(`'${model}'`);
    }
  });

  it("only swaps the CHECK — it seeds / rewrites / deletes / disables nothing", () => {
    expect(sql).not.toContain("insert into");
    expect(sql).not.toContain("update calculator_services");
    expect(sql).not.toContain("delete from");
    // No row-touching column writes (enabled / coming_soon / deleted_at).
    expect(sql).not.toMatch(/set\s+enabled/);
    expect(sql).not.toMatch(/set\s+coming_soon/);
    expect(sql).not.toMatch(/set\s+deleted_at/);
    // No adjacent schema object is altered beyond the single constraint swap.
    expect(sql).not.toContain("create table");
    expect(sql).not.toContain("drop table");
  });

  it("touches only the calculator_services pricing_model constraint", () => {
    // The only `alter table` statements target calculator_services, and the only
    // constraint named is the pricing_model CHECK.
    const alterTargets = rawSql.match(/alter table\s+(\w+)/gi) ?? [];
    for (const stmt of alterTargets) {
      expect(stmt.toLowerCase()).toContain("calculator_services");
    }
    expect(sql).not.toContain("enable row level security");
    expect(sql).not.toContain("create policy");
  });
});
