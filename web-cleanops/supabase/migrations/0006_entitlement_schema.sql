-- ============================================================================
-- CleanOps — Phase 1: ENTITLEMENT SCHEMA (empty tables, RLS, constraints, idx)
-- ============================================================================
--
-- Goal of Phase 1:
--   Create the Supabase data model for the bundle-first entitlement system as
--   locked in the Phase 2 data-model specification. This migration is purely
--   ADDITIVE and BEHAVIOUR-NEUTRAL:
--
--     * Creates the seven entitlement tables EMPTY (no seed rows).
--     * Adds constraints, indexes, and RLS policies.
--     * Does NOT migrate any data.
--     * Does NOT wire any application reads/writes.
--     * Does NOT change resolver behaviour.
--
--   Nothing in the app reads or writes these tables yet, so existing behaviour
--   is unchanged. The code-owned registry remains the single source of truth
--   for feature/limit *definitions*; these tables store *values* only.
--
-- DESIGN RULE (locked):
--   The database stores VALUES, never DEFINITIONS. `service_key`, `limit_key`,
--   and merge semantics are validated against the code registry at write/resolve
--   time in the app/edge layer. Postgres stores them as `text` (NOT enums) so the
--   registry stays code-owned and version-controlled. Foreign keys only point at
--   rows the DB owns (companies, profiles, bundle/grant/override rows).
--
-- Depends on:
--   0002_companies_table.sql           (companies)
--   0003_profiles_auth_foundation.sql  (profiles + is_super_admin(),
--                                        current_company_id(), current_base_role())
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 0. SHARED updated_at TRIGGER FUNCTION
--    Mirrors set_profiles_updated_at() but reusable across entitlement tables.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function set_entitlement_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ===========================================================================
-- 1. entitlement_bundles — the catalogue of bundles
--    (plans, add-ons, campaign, partner, internal). One row per bundle.
-- ===========================================================================
create table if not exists entitlement_bundles (
  id                 uuid primary key default gen_random_uuid(),
  slug               text not null unique,                 -- stable human key, e.g. 'professional', 'ai_pack'
  name               text not null,
  description        text,
  bundle_type        text not null,                        -- base_plan | addon | campaign | partner | internal
  status             text not null default 'active',       -- active | archived (soft delete)
  is_assignable      boolean not null default true,        -- hide archived/internal from sales UI
  billing_provider   text,                                 -- stripe | manual | none  (optional, loosely coupled)
  billing_product_id text,                                 -- opaque provider product id
  created_by         uuid references profiles(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint entitlement_bundles_type_check
    check (bundle_type in ('base_plan', 'addon', 'campaign', 'partner', 'internal')),
  constraint entitlement_bundles_status_check
    check (status in ('active', 'archived'))
);

create index if not exists idx_entitlement_bundles_type   on entitlement_bundles(bundle_type);
create index if not exists idx_entitlement_bundles_status on entitlement_bundles(status);

drop trigger if exists trg_entitlement_bundles_updated_at on entitlement_bundles;
create trigger trg_entitlement_bundles_updated_at
  before update on entitlement_bundles
  for each row execute function set_entitlement_updated_at();

-- ===========================================================================
-- 2. entitlement_bundle_grants — which features a bundle grants + state
--    One row per (bundle × service_key).
-- ===========================================================================
create table if not exists entitlement_bundle_grants (
  id          uuid primary key default gen_random_uuid(),
  bundle_id   uuid not null references entitlement_bundles(id) on delete cascade,
  service_key text not null,                               -- validated against ServiceFeatureKey in app; no FK
  status      text not null,                               -- enabled | trial | disabled (mirrors ServiceEntitlementStatus)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint entitlement_bundle_grants_status_check
    check (status in ('enabled', 'trial', 'disabled')),
  -- A bundle states each feature at most once → deterministic grant.
  constraint uniq_bundle_grant_service unique (bundle_id, service_key)
);

create index if not exists idx_bundle_grants_bundle  on entitlement_bundle_grants(bundle_id);
create index if not exists idx_bundle_grants_service on entitlement_bundle_grants(service_key);

drop trigger if exists trg_bundle_grants_updated_at on entitlement_bundle_grants;
create trigger trg_bundle_grants_updated_at
  before update on entitlement_bundle_grants
  for each row execute function set_entitlement_updated_at();

-- ===========================================================================
-- 3. entitlement_bundle_grant_limits — relational limit values for a grant
--    e.g. maxImages = 500. (Relational rows, not JSONB — see spec §2.)
-- ===========================================================================
create table if not exists entitlement_bundle_grant_limits (
  id          uuid primary key default gen_random_uuid(),
  grant_id    uuid not null references entitlement_bundle_grants(id) on delete cascade,
  limit_key   text not null,                               -- validated against the feature's registry limit keys
  limit_value numeric,                                     -- null = "unlimited" sentinel (documented)
  value_text  text,                                        -- for enum/exclusive merge kinds (e.g. default_language='sv')
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint uniq_grant_limit_key unique (grant_id, limit_key),
  -- exactly one of numeric/text carries the value
  constraint grant_limit_value_one_of
    check (num_nonnulls(limit_value, value_text) = 1)
);

create index if not exists idx_grant_limits_grant on entitlement_bundle_grant_limits(grant_id);

drop trigger if exists trg_grant_limits_updated_at on entitlement_bundle_grant_limits;
create trigger trg_grant_limits_updated_at
  before update on entitlement_bundle_grant_limits
  for each row execute function set_entitlement_updated_at();

-- ===========================================================================
-- 4. company_bundle_assignments — which bundles a company has
--    The join the resolver loads per company. role: base | addon.
-- ===========================================================================
create table if not exists company_bundle_assignments (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  bundle_id   uuid not null references entitlement_bundles(id) on delete restrict,
  role        text not null,                               -- base | addon
  status      text not null default 'active',              -- active | cancelled
  starts_at   timestamptz not null default now(),          -- supports future-dated changes
  ends_at     timestamptz,                                 -- null = open-ended; trial/campaign end here
  assigned_by uuid references profiles(id),                -- provenance
  source      text,                                        -- manual | sales | migration | campaign | partner
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint company_bundle_assignments_role_check
    check (role in ('base', 'addon')),
  constraint company_bundle_assignments_status_check
    check (status in ('active', 'cancelled'))
);

create index if not exists idx_assignments_company_status on company_bundle_assignments(company_id, status);
create index if not exists idx_assignments_bundle         on company_bundle_assignments(bundle_id);

-- HARD invariant: at most one active, open-ended BASE plan per company.
-- Time-range overlap (future-dated swaps) is validated in the app layer (spec §3).
create unique index if not exists uniq_active_base_plan
  on company_bundle_assignments (company_id)
  where role = 'base' and status = 'active' and ends_at is null;

drop trigger if exists trg_assignments_updated_at on company_bundle_assignments;
create trigger trg_assignments_updated_at
  before update on company_bundle_assignments
  for each row execute function set_entitlement_updated_at();

-- ===========================================================================
-- 5. company_feature_overrides — sparse per-company exceptions
--    One row per (company × service_key). Exists ONLY when there's an exception.
-- ===========================================================================
create table if not exists company_feature_overrides (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  service_key text not null,                               -- app-validated
  status      text,                                        -- null = override limits only, not enabled-state
  reason      text not null,                               -- REQUIRED governance field (spec §4)
  starts_at   timestamptz not null default now(),
  ends_at     timestamptz,                                 -- forces a review date for time-boxed deals
  created_by  uuid not null references profiles(id),       -- REQUIRED provenance
  source      text,                                        -- negotiated | support | temporary | migration
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint company_feature_overrides_status_check
    check (status is null or status in ('enabled', 'trial', 'disabled'))
);

create index if not exists idx_overrides_company on company_feature_overrides(company_id);
-- service_key indexed for drift detection ("same override across N companies").
create index if not exists idx_overrides_service on company_feature_overrides(service_key);

-- At most one ACTIVE override per (company, service_key).
create unique index if not exists uniq_active_override
  on company_feature_overrides (company_id, service_key)
  where status is not null;

drop trigger if exists trg_overrides_updated_at on company_feature_overrides;
create trigger trg_overrides_updated_at
  before update on company_feature_overrides
  for each row execute function set_entitlement_updated_at();

-- ===========================================================================
-- 6. company_feature_override_limits — limit values for an override
--    Same shape as grant limits.
-- ===========================================================================
create table if not exists company_feature_override_limits (
  id          uuid primary key default gen_random_uuid(),
  override_id uuid not null references company_feature_overrides(id) on delete cascade,
  limit_key   text not null,
  limit_value numeric,
  value_text  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint uniq_override_limit_key unique (override_id, limit_key),
  constraint override_limit_value_one_of
    check (num_nonnulls(limit_value, value_text) = 1)
);

create index if not exists idx_override_limits_override on company_feature_override_limits(override_id);

drop trigger if exists trg_override_limits_updated_at on company_feature_override_limits;
create trigger trg_override_limits_updated_at
  before update on company_feature_override_limits
  for each row execute function set_entitlement_updated_at();

-- ===========================================================================
-- 7. entitlement_activity_log — append-only audit
--    Generalises ServiceEntitlementLogEntry. JSONB snapshots are read whole,
--    never queried by limit — the inverse of the live tables, so JSONB is right.
-- ===========================================================================
create table if not exists entitlement_activity_log (
  id             uuid primary key default gen_random_uuid(),
  entity_type    text not null,                            -- bundle | grant | assignment | override | global
  entity_id      uuid,                                     -- nullable for global changes
  company_id     uuid references companies(id) on delete set null,  -- nullable for platform-wide
  service_key    text,
  action         text not null,                            -- e.g. assignment_created, override_created
  previous_value jsonb,                                    -- snapshot before
  new_value      jsonb,                                    -- snapshot after
  reason         text,
  changed_by     uuid references profiles(id),
  changed_at     timestamptz not null default now(),

  constraint entitlement_activity_log_entity_check
    check (entity_type in ('bundle', 'grant', 'assignment', 'override', 'global'))
);

create index if not exists idx_activity_log_company on entitlement_activity_log(company_id, changed_at desc);
create index if not exists idx_activity_log_entity  on entitlement_activity_log(entity_type, entity_id);

-- ===========================================================================
-- 8. ROW LEVEL SECURITY
--    Reuse existing SECURITY DEFINER helpers — no new auth machinery:
--      is_super_admin(), current_company_id(), current_base_role()
--
--    Summary (spec §5):
--      * Super Admin owns the catalogue (full RW on every table).
--      * Company admins READ ONLY their own assignments / overrides / audit.
--      * Employees & customers get NO entitlement-table access.
--      * Activity log is APPEND-ONLY (no write policies → service role only).
-- ===========================================================================

-- ── entitlement_bundles ────────────────────────────────────────────────────
alter table entitlement_bundles enable row level security;

drop policy if exists "bundles_all_super_admin" on entitlement_bundles;
create policy "bundles_all_super_admin" on entitlement_bundles
  for all to authenticated
  using (is_super_admin())
  with check (is_super_admin());

-- Company admins may read only the bundles assigned to their company.
drop policy if exists "bundles_select_company_admin" on entitlement_bundles;
create policy "bundles_select_company_admin" on entitlement_bundles
  for select to authenticated
  using (
    current_base_role() = 'company_admin'
    and exists (
      select 1 from company_bundle_assignments a
      where a.bundle_id = entitlement_bundles.id
        and a.company_id = current_company_id()
    )
  );

-- ── entitlement_bundle_grants ────────────────────────────────────────────────
alter table entitlement_bundle_grants enable row level security;

drop policy if exists "bundle_grants_all_super_admin" on entitlement_bundle_grants;
create policy "bundle_grants_all_super_admin" on entitlement_bundle_grants
  for all to authenticated
  using (is_super_admin())
  with check (is_super_admin());

drop policy if exists "bundle_grants_select_company_admin" on entitlement_bundle_grants;
create policy "bundle_grants_select_company_admin" on entitlement_bundle_grants
  for select to authenticated
  using (
    current_base_role() = 'company_admin'
    and exists (
      select 1 from company_bundle_assignments a
      where a.bundle_id = entitlement_bundle_grants.bundle_id
        and a.company_id = current_company_id()
    )
  );

-- ── entitlement_bundle_grant_limits ──────────────────────────────────────────
alter table entitlement_bundle_grant_limits enable row level security;

drop policy if exists "grant_limits_all_super_admin" on entitlement_bundle_grant_limits;
create policy "grant_limits_all_super_admin" on entitlement_bundle_grant_limits
  for all to authenticated
  using (is_super_admin())
  with check (is_super_admin());

drop policy if exists "grant_limits_select_company_admin" on entitlement_bundle_grant_limits;
create policy "grant_limits_select_company_admin" on entitlement_bundle_grant_limits
  for select to authenticated
  using (
    current_base_role() = 'company_admin'
    and exists (
      select 1
      from entitlement_bundle_grants g
      join company_bundle_assignments a on a.bundle_id = g.bundle_id
      where g.id = entitlement_bundle_grant_limits.grant_id
        and a.company_id = current_company_id()
    )
  );

-- ── company_bundle_assignments ───────────────────────────────────────────────
alter table company_bundle_assignments enable row level security;

drop policy if exists "assignments_all_super_admin" on company_bundle_assignments;
create policy "assignments_all_super_admin" on company_bundle_assignments
  for all to authenticated
  using (is_super_admin())
  with check (is_super_admin());

drop policy if exists "assignments_select_company_admin" on company_bundle_assignments;
create policy "assignments_select_company_admin" on company_bundle_assignments
  for select to authenticated
  using (
    current_base_role() = 'company_admin'
    and company_id = current_company_id()
  );

-- ── company_feature_overrides ────────────────────────────────────────────────
alter table company_feature_overrides enable row level security;

drop policy if exists "overrides_all_super_admin" on company_feature_overrides;
create policy "overrides_all_super_admin" on company_feature_overrides
  for all to authenticated
  using (is_super_admin())
  with check (is_super_admin());

drop policy if exists "overrides_select_company_admin" on company_feature_overrides;
create policy "overrides_select_company_admin" on company_feature_overrides
  for select to authenticated
  using (
    current_base_role() = 'company_admin'
    and company_id = current_company_id()
  );

-- ── company_feature_override_limits ──────────────────────────────────────────
alter table company_feature_override_limits enable row level security;

drop policy if exists "override_limits_all_super_admin" on company_feature_override_limits;
create policy "override_limits_all_super_admin" on company_feature_override_limits
  for all to authenticated
  using (is_super_admin())
  with check (is_super_admin());

drop policy if exists "override_limits_select_company_admin" on company_feature_override_limits;
create policy "override_limits_select_company_admin" on company_feature_override_limits
  for select to authenticated
  using (
    current_base_role() = 'company_admin'
    and exists (
      select 1 from company_feature_overrides o
      where o.id = company_feature_override_limits.override_id
        and o.company_id = current_company_id()
    )
  );

-- ── entitlement_activity_log (APPEND-ONLY) ───────────────────────────────────
-- Read by super admin (all) and company admin (own company). NO insert/update/
-- delete policies → writes happen only via the service role / edge function,
-- preserving append-only integrity.
alter table entitlement_activity_log enable row level security;

drop policy if exists "activity_log_select_super_admin" on entitlement_activity_log;
create policy "activity_log_select_super_admin" on entitlement_activity_log
  for select to authenticated
  using (is_super_admin());

drop policy if exists "activity_log_select_company_admin" on entitlement_activity_log;
create policy "activity_log_select_company_admin" on entitlement_activity_log
  for select to authenticated
  using (
    current_base_role() = 'company_admin'
    and company_id is not null
    and company_id = current_company_id()
  );

-- ============================================================================
-- END Phase 1. Tables are empty; no app code reads/writes them yet. Existing
-- behaviour is unchanged. Data migration + resolver wiring come in later phases.
-- ============================================================================
