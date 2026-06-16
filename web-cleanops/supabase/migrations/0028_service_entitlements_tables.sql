-- ============================================================================
-- CleanOps — ENT-1: SERVICE ENTITLEMENTS tables (Entitlements / Packages wave)
--   service_global_entitlements · company_service_entitlements ·
--   service_entitlement_log
-- ============================================================================
--
-- The paid-add-on entitlement backbone — the Super Admin governance data that
-- decides which optional services/features a company may use. Until now this
-- lived ONLY in localStorage (cleanops.serviceGlobalEntitlements /
-- companyServiceEntitlements / serviceEntitlementLog) and was a real
-- source-of-truth dependency surfaced under Super Admin. This wave moves it
-- onto Supabase so entitlement decisions are consistent across devices.
--
-- THREE distinct shapes → THREE tables (same flat-columns + `data jsonb`
-- convention as services 0018 / roles 0022):
--
--   1. service_global_entitlements — platform-wide availability per service key.
--      GLOBAL master data (no company). legacy_id = the service key. Readable by
--      every authenticated user (a feature's global gate is shared, like the
--      service catalog); writes are super-admin only.
--
--   2. company_service_entitlements — per-company access record (tri-state:
--      disabled / trial / enabled). Company-scoped + super_admin. The synthetic
--      legacy_id is `${companyId}::${serviceKey}` so the upsert key is stable.
--
--   3. service_entitlement_log — immutable append-only billing/support trail.
--      legacy_id = the log entry id. company_id is NULL for platform-wide
--      (global) changes. INSERT-only: no update/delete policies, no soft-delete.
--
-- legacy_id is the migration upsert key everywhere. The WO-5.6 `deleted_at`
-- soft-delete convention applies to the two MUTABLE tables (an upsert always
-- UNDELETES); the immutable log has no deleted_at.
--
-- All RLS checks go through the SECURITY DEFINER helpers from
-- 0003_profiles_auth_foundation.sql (current_company_id / is_super_admin).
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- Shared updated_at trigger fn (reused by the two mutable tables).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function set_service_entitlements_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ===========================================================================
-- 1. service_global_entitlements  (GLOBAL master data — no company)
-- ===========================================================================
create table if not exists service_global_entitlements (
  id           uuid primary key default gen_random_uuid(),
  -- App-facing key = the ServiceFeatureKey; migration upsert key.
  legacy_id    text unique not null,
  service_key  text not null,
  enabled      boolean not null default false,
  -- Lossless full ServiceGlobalEntitlement record (updatedBy, updatedAt, ...).
  data         jsonb not null default '{}'::jsonb,
  deleted_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_sge_service_key on service_global_entitlements(service_key);
create index if not exists idx_sge_active
  on service_global_entitlements(service_key) where deleted_at is null;

drop trigger if exists trg_sge_updated_at on service_global_entitlements;
create trigger trg_sge_updated_at
  before update on service_global_entitlements
  for each row execute function set_service_entitlements_updated_at();

alter table service_global_entitlements enable row level security;

-- READ: every authenticated user (a global feature gate is shared platform data).
drop policy if exists "sge_select_all" on service_global_entitlements;
create policy "sge_select_all" on service_global_entitlements
  for select to authenticated
  using (true);

-- INSERT/UPDATE: super admin only (platform governance).
drop policy if exists "sge_insert_super_admin" on service_global_entitlements;
create policy "sge_insert_super_admin" on service_global_entitlements
  for insert to authenticated
  with check (is_super_admin());

drop policy if exists "sge_update_super_admin" on service_global_entitlements;
create policy "sge_update_super_admin" on service_global_entitlements
  for update to authenticated
  using (is_super_admin())
  with check (is_super_admin());

-- ===========================================================================
-- 2. company_service_entitlements  (per-company access — tri-state)
-- ===========================================================================
create table if not exists company_service_entitlements (
  id                 uuid primary key default gen_random_uuid(),
  -- Synthetic upsert key `${companyId}::${serviceKey}`.
  legacy_id          text unique not null,
  company_id         uuid references companies(id) on delete cascade,
  company_legacy_id  text not null,
  service_key        text not null,
  -- Tri-state status (disabled / trial / enabled); flat for fast filtering.
  status             text not null default 'disabled',
  enabled            boolean not null default false,
  -- Lossless full CompanyServiceEntitlement record (timestamps, updatedBy, ...).
  data               jsonb not null default '{}'::jsonb,
  deleted_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_cse_company on company_service_entitlements(company_id);
create index if not exists idx_cse_companylegacy_key
  on company_service_entitlements(company_legacy_id, service_key);
create index if not exists idx_cse_active
  on company_service_entitlements(company_id) where deleted_at is null;

drop trigger if exists trg_cse_updated_at on company_service_entitlements;
create trigger trg_cse_updated_at
  before update on company_service_entitlements
  for each row execute function set_service_entitlements_updated_at();

alter table company_service_entitlements enable row level security;

-- READ: own company (a company may read its own access state) + super admin.
drop policy if exists "cse_select_own_company" on company_service_entitlements;
create policy "cse_select_own_company" on company_service_entitlements
  for select to authenticated
  using (company_id is not null and company_id = current_company_id());

drop policy if exists "cse_select_super_admin" on company_service_entitlements;
create policy "cse_select_super_admin" on company_service_entitlements
  for select to authenticated
  using (is_super_admin());

-- INSERT/UPDATE: super admin only (entitlement is granted by the Super Admin;
-- the in-browser migration utility populates the shadow copy under this policy).
drop policy if exists "cse_insert_super_admin" on company_service_entitlements;
create policy "cse_insert_super_admin" on company_service_entitlements
  for insert to authenticated
  with check (is_super_admin());

drop policy if exists "cse_update_super_admin" on company_service_entitlements;
create policy "cse_update_super_admin" on company_service_entitlements
  for update to authenticated
  using (is_super_admin())
  with check (is_super_admin());

-- ===========================================================================
-- 3. service_entitlement_log  (immutable append-only trail)
-- ===========================================================================
create table if not exists service_entitlement_log (
  id                 uuid primary key default gen_random_uuid(),
  -- App-facing log entry id; migration upsert key (idempotent re-import).
  legacy_id          text unique not null,
  service_key        text not null,
  -- NULL for platform-wide (global) changes.
  company_id         uuid references companies(id) on delete cascade,
  company_legacy_id  text,
  action             text not null,
  -- Lossless full ServiceEntitlementLogEntry record.
  data               jsonb not null default '{}'::jsonb,
  changed_at         timestamptz not null default now(),
  created_at         timestamptz not null default now()
);

create index if not exists idx_sel_company_changed
  on service_entitlement_log(company_id, changed_at desc);
create index if not exists idx_sel_service_changed
  on service_entitlement_log(service_key, changed_at desc);

alter table service_entitlement_log enable row level security;

-- READ: own company's entries + the platform-wide (company_id null) entries,
-- plus super admin → all.
drop policy if exists "sel_select_own_company" on service_entitlement_log;
create policy "sel_select_own_company" on service_entitlement_log
  for select to authenticated
  using (company_id is not null and company_id = current_company_id());

drop policy if exists "sel_select_global" on service_entitlement_log;
create policy "sel_select_global" on service_entitlement_log
  for select to authenticated
  using (company_id is null);

drop policy if exists "sel_select_super_admin" on service_entitlement_log;
create policy "sel_select_super_admin" on service_entitlement_log
  for select to authenticated
  using (is_super_admin());

-- INSERT: super admin only (append-only). No UPDATE/DELETE policies → the trail
-- is immutable for everyone under RLS.
drop policy if exists "sel_insert_super_admin" on service_entitlement_log;
create policy "sel_insert_super_admin" on service_entitlement_log
  for insert to authenticated
  with check (is_super_admin());
