import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const migrationSource = readFileSync(
  path.resolve(__dirname, "../../../supabase/migrations/0043_number_counters_foundation.sql"),
  "utf8",
);
const resetToolingSource = readFileSync(
  path.resolve(__dirname, "../../../scripts/reset-database.sql"),
  "utf8",
);

/**
 * Strip SQL block and line comments so anti-pattern assertions test the
 * executable SQL only. The migration header intentionally *documents* what it
 * avoids (MAX()+1, 1001 defaults, ON DELETE CASCADE, localStorage), so those
 * words appear in comments by design — they must never appear in real code.
 */
function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ");
}

const migrationCode = stripSqlComments(migrationSource);

describe("NUM-1 durable number allocator foundation", () => {
  it("adds the number_counters table with company-scoped, kind-isolated rows", () => {
    expect(migrationSource).toMatch(/create table if not exists number_counters/i);
    expect(migrationSource).toMatch(/company_scope\s+text not null/i);
    expect(migrationSource).toMatch(/entity_kind\s+text not null/i);
    // One running series per (company, entity kind): two companies — or two
    // entity kinds within one company — are independent rows.
    expect(migrationSource).toMatch(/unique \(company_scope, entity_kind\)/i);
    // entity_kind is disciplined (lowercase snake_case) without enumerating kinds.
    expect(migrationSource).toMatch(/check \(entity_kind ~ '\^\[a-z\]\[a-z0-9_\]\*\$'\)/i);
  });

  it("stores last_issued_value as the high-water mark and starts at 1, never 1001", () => {
    expect(migrationSource).toMatch(/last_issued_value\s+integer not null default 0/i);
    expect(migrationSource).toMatch(/start_value\s+integer not null default 1/i);
    expect(migrationSource).toMatch(/check \(start_value >= 1\)/i);
    // The documented semantics are explicitly last_issued_value, not next_value.
    expect(migrationSource).toMatch(/STORES last_issued_value \(HIGH-WATER MARK\), NOT next_value/i);
    // No executable SQL defaults a series to 1001 (the legacy start value).
    expect(migrationCode).not.toMatch(/1001/);
  });

  it("exposes an atomic allocate_number RPC that returns the issued number", () => {
    expect(migrationSource).toMatch(
      /create or replace function public\.allocate_number\(\s*p_company_scope text,\s*p_entity_kind text,\s*p_start_value integer default 1\s*\)/i,
    );
    expect(migrationSource).toMatch(/returns integer/i);
    expect(migrationSource).toMatch(/security definer/i);
    // Single-statement atomic allocate-and-consume (no MAX()+1, no read-then-write).
    expect(migrationSource).toMatch(/on conflict \(company_scope, entity_kind\) do update/i);
    expect(migrationSource).toMatch(/set last_issued_value = nc\.last_issued_value \+ 1/i);
    expect(migrationSource).toMatch(/returning nc\.last_issued_value into v_issued/i);
    expect(migrationSource).toMatch(/return v_issued;/i);
    expect(migrationSource).toMatch(
      /grant execute on function public\.allocate_number\(text, text, integer\) to authenticated/i,
    );
  });

  it("allocates monotonically and never reuses a number", () => {
    // Forward-only: increment by exactly 1, with no decrement / reset / gap-fill.
    expect(migrationCode).toMatch(/nc\.last_issued_value \+ 1/);
    expect(migrationCode).not.toMatch(/last_issued_value\s*=\s*0/);
    expect(migrationCode).not.toMatch(/last_issued_value\s*-\s*\d/);
    // The replaced unsafe generator (MAX(existing)+1) must not appear in code.
    expect(migrationCode).not.toMatch(/max\s*\(/i);
  });

  it("scopes allocation per company so one tenant cannot burn another's series", () => {
    expect(migrationSource).toMatch(/if not public\.is_super_admin\(\) then/i);
    expect(migrationSource).toMatch(/from public\.companies c\s+where c\.id = public\.current_company_id\(\)/i);
    expect(migrationSource).toMatch(/Not authorized to allocate numbers for company scope/i);
  });

  it("locks the counter table to the RPC only (no client write policies)", () => {
    expect(migrationSource).toMatch(/alter table number_counters enable row level security/i);
    expect(migrationSource).toMatch(/number_counters_select_super_admin/i);
    expect(migrationSource).toMatch(/number_counters_select_own_company/i);
    // Mutations happen exclusively through the SECURITY DEFINER RPC: no client
    // INSERT/UPDATE/DELETE policies exist, and the RPC never hard-deletes.
    expect(migrationCode).not.toMatch(/for insert to/i);
    expect(migrationCode).not.toMatch(/for update to/i);
    expect(migrationCode).not.toMatch(/for delete to/i);
    expect(migrationCode).not.toMatch(/delete from public\.number_counters/i);
  });

  it("keeps counters durable: no company FK and untouched by normal cleanup", () => {
    // Durability decision 1: company_scope is plain text, NOT a cascading FK,
    // so deleting a company never deletes (resets) its counter.
    expect(migrationCode).not.toMatch(/references\s+companies/i);
    expect(migrationCode).not.toMatch(/on delete cascade/i);
    // Durability decision 2: the standard test-data reset must not touch
    // number_counters, so consumed numbers survive normal cleanup / company
    // deletion. (Verified against the existing reset tooling, unchanged here.)
    expect(resetToolingSource).not.toMatch(/number_counters/i);
  });

  it("does not wire any entity, UI, or fallback into the allocator yet", () => {
    // Phase 1 is foundation only — no localStorage authority/fallback anywhere.
    expect(migrationCode).not.toMatch(/localStorage/i);
    expect(migrationCode).not.toMatch(/sessionStorage/i);
    // And it does not reach into the entities deferred to later phases.
    expect(migrationCode).not.toMatch(/insert into public\.customers/i);
    expect(migrationCode).not.toMatch(/insert into public\.work_orders/i);
    expect(migrationCode).not.toMatch(/insert into public\.employees/i);
  });
});
