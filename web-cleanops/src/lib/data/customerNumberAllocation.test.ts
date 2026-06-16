import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readSource(relativePath: string): string {
  return readFileSync(path.resolve(__dirname, relativePath), "utf8");
}

const repositorySource = readSource("./supabaseCustomerRepository.ts");
const appContextSource = readSource("../../context/AppContext.tsx");
const migrationSource = readSource(
  "../../../supabase/migrations/0044_customers_company_number_unique.sql",
);
const resetToolingSource = readSource("../../../scripts/reset-database.sql");

/**
 * Strip SQL block and line comments so anti-pattern assertions test the
 * executable SQL only. The migration header intentionally *documents* the
 * patterns it avoids (MAX()+1, other entities), so those words appear in
 * comments by design — they must never appear in real code.
 */
function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

const migrationCode = stripSqlComments(migrationSource);

describe("NUM-1 Phase 2 — customer visible-number allocation", () => {
  it("issues customer numbers from the durable allocator, not MAX(existing)+1", () => {
    // The Supabase customer create path is the single authoritative create path,
    // and it asks the database for the next number via allocate_number for this
    // company's 'customer' series.
    expect(repositorySource).toContain('.rpc("allocate_number"');
    expect(repositorySource).toContain("p_entity_kind: CUSTOMER_NUMBER_ENTITY_KIND");
    expect(repositorySource).toContain('CUSTOMER_NUMBER_ENTITY_KIND = "customer"');
    // The legacy MAX(existing)+1 generator is gone from the customer create path.
    expect(repositorySource).not.toContain("Math.max(...existingNumbers)");
    expect(repositorySource).not.toContain("nextCustomerNumber");
  });

  it("keeps the stored format as C-<number> while the database decides the value", () => {
    expect(repositorySource).toContain("return `C-${issued}`");
  });

  it("removes the localStorage/AppContext customer-number generator (no local authority)", () => {
    // The legacy local path can no longer mint a customer number, so dirty browser
    // data can never re-mirror an authoritative number back into Supabase.
    expect(appContextSource).not.toContain("customerNumber: `C-${nextNumber}`");
  });

  it("guards the visible customer number across ALL rows so a soft-deleted number is never reused", () => {
    // Company-scoped unique guard, keyed exactly on the allocator's scope
    // (company_legacy_id) + the issued customer_number.
    expect(migrationSource).toMatch(
      /create unique index if not exists uq_customers_company_customer_number/i,
    );
    expect(migrationCode).toMatch(/on customers \(company_legacy_id, customer_number\)/i);
    // FULL index, NOT a partial one: there is no `where deleted_at is null`
    // predicate, so active, archived AND soft-deleted (tombstoned) rows all keep
    // reserving their customer_number. Removing or soft-deleting a customer can
    // therefore never free its number for reuse at the storage layer.
    expect(migrationCode).not.toMatch(/where deleted_at is null/i);
    expect(migrationCode).not.toMatch(/\bwhere\b/i);
  });

  it("touches only the customers number guard — no other entity, sequence, or counter", () => {
    // Customers-only: the guard never reaches into other entities or the allocator
    // storage, and it is an index (no data mutation, no MAX()+1).
    expect(migrationCode).not.toMatch(/work_orders/i);
    expect(migrationCode).not.toMatch(/employees/i);
    expect(migrationCode).not.toMatch(/invoices/i);
    expect(migrationCode).not.toMatch(/booking_ledger/i);
    expect(migrationCode).not.toMatch(/number_counters/i);
    expect(migrationCode).not.toMatch(/create sequence/i);
    expect(migrationCode).not.toMatch(/max\s*\(/i);
  });

  it("keeps consumed customer numbers durable through the standard test-data cleanup", () => {
    // The reset tooling still never clears number_counters, so a customer number
    // consumed before a company/test reset is never reissued afterwards.
    expect(resetToolingSource).not.toMatch(/number_counters/i);
  });
});
