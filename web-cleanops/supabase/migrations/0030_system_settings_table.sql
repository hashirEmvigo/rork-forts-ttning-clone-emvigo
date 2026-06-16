-- ============================================================================
-- CleanOps — SYSSET-1: SYSTEM_SETTINGS table (System Settings full-wave migration)
-- ============================================================================
--
-- The platform-level (Master Admin) configuration record. Until now the whole
-- installation's global settings lived ONLY in localStorage (cleanops.systemSettings,
-- a single blob) and were read everywhere (the entitlement resolver, the booking
-- generation horizon, the Preferred Time Evaluation master gate) — a real
-- source-of-truth dependency and the LONE remaining in-scope gap keeping the
-- Super Admin area "partial".
--
-- DATA MODEL — a SINGLETON global record:
--   There is exactly ONE system-settings record for the entire installation
--   (the type carries no companyId). So this is the simplest possible shape: a
--   single row keyed by a constant `legacy_id` ('global'). The FLAT columns carry
--   only what list / id-resolution need; `data jsonb` preserves the COMPLETE
--   SystemSettings record losslessly (booking horizon, PTE master gate,
--   entitlement resolver mode + shadow-log flag, updatedAt).
--
-- SCOPE & RLS:
--   * anon   — NO access (real operational config).
--   * READ   — EVERY signed-in user may read the single global record. The PTE
--              master gate + entitlement-resolver mode are consumed by company
--              admins app-wide, so reads are world-readable (mirrors the
--              settings_templates global-read convention), not super-admin only.
--   * WRITE  — super_admin only (platform configuration is Master-Admin governed).
--   * No DELETE policy — there is never a delete; updates only (an upsert
--     UNDELETES via the deleted_at convention kept for symmetry, though the
--     singleton is never soft-deleted in practice).
-- ============================================================================

create or replace function set_system_settings_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists system_settings (
  id                 uuid primary key default gen_random_uuid(),
  -- Constant app-facing id for the singleton ('global'); idempotent upsert key.
  legacy_id          text unique not null,
  -- Always null: system settings are platform-global. Kept for symmetry.
  company_id         uuid references companies(id) on delete cascade,
  company_legacy_id  text,
  -- Lossless full SystemSettings record (booking horizon, PTE gate, resolver, ...).
  data               jsonb not null default '{}'::jsonb,
  deleted_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

drop trigger if exists trg_system_settings_updated_at on system_settings;
create trigger trg_system_settings_updated_at
  before update on system_settings
  for each row execute function set_system_settings_updated_at();

alter table system_settings enable row level security;

-- READ: the single global record is world-readable by every authenticated user
-- (the PTE master gate + resolver mode are consumed app-wide).
drop policy if exists "system_settings_select_global" on system_settings;
create policy "system_settings_select_global" on system_settings
  for select to authenticated
  using (company_id is null);

drop policy if exists "system_settings_select_super_admin" on system_settings;
create policy "system_settings_select_super_admin" on system_settings
  for select to authenticated
  using (is_super_admin());

-- WRITES: super-admin only (platform configuration is Master-Admin governed).
drop policy if exists "system_settings_insert_super_admin" on system_settings;
create policy "system_settings_insert_super_admin" on system_settings
  for insert to authenticated
  with check (is_super_admin());

drop policy if exists "system_settings_update_super_admin" on system_settings;
create policy "system_settings_update_super_admin" on system_settings
  for update to authenticated
  using (is_super_admin())
  with check (is_super_admin());

-- NOTE: no DELETE policy on purpose — system settings are never removed, only
-- updated (the singleton always exists).
