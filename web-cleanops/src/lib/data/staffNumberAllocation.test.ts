import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readSource(relativePath: string): string {
  return readFileSync(path.resolve(__dirname, relativePath), "utf8");
}

const repositorySource = readSource("./supabaseEmployeeRepository.ts");
const edgeFunctionSource = readSource(
  "../../../supabase/functions/admin-create-user/index.ts",
);
const migrationSource = readSource(
  "../../../supabase/migrations/0045_staff_number_allocator.sql",
);
const resetToolingSource = readSource("../../../scripts/reset-database.sql");

/** Strip SQL comments so anti-pattern assertions test executable SQL only. */
function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

const migrationCode = stripSqlComments(migrationSource);

describe("NUM-1 Phase 3 — staff visible-number allocation", () => {
  it("issues employee Staff IDs from the durable allocator, not MAX(existing)+1", () => {
    expect(repositorySource).toContain('.rpc("allocate_number"');
    expect(repositorySource).toContain("p_entity_kind: STAFF_NUMBER_ENTITY_KIND");
    expect(repositorySource).toContain('STAFF_NUMBER_ENTITY_KIND = "staff"');
    // No front-end / MAX()+1 computation of the staff number.
    expect(repositorySource).not.toContain("Math.max(...");
  });

  it("allocates the Staff ID before insert and passes it into the upsert", () => {
    expect(repositorySource).toContain("const staffNumber = await allocateStaffNumber(companyId);");
    expect(repositorySource).toContain("return upsertEmployee(employee, companyUuid, staffNumber);");
  });

  it("allocates + persists a Staff ID for company-scoped profiles in the Edge Function", () => {
    expect(edgeFunctionSource).toContain('p_entity_kind: "staff"');
    expect(edgeFunctionSource).toContain('.from("profiles")');
    expect(edgeFunctionSource).toContain("staff_number: staffNumber");
    // Fail-closed guarantee: a company-scoped profile that cannot get a Staff ID
    // is rolled back rather than left without one.
    expect(edgeFunctionSource).toContain("assignStaffNumber");
    expect(edgeFunctionSource).toContain("deleteUser(userId)");
  });

  it("guards the Staff ID across ALL rows so an issued number is never reused", () => {
    // Full company-scoped unique guards on BOTH tables, no partial WHERE.
    expect(migrationSource).toMatch(
      /create unique index if not exists uq_employees_company_staff_number/i,
    );
    expect(migrationSource).toMatch(
      /create unique index if not exists uq_profiles_company_staff_number/i,
    );
    expect(migrationCode).toMatch(/on employees \(company_legacy_id, staff_number\)/i);
    expect(migrationCode).toMatch(/on profiles \(company_id, staff_number\)/i);
  });

  it("backfills one shared per-company series and seeds the staff counter forward", () => {
    // Shared series across both tables, ordered created_at asc then a stable id.
    expect(migrationCode).toMatch(/order by created_at asc nulls last, tiebreak asc/i);
    // The next allocate_number('staff') continues past the backfilled high-water mark.
    expect(migrationCode).toMatch(/insert into public\.number_counters/i);
    expect(migrationCode).toMatch(/'staff'/i);
    // No MAX()+1 anywhere in the backfill.
    expect(migrationCode).not.toMatch(/max\s*\(/i);
  });

  it("keeps consumed staff numbers durable through the standard test-data cleanup", () => {
    expect(resetToolingSource).not.toMatch(/number_counters/i);
  });
});
