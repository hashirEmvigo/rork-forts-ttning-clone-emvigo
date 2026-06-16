-- ============================================================================
-- CleanOps — NAVIGATION & MENU REGISTRY (Slice 11A): menu presentation overrides
-- ============================================================================
--
-- PURPOSE
--   The CUSTOMIZATION LAYER for the Navigation & Menu Registry. The stable
--   technical registry (menu key / route / section / permission / default
--   label+icon / role context) lives in source
--   (src/lib/navigation/navigationRegistry.ts) and is NEVER user-editable.
--   This table stores ONLY the presentation overrides a Super Admin may set:
--     • custom_label   — optional renamed label
--     • custom_icon    — optional icon key (from the controlled icon set only)
--     • sort_order     — optional ordering override
--     • is_visible     — presentation-only show/hide
--
-- SECURITY (authoritative permission model is unchanged)
--   This is presentation only. It can NEVER grant or remove access — the
--   permission system + RLS stay authoritative. Hiding an item only removes it
--   from the UI; routes and their permission checks are untouched. Therefore
--   there is no route/permission/menu_key WRITE here — those live in source.
--
-- SCOPE (MVP = system-level Super-Admin overrides)
--   One override row per menu_key at the system scope (company_id IS NULL). The
--   company columns are kept for the documented Phase-2 per-company path so that
--   becomes a policy/uniqueness change, not a schema rewrite. No DELETE — "reset
--   to default" neutralises the row (NULLs + is_visible=true), never a hard
--   delete.
--
-- RLS (MVP): super_admin only for SELECT/INSERT/UPDATE. The only live consumer
--   this slice is the Super-Admin-only Calculator tabs + the Super-Admin
--   Navigation settings surface, so super-admin-only reads are correct for now.
--   Phase 2 (broader reads for Customer Card / Main Nav consumption) is a pure
--   policy add (see end of file) — no schema change.
--
-- IDEMPOTENT: create-if-not-exists table, add-if-not-exists columns, and
--   drop/create policies, so re-running is a safe no-op.
-- ============================================================================

create or replace function set_navigation_menu_overrides_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists navigation_menu_overrides (
  id                 uuid primary key default gen_random_uuid(),
  -- Stable registry menu key (e.g. "calculator.pricing"); the override join key.
  menu_key           text not null unique,
  -- Presentation overrides (all optional; NULL = use the registry default).
  custom_label       text,
  custom_icon        text,
  sort_order         integer,
  is_visible         boolean not null default true,
  -- Forward-compatible scope columns (MVP rows are system-level: company_id NULL).
  scope_type         text not null default 'system' check (scope_type in ('system', 'company')),
  company_id         uuid references companies(id) on delete cascade,
  company_legacy_id  text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Defensive add-if-not-exists (cross-environment parse safety on re-run).
alter table navigation_menu_overrides add column if not exists custom_label text;
alter table navigation_menu_overrides add column if not exists custom_icon text;
alter table navigation_menu_overrides add column if not exists sort_order integer;
alter table navigation_menu_overrides add column if not exists is_visible boolean not null default true;
alter table navigation_menu_overrides add column if not exists scope_type text not null default 'system';
alter table navigation_menu_overrides add column if not exists company_id uuid references companies(id) on delete cascade;
alter table navigation_menu_overrides add column if not exists company_legacy_id text;

create index if not exists idx_navigation_menu_overrides_scope
  on navigation_menu_overrides (scope_type, company_legacy_id);

drop trigger if exists trg_navigation_menu_overrides_updated_at on navigation_menu_overrides;
create trigger trg_navigation_menu_overrides_updated_at
  before update on navigation_menu_overrides
  for each row execute function set_navigation_menu_overrides_updated_at();

alter table navigation_menu_overrides enable row level security;

-- READ: super_admin only (MVP). Calculator tabs + Navigation settings are
-- Super-Admin-only surfaces this slice.
drop policy if exists "navigation_menu_overrides_select_super_admin" on navigation_menu_overrides;
create policy "navigation_menu_overrides_select_super_admin" on navigation_menu_overrides
  for select to authenticated using (is_super_admin());

-- WRITE: super_admin only (platform menu config is Master-Admin governed).
drop policy if exists "navigation_menu_overrides_insert_super_admin" on navigation_menu_overrides;
create policy "navigation_menu_overrides_insert_super_admin" on navigation_menu_overrides
  for insert to authenticated with check (is_super_admin());

drop policy if exists "navigation_menu_overrides_update_super_admin" on navigation_menu_overrides;
create policy "navigation_menu_overrides_update_super_admin" on navigation_menu_overrides
  for update to authenticated using (is_super_admin()) with check (is_super_admin());

-- NOTE: no DELETE policy on purpose — "reset to default" neutralises the row
-- (NULL overrides + is_visible=true), never a hard delete.

-- ── PHASE 2 (broader read consumption / per-company overrides) — NOT ENABLED ──
-- When Customer Card / Main Navigation start CONSUMING overrides for non-super
-- roles, add a read policy for the system scope (presentation only, still
-- permission-gated in the UI):
--   create policy "navigation_menu_overrides_select_system" on navigation_menu_overrides
--     for select to authenticated using (scope_type = 'system' and company_id is null);
-- Per-company overrides would switch the unique key to (menu_key, scope_type,
-- coalesce(company_legacy_id,'__system__')) and add own-company write policies.
