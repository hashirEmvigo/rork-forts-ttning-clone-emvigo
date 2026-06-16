import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Slice 11B fix — Company Admin could not see Customer Card menu overrides.
 *
 * Migration 0062 created `navigation_menu_overrides` with super_admin-only RLS,
 * which was correct while the only consumer was the Super-Admin Calculator tabs.
 * Once the Customer Card menu (used by Company Admin) started consuming the same
 * override layer, the super_admin-only SELECT made every Company-Admin read
 * return zero rows — so the menu silently fell back to registry defaults.
 *
 * Migration 0063 enables the documented Phase-2 read path: any authenticated
 * user may READ system-scope presentation rows, while WRITES stay
 * super_admin-only. These tests lock in that security model and prove the read
 * widening never touches writes, schema, or seeds — and that the table is
 * presentation-only, so broad read is safe.
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

const readMigrationSql = readMigration("0063_navigation_menu_overrides_authenticated_read.sql");
const readExecutableSql = stripSqlComments(readMigrationSql);

const baseMigrationSql = readMigration("0062_navigation_menu_overrides.sql");
const baseExecutableSql = stripSqlComments(baseMigrationSql);

describe("0063 — authenticated READ of system-scope navigation menu overrides", () => {
  it("adds an authenticated SELECT policy so Company Admin can read overrides", () => {
    expect(readExecutableSql).toContain(
      'create policy "navigation_menu_overrides_select_system" on navigation_menu_overrides',
    );
    expect(readExecutableSql).toContain("for select to authenticated");
    // Idempotent: drop-if-exists before create.
    expect(readExecutableSql).toContain(
      'drop policy if exists "navigation_menu_overrides_select_system" on navigation_menu_overrides',
    );
  });

  it("scopes the read to SYSTEM rows only (never a blanket using(true))", () => {
    expect(readExecutableSql).toContain("scope_type = 'system' and company_id is null");
    expect(readExecutableSql).not.toMatch(/for\s+select[\s\S]*using\s*\(\s*true\s*\)/);
  });

  it("widens READ only — it never creates a write or delete policy", () => {
    expect(readExecutableSql).not.toMatch(/create\s+policy[\s\S]*for\s+insert/);
    expect(readExecutableSql).not.toMatch(/create\s+policy[\s\S]*for\s+update/);
    expect(readExecutableSql).not.toMatch(/create\s+policy[\s\S]*for\s+delete/);
  });

  it("does not grant the read via super_admin (the whole point is non-super reads)", () => {
    expect(readExecutableSql).not.toContain("is_super_admin()");
  });

  it("changes no schema and seeds nothing (pure policy add)", () => {
    expect(readExecutableSql).not.toMatch(/create\s+table/);
    expect(readExecutableSql).not.toMatch(/alter\s+table\s+navigation_menu_overrides\s+add\s+column/);
    expect(readExecutableSql).not.toMatch(/insert\s+into\s+navigation_menu_overrides/);
    expect(readExecutableSql).not.toContain("drop table");
  });

  it("touches no adjacent domain table", () => {
    for (const table of ["roles", "system_settings", "companies", "customers", "quote_requests", "calculator_settings"]) {
      expect(readExecutableSql).not.toMatch(
        new RegExp(`\\b(insert\\s+into|update|delete\\s+from|alter\\s+table|create\\s+policy[\\s\\S]*on)\\s+${table}\\b`),
      );
    }
  });
});

describe("writes stay super_admin-only (0062 security model is unchanged)", () => {
  it("keeps INSERT and UPDATE gated on is_super_admin()", () => {
    expect(baseExecutableSql).toContain(
      'create policy "navigation_menu_overrides_insert_super_admin" on navigation_menu_overrides',
    );
    expect(baseExecutableSql).toContain(
      'create policy "navigation_menu_overrides_update_super_admin" on navigation_menu_overrides',
    );
    expect(baseExecutableSql).toContain("for insert to authenticated with check (is_super_admin())");
    expect(baseExecutableSql).toContain(
      "for update to authenticated using (is_super_admin()) with check (is_super_admin())",
    );
  });

  it("never hard-deletes (no DELETE policy — reset neutralises the row)", () => {
    expect(baseExecutableSql).not.toMatch(/create\s+policy[\s\S]*for\s+delete/);
    expect(readExecutableSql).not.toMatch(/create\s+policy[\s\S]*for\s+delete/);
  });
});

describe("the override table is presentation-only (so broad read is safe)", () => {
  it("defines only presentation + forward-compatible scope columns", () => {
    for (const column of ["menu_key", "custom_label", "custom_icon", "sort_order", "is_visible", "scope_type", "company_id"]) {
      expect(baseExecutableSql).toContain(column);
    }
  });

  it("stores no sensitive / PII / secret data", () => {
    for (const token of ["email", "phone", "password", "secret", "token", "ssn", "personnummer", "api_key", "address"]) {
      expect(baseExecutableSql).not.toContain(token);
    }
  });
});
