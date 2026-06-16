-- ============================================================================
-- CleanOps — Payroll Export (architecture foundation)
-- ============================================================================
--
-- Establishes the forward-compatible schema for the modular, ADAPTER-BASED
-- payroll export layer that builds on top of Time Codes (migration 0011). It is
-- deliberately format-agnostic: nothing here hardcodes Fortnox/PAXml/Visma/Hogia.
-- New export targets are added by registering an adapter + entitlement key in the
-- app, never by reshaping these tables.
--
-- IMPORTANT — status (infrastructure only):
--   * The app STILL runs on localStorage (src/lib/payrollExportStore.ts is the
--     live source of truth). Nothing in the UI reads/writes through these tables
--     yet. This migration exists so later payroll-export work never has to break
--     migrations to add columns/ownership.
--
-- legacy_id:
--   The app-facing id from localStorage (e.g. 'pep_ab12cd'); the migration key,
--   mirroring the customers/work-orders/time-codes convention.
-- ============================================================================

-- ── Export capabilities (Super Admin → company activation) ───────────────────
-- One row per (company, target). Presence with enabled = true means the company
-- may create/configure profiles for that target. Gated entirely by the Super
-- Admin; company admins only ever see enabled targets.
create table if not exists payroll_export_capabilities (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  -- App-facing company id (e.g. 'cmp_nordlys'); migration convenience.
  company_legacy_id text,
  -- 'csv' | 'excel' | 'paxml' | 'fortnox' | 'visma' | 'hogia'
  --       | 'api' | 'sftp' | 'webhook' | 'custom'
  target       text not null,
  enabled      boolean not null default false,
  enabled_at   timestamptz,
  updated_by   text,
  updated_at   timestamptz not null default now(),

  constraint payroll_export_capabilities_target_check check (
    target in ('csv','excel','paxml','fortnox','visma','hogia','api','sftp','webhook','custom')
  ),
  constraint payroll_export_capabilities_unique unique (company_id, target)
);

create index if not exists payroll_export_capabilities_company_idx
  on payroll_export_capabilities (company_id);

-- ── Export profiles (company-specific setup) ─────────────────────────────────
-- WHERE + WHAT FORMAT a basis is exported. Secrets are NEVER stored here — only a
-- credentials_ref pointing at a future secrets store (Vault/KMS handle).
create table if not exists payroll_export_profiles (
  id              uuid primary key default gen_random_uuid(),
  legacy_id       text unique not null,
  company_id      uuid not null references companies(id) on delete cascade,
  company_legacy_id text,
  name            text not null,
  target          text not null,
  active          boolean not null default true,
  -- Non-secret configuration metadata (delimiter, endpoint path, mapping, …).
  config          jsonb not null default '{}'::jsonb,
  -- Opaque reference to externally-stored credentials (NOT the secret itself).
  credentials_ref text,
  created_by      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint payroll_export_profiles_target_check check (
    target in ('csv','excel','paxml','fortnox','visma','hogia','api','sftp','webhook','custom')
  )
);

create index if not exists payroll_export_profiles_company_idx
  on payroll_export_profiles (company_id);

-- ── Export runs (immutable attempt history) ──────────────────────────────────
-- One row per export attempt, for audit/observability. result_ref points at a
-- generated file reference or API response reference — never the raw payload.
create table if not exists payroll_export_runs (
  id            uuid primary key default gen_random_uuid(),
  legacy_id     text unique not null,
  company_id    uuid not null references companies(id) on delete cascade,
  company_legacy_id text,
  profile_id    uuid references payroll_export_profiles(id) on delete set null,
  profile_legacy_id text,
  -- The basis that was exported (basis tables arrive with payroll calculation).
  basis_legacy_id text,
  -- 'pending' | 'success' | 'partial' | 'failed'
  status        text not null,
  user_id       text,
  rows_included integer not null default 0,
  warnings      jsonb not null default '[]'::jsonb,
  errors        jsonb not null default '[]'::jsonb,
  result_ref    text,
  created_at    timestamptz not null default now(),

  constraint payroll_export_runs_status_check check (
    status in ('pending','success','partial','failed')
  )
);

create index if not exists payroll_export_runs_company_idx
  on payroll_export_runs (company_id);
create index if not exists payroll_export_runs_profile_idx
  on payroll_export_runs (profile_id);

-- NOTE — PayrollBasis is intentionally NOT created here. Full payroll calculation
-- is out of scope for this phase; the internal basis is modelled app-side
-- (src/types) and its table will land with the calculation work, referenced by
-- payroll_export_runs.basis_legacy_id above.

-- ── Row Level Security ───────────────────────────────────────────────────────
-- Company-scoped reads for all three tables. Capability writes are restricted to
-- the platform (Super Admin) and handled out-of-band in this phase.
alter table payroll_export_capabilities enable row level security;
alter table payroll_export_profiles     enable row level security;
alter table payroll_export_runs          enable row level security;

drop policy if exists payroll_export_capabilities_read on payroll_export_capabilities;
create policy payroll_export_capabilities_read on payroll_export_capabilities
  for select to authenticated
  using (company_id = (select company_id from profiles where id = auth.uid()));

drop policy if exists payroll_export_profiles_read on payroll_export_profiles;
create policy payroll_export_profiles_read on payroll_export_profiles
  for select to authenticated
  using (company_id = (select company_id from profiles where id = auth.uid()));

drop policy if exists payroll_export_runs_read on payroll_export_runs;
create policy payroll_export_runs_read on payroll_export_runs
  for select to authenticated
  using (company_id = (select company_id from profiles where id = auth.uid()));
