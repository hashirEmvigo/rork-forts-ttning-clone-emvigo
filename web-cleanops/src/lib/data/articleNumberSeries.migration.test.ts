import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readSource(relativePath: string): string {
  return readFileSync(path.resolve(__dirname, relativePath), "utf8");
}

/** Strip SQL comments so anti-pattern assertions test executable SQL only. */
function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

const columnMigration = readSource(
  "../../../supabase/migrations/0050_services_article_number.sql",
);
const seriesMigration = readSource(
  "../../../supabase/migrations/0051_article_number_series.sql",
);
const resetToolingSource = readSource("../../../scripts/reset-database.sql");

const columnCode = stripSqlComments(columnMigration);
const seriesCode = stripSqlComments(seriesMigration);

describe("ARTNUM-1 — 0050 service article_number column", () => {
  it("adds a flat article_number column kept in sync from the data jsonb by a trigger", () => {
    expect(columnCode).toMatch(/alter table services add column if not exists article_number text/i);
    expect(columnCode).toMatch(/create or replace function set_services_article_number/i);
    expect(columnCode).toMatch(/new\.article_number = nullif\(btrim\(coalesce\(new\.data->>'articleNumber'/i);
    expect(columnCode).toMatch(/before insert or update on services/i);
  });

  it("backfills the column from existing data without MAX()+1", () => {
    expect(columnCode).toMatch(/update services\s+set article_number = nullif\(btrim\(coalesce\(data->>'articleNumber'/i);
    expect(columnCode).not.toMatch(/max\s*\(/i);
  });

  it("PRECHECKS for duplicates and STOPS (raises) instead of forcing the constraints", () => {
    expect(columnCode).toMatch(/raise exception/i);
    expect(columnCode).toMatch(/precheck FAILED/i);
    // Both uniqueness domains are scanned before the guards are created.
    expect(columnCode).toMatch(/company_id is null\s+and company_legacy_id is null/i);
    expect(columnCode).toMatch(/group by company_legacy_id, article_number/i);
  });

  it("guards uniqueness per domain (global vs per-company), excluding soft-deleted rows", () => {
    expect(columnCode).toMatch(/create unique index if not exists uq_services_global_article_number/i);
    expect(columnCode).toMatch(/create unique index if not exists uq_services_company_article_number/i);
    expect(columnCode).toMatch(/on services \(company_legacy_id, article_number\)/i);
    // Soft-deleted rows are excluded from the guard.
    expect(columnCode).toMatch(/and deleted_at is null/i);
  });
});

describe("ARTNUM-1 — 0051 article-number series + allocator", () => {
  it("creates a range-owning series table with scope + range + forward next_value", () => {
    expect(seriesCode).toMatch(/create table if not exists article_number_series/i);
    expect(seriesCode).toMatch(/range_start\s+integer not null/i);
    expect(seriesCode).toMatch(/range_end\s+integer not null/i);
    expect(seriesCode).toMatch(/next_value\s+integer not null/i);
    expect(seriesCode).toMatch(/check \(range_start >= 1 and range_end >= range_start\)/i);
  });

  it("forbids overlapping ranges in the same scope via a gist EXCLUDE constraint", () => {
    expect(seriesCode).toMatch(/create extension if not exists btree_gist/i);
    expect(seriesCode).toMatch(/exclude using gist/i);
    expect(seriesCode).toMatch(/int4range\(range_start, range_end, '\[\]'\) with &&/i);
    expect(seriesCode).toMatch(/coalesce\(company_legacy_id, '__GLOBAL__'\)\) with =/i);
  });

  it("exposes atomic, SECURITY DEFINER configure/generate/validate RPCs", () => {
    expect(seriesCode).toMatch(/create or replace function public\.configure_article_number_series/i);
    expect(seriesCode).toMatch(/create or replace function public\.generate_article_number/i);
    expect(seriesCode).toMatch(/create or replace function public\.validate_manual_article_number/i);
    expect(seriesCode).toMatch(/security definer/i);
    // generate locks the row and advances strictly forward.
    expect(seriesCode).toMatch(/for update/i);
    expect(seriesCode).toMatch(/set next_value = v_issued \+ 1/i);
  });

  it("locks the range start once numbers have been issued", () => {
    expect(seriesCode).toMatch(/start of this series is locked/i);
    expect(seriesCode).toMatch(/next_value > v_existing\.range_start/i);
  });

  it("generates the next FREE value, skipping numbers already used in scope", () => {
    expect(seriesCode).toMatch(/from generate_series\(v_series\.next_value, v_series\.range_end\)/i);
    expect(seriesCode).toMatch(/s\.article_number = n::text/i);
    expect(seriesCode).not.toMatch(/max\s*\(/i);
  });

  it("grants execute on the allocator RPCs to authenticated users", () => {
    expect(seriesCode).toMatch(/grant execute on function public\.generate_article_number\(text, text, text\) to authenticated/i);
    expect(seriesCode).toMatch(/grant execute on function public\.validate_manual_article_number/i);
  });

  it("keeps the series durable through the standard test-data cleanup", () => {
    expect(resetToolingSource).not.toMatch(/article_number_series/i);
  });
});
