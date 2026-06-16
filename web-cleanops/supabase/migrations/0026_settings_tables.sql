-- ============================================================================
-- CleanOps — SET-1: SETTINGS tables (Settings full-wave migration)
--   settings_templates · company_settings
-- ============================================================================
--
-- The Settings domain has two stores:
--   • settings_templates — GLOBAL master data (the Super Admin governance
--     catalogue of starter settings bundles). The type carries no companyId, so
--     this mirrors service_packages (migration 0019): always-global, super-admin
--     governed, world-readable by every authenticated user.
--   • company_settings   — one COMPANY-scoped record per company (the company's
--     live settings, optionally seeded from a template). Identity is the
--     companyId itself (there is no separate id field), so `legacy_id` is the
--     app-facing company id and the record is keyed 1:1 to the company.
--
-- Both wrap a `SettingsData` blob; the FLAT columns carry only what list / RLS /
-- id-resolution need, and `data jsonb` preserves the COMPLETE record losslessly.
-- WO-5.6 `deleted_at` soft-delete convention throughout (an upsert UNDELETES).
-- ============================================================================

create or replace function set_settings_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ===========================================================================
-- 1. settings_templates  (ALWAYS global master data — company_id always null)
-- ===========================================================================
create table if not exists settings_templates (
  id                 uuid primary key default gen_random_uuid(),
  legacy_id          text unique not null,
  -- Always null: templates are global master data. Kept for symmetry.
  company_id         uuid references companies(id) on delete cascade,
  company_legacy_id  text,
  name               text not null,
  -- 'active' or 'archived' (derived from the template's archived flag).
  status             text not null default 'active',
  data               jsonb not null default '{}'::jsonb,
  deleted_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_settings_templates_name on settings_templates(name);
create index if not exists idx_settings_templates_global_active
  on settings_templates(name) where company_id is null and deleted_at is null;

drop trigger if exists trg_settings_templates_updated_at on settings_templates;
create trigger trg_settings_templates_updated_at
  before update on settings_templates
  for each row execute function set_settings_updated_at();

alter table settings_templates enable row level security;

-- Templates are shared catalog master data: every signed-in user may READ.
drop policy if exists "settings_templates_select_global" on settings_templates;
create policy "settings_templates_select_global" on settings_templates
  for select to authenticated
  using (company_id is null);

drop policy if exists "settings_templates_select_super_admin" on settings_templates;
create policy "settings_templates_select_super_admin" on settings_templates
  for select to authenticated
  using (is_super_admin());

-- WRITES: super-admin only (global master data is Super-Admin governed).
drop policy if exists "settings_templates_insert_super_admin" on settings_templates;
create policy "settings_templates_insert_super_admin" on settings_templates
  for insert to authenticated
  with check (is_super_admin());

drop policy if exists "settings_templates_update_super_admin" on settings_templates;
create policy "settings_templates_update_super_admin" on settings_templates
  for update to authenticated
  using (is_super_admin())
  with check (is_super_admin());

-- ===========================================================================
-- 2. company_settings  (one COMPANY-scoped record per company)
--    legacy_id == company_legacy_id (the record is keyed 1:1 to the company).
-- ===========================================================================
create table if not exists company_settings (
  id                 uuid primary key default gen_random_uuid(),
  -- App-facing company id; the settings record's identity (1:1 per company).
  legacy_id          text unique not null,
  company_id         uuid references companies(id) on delete cascade,
  company_legacy_id  text not null,
  -- Whether the company has completed its initial settings setup.
  initialized        boolean not null default false,
  -- Soft reference to the source SettingsTemplate (settings_templates.legacy_id).
  source_template_id text,
  data               jsonb not null default '{}'::jsonb,
  deleted_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_company_settings_company
  on company_settings(company_id) where deleted_at is null;
create index if not exists idx_company_settings_companylegacy
  on company_settings(company_legacy_id);

drop trigger if exists trg_company_settings_updated_at on company_settings;
create trigger trg_company_settings_updated_at
  before update on company_settings
  for each row execute function set_settings_updated_at();

alter table company_settings enable row level security;

drop policy if exists "company_settings_select_own_company" on company_settings;
create policy "company_settings_select_own_company" on company_settings
  for select to authenticated
  using (company_id is not null and company_id = current_company_id());

drop policy if exists "company_settings_select_super_admin" on company_settings;
create policy "company_settings_select_super_admin" on company_settings
  for select to authenticated
  using (is_super_admin());

drop policy if exists "company_settings_insert_own_company" on company_settings;
create policy "company_settings_insert_own_company" on company_settings
  for insert to authenticated
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "company_settings_insert_super_admin" on company_settings;
create policy "company_settings_insert_super_admin" on company_settings
  for insert to authenticated
  with check (is_super_admin());

drop policy if exists "company_settings_update_own_company" on company_settings;
create policy "company_settings_update_own_company" on company_settings
  for update to authenticated
  using (company_id is not null and company_id = current_company_id())
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "company_settings_update_super_admin" on company_settings;
create policy "company_settings_update_super_admin" on company_settings
  for update to authenticated
  using (is_super_admin())
  with check (is_super_admin());

-- NOTE: no DELETE policy on any table — removal is a soft-delete UPDATE.
