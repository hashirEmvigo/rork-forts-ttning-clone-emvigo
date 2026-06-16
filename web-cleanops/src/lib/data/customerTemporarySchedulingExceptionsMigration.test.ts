import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationPath = path.resolve(
  __dirname,
  "../../../supabase/migrations/0037_customer_temporary_scheduling_exceptions.sql",
);
const migrationSql = readFileSync(migrationPath, "utf8");

function stripSqlComments(sql: string): string {
  return sql
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .toLowerCase();
}

const executableSql = stripSqlComments(migrationSql);

describe("customer_temporary_scheduling_exceptions migration", () => {
  it("creates only the canonical customer-scoped temporary exceptions table", () => {
    expect(migrationSql).toContain("create table if not exists customer_temporary_scheduling_exceptions");
    expect(migrationSql).not.toMatch(/create table if not exists\s+temporary_scheduling_exceptions\b/i);
  });

  it("defines the approved schema columns and Supabase-only timestamp defaults", () => {
    const requiredColumns = [
      "id uuid primary key default gen_random_uuid()",
      "company_id uuid not null references companies(id) on delete cascade",
      "customer_id uuid not null references customers(id) on delete cascade",
      "source text not null",
      "status text not null default 'submitted'",
      "start_date date not null",
      "end_date date not null",
      "windows jsonb not null default '[]'::jsonb",
      "reason_code text not null",
      "customer_note text",
      "admin_note text",
      "created_by_actor_type text not null",
      "created_by_user_id uuid",
      "created_by_customer_id uuid",
      "client_request_id text",
      "created_at timestamptz not null default now()",
      "updated_at timestamptz not null default now()",
      "cancelled_at timestamptz",
      "cancelled_by_actor_type text",
      "cancelled_by_user_id uuid",
      "cancelled_by_customer_id uuid",
      "reviewed_at timestamptz",
      "reviewed_by_user_id uuid",
    ];

    for (const column of requiredColumns) {
      expect(migrationSql).toContain(column);
    }
  });

  it("does not alter the existing customers table and keeps tenant consistency in admin insert checks", () => {
    expect(migrationSql).not.toContain("customers_id_company_unique");
    expect(executableSql).not.toMatch(/alter\s+table\s+customers\b/);
    expect(migrationSql).toContain("references customers(id) on delete cascade");
    expect(migrationSql).toContain("from customers c");
    expect(migrationSql).toContain("c.id = customer_temporary_scheduling_exceptions.customer_id");
    expect(migrationSql).toContain("c.company_id = customer_temporary_scheduling_exceptions.company_id");
  });

  it("enforces allowed workflow, source, actor, reason, and date values", () => {
    expect(migrationSql).toContain("constraint ctse_status_check");
    expect(migrationSql).toContain("status in ('submitted', 'accepted_for_planning', 'cancelled')");
    expect(migrationSql).toContain("source in ('admin_console', 'customer_portal', 'system')");
    expect(migrationSql).toContain("created_by_actor_type in ('admin', 'customer', 'system')");
    expect(migrationSql).toContain("cancelled_by_actor_type in ('admin', 'customer', 'system')");
    expect(migrationSql).toContain("'customer_away'");
    expect(migrationSql).toContain("'temporary_access_change'");
    expect(migrationSql).toContain("'temporary_time_preference'");
    expect(migrationSql).toContain("'holiday_period'");
    expect(migrationSql).toContain("'building_access'");
    expect(migrationSql).toContain("'other'");
    expect(migrationSql).toContain("constraint ctse_date_range_check");
    expect(migrationSql).toContain("check (end_date >= start_date)");
  });

  it("enforces cancellation, review, actor, and idempotency consistency", () => {
    expect(migrationSql).toContain("constraint ctse_cancelled_state_check");
    expect(migrationSql).toContain("status = 'cancelled'");
    expect(migrationSql).toContain("cancelled_at is not null");
    expect(migrationSql).toContain("status <> 'cancelled'");
    expect(migrationSql).toContain("cancelled_at is null");
    expect(migrationSql).toContain("constraint ctse_review_consistency_check");
    expect(migrationSql).toContain("status <> 'accepted_for_planning'");
    expect(migrationSql).toContain("reviewed_at is not null and reviewed_by_user_id is not null");
    expect(migrationSql).toContain("constraint ctse_created_actor_consistency_check");
    expect(migrationSql).toContain("created_by_actor_type = 'customer' and created_by_customer_id is not null");
    expect(migrationSql).toContain("created_by_actor_type = 'admin' and created_by_user_id is not null");
    expect(migrationSql).toContain("constraint ctse_client_request_id_not_blank_check");
  });

  it("validates the windows JSON contract at database level", () => {
    expect(migrationSql).toContain("create or replace function customer_temporary_scheduling_windows_are_valid");
    expect(migrationSql).toContain("jsonb_typeof(windows) <> 'array'");
    expect(migrationSql).toContain("item ? 'start_time'");
    expect(migrationSql).toContain("item ? 'end_time'");
    expect(migrationSql).toContain("^([01][0-9]|2[0-3]):[0-5][0-9]$");
    expect(migrationSql).toContain("(item ->> 'start_time') >= (item ->> 'end_time')");
    expect(migrationSql).toContain("a.value ->> 'start_time') < (b.value ->> 'end_time')");
    expect(migrationSql).toContain("constraint ctse_windows_valid_check");
  });

  it("uses server-side overlap enforcement with GiST and excludes cancelled rows", () => {
    expect(migrationSql).toContain("create extension if not exists btree_gist");
    expect(migrationSql).toContain("constraint ctse_no_overlapping_active_ranges");
    expect(migrationSql).toContain("exclude using gist");
    expect(migrationSql).toContain("company_id with =");
    expect(migrationSql).toContain("customer_id with =");
    expect(migrationSql).toContain("daterange(start_date, end_date + 1, '[)') with &&");
    expect(migrationSql).toContain("where (status <> 'cancelled')");
  });

  it("adds lookup, review queue, date-range, portal-list, idempotency, and updated_at indexes/triggers", () => {
    expect(migrationSql).toContain("idx_ctse_company_customer_start");
    expect(migrationSql).toContain("idx_ctse_company_date_range");
    expect(migrationSql).toContain("idx_ctse_company_status_created");
    expect(migrationSql).toContain("idx_ctse_review_queue");
    expect(migrationSql).toContain("idx_ctse_customer_portal_list");
    expect(migrationSql).toContain("idx_ctse_idempotency");
    expect(migrationSql).toContain("company_id, customer_id, source, client_request_id");
    expect(migrationSql).toContain("where client_request_id is not null");
    expect(migrationSql).toContain("set_customer_temporary_scheduling_exceptions_updated_at");
    expect(migrationSql).toContain("trg_ctse_updated_at");
  });

  it("enables admin-scoped SELECT/INSERT RLS and intentionally defers customer portal policies", () => {
    expect(migrationSql).toContain("alter table customer_temporary_scheduling_exceptions enable row level security");
    expect(migrationSql).toContain("ctse_select_company_admin");
    expect(migrationSql).toContain("ctse_select_super_admin");
    expect(migrationSql).toContain("ctse_insert_company_admin");
    expect(migrationSql).toContain("ctse_insert_super_admin");
    expect(migrationSql).toContain("current_base_role() = 'company_admin'");
    expect(migrationSql).toContain("company_id = current_company_id()");
    expect(migrationSql).toContain("source = 'admin_console'");
    expect(migrationSql).toContain("status = 'submitted'");
    expect(migrationSql).toContain("created_by_actor_type = 'admin'");
    expect(migrationSql).toContain("created_by_user_id = auth.uid()");
    expect(migrationSql).not.toMatch(/ctse_(select|insert|update|delete)_customer/i);
    expect(migrationSql).not.toMatch(/source\s*=\s*'customer_portal'/i);
  });

  it("blocks review/cancel mutation and hard delete by omitting update and delete policies", () => {
    expect(migrationSql).toContain("no UPDATE policy on purpose");
    expect(migrationSql).toContain("no DELETE policy on purpose");
    expect(migrationSql).not.toContain("ctse_update_company_admin");
    expect(migrationSql).not.toContain("ctse_update_super_admin");
    expect(executableSql).not.toMatch(/create\s+policy[\s\S]*for\s+update/);
    expect(executableSql).not.toMatch(/create\s+policy[\s\S]*for\s+delete/);
  });

  it("does not seed rows, localStorage, or dirty-browser fallback data", () => {
    expect(executableSql).not.toMatch(/insert\s+into\s+customer_temporary_scheduling_exceptions/);
    expect(executableSql).not.toContain("localstorage");
    expect(executableSql).not.toContain("localbackout");
    expect(executableSql).not.toContain("backout bridge");
    expect(executableSql).not.toContain("offline queue");
  });

  it("does not mutate adjacent runtime or execution domains", () => {
    const forbiddenTables = [
      "booking_queue",
      "work_order_service_rows",
      "work_order_occurrence_exceptions",
      "mission_log_entries",
      "mission_staff_sessions",
      "mission_log_events",
      "time_reports",
      "time_allocations",
    ];

    for (const table of forbiddenTables) {
      expect(executableSql).not.toMatch(new RegExp(`\\b(insert\\s+into|update|delete\\s+from|alter\\s+table)\\s+${table}\\b`));
    }
  });
});
