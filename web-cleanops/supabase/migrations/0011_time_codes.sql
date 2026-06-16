-- ============================================================================
-- CleanOps — Time Codes (payroll foundation)
-- ============================================================================
--
-- Introduces the platform-level Time Code entity that powers future payroll
-- reports, salary-basis exports, Fortnox Payroll, PAXml exports and
-- attendance/absence reporting. Time Codes are a REUSABLE PLATFORM COMPONENT,
-- not a free-text field on a service.
--
-- IMPORTANT — status (infrastructure only):
--   * The app STILL runs on localStorage (src/lib/timeCodeStore.ts is the live
--     source of truth; the master library is seeded there). Nothing in the UI
--     reads or writes through this table yet. This migration establishes the
--     forward-compatible schema so later payroll-export work never has to break
--     migrations to add ownership or company-specific codes.
--
-- OWNERSHIP MODEL — global + company (future), one table:
--   * company_id IS NULL  → a GLOBAL master code owned by the Super Admin
--                           (the `global_time_codes` library). system_managed
--                           seeded codes live here.
--   * company_id NOT NULL → a COMPANY-SPECIFIC custom code (the future
--                           `company_time_codes` library). Supported by the
--                           schema now; not authored in this phase.
--   Two partial unique indexes keep `code` unique within each scope without a
--   nullable-column composite-unique pitfall.
--
-- legacy_id:
--   The app-facing time-code id from localStorage (e.g. 'tc_ab12cd'); the
--   migration key, mirroring the customers/work-orders convention.
-- ============================================================================

create table if not exists time_codes (
  id                 uuid primary key default gen_random_uuid(),
  -- App-facing time-code id from localStorage; migration key.
  legacy_id          text unique not null,
  -- NULL = global master code (Super Admin). Non-null = company-specific (future).
  company_id         uuid references companies(id) on delete cascade,
  -- App-facing company id (e.g. 'cmp_nordlys') when company-scoped; NULL when global.
  company_legacy_id  text,
  code               text not null,
  name               text not null,
  -- 'attendance' (worked/travel) or 'absence' (vacation/sick/VAB/parental).
  type               text not null,
  description        text,
  active             boolean not null default true,
  -- Seeded master codes: deactivatable, never deletable.
  system_managed     boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint time_codes_type_check check (type in ('attendance', 'absence'))
);

-- `code` is unique within its scope. Partial indexes handle the NULL company_id
-- (global) scope and the per-company scope independently.
create unique index if not exists time_codes_global_code_key
  on time_codes (lower(code))
  where company_id is null;

create unique index if not exists time_codes_company_code_key
  on time_codes (company_id, lower(code))
  where company_id is not null;

create index if not exists time_codes_company_idx on time_codes (company_id);
create index if not exists time_codes_active_idx on time_codes (active);

-- ----------------------------------------------------------------------------
-- Service → Time Code reference (forward-compatible).
--   Services are not yet a Supabase table; when they migrate, the service row
--   should carry `time_code_id uuid references time_codes(id)` (set null on
--   delete is NOT used — codes referenced by historical data are deactivated,
--   never deleted, so the reference always resolves). The denormalised text
--   `time_code` label is kept in sync app-side for search/export.
-- ----------------------------------------------------------------------------

-- Row Level Security: global codes are readable by every authenticated user;
-- company codes are readable only within their tenant. Writes to the master
-- library are restricted to the platform (Super Admin) and handled out-of-band
-- in this phase.
alter table time_codes enable row level security;

drop policy if exists time_codes_read on time_codes;
create policy time_codes_read on time_codes
  for select
  to authenticated
  using (
    company_id is null
    or company_id = (select company_id from profiles where id = auth.uid())
  );
