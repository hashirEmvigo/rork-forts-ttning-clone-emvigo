-- ============================================================================
-- CleanOps — PRICE CALCULATOR (Slice 1A): CONFIGURATION FOUNDATION  [PROPOSED]
-- ============================================================================
--
-- STATUS: PROPOSED ONLY — this file ends in `.sql.proposed`, so the Supabase
-- migration runner (which only globs `*.sql`) NEVER picks it up. Nothing here is
-- applied until it is reviewed, renamed to `0058_calculator_foundation.sql`, and
-- run as a normal migration. No app code reads these tables yet.
--
-- PURPOSE
--   Lay the Supabase-authoritative configuration foundation for the public Price
--   Calculator (/rakna-ut-ditt-pris) and its locked Super Admin settings page.
--   This migration creates ONLY the admin-side configuration model:
--     • calculator_settings   — per-company calculator behaviour + page copy.
--     • calculator_services   — which services are offered (home/move-out/…).
--     • calculator_questions  — the dynamic, data-driven input fields per service.
--     • cleaning_plans        — operational COMMERCIAL plans (hourly rate + terms).
--     • pricing_rules         — the numeric factors / add-on prices per service.
--   The prospect + quote-request capture model lives in the sibling migration
--   0059_prospects_and_quote_requests.sql.proposed (apply 0058 FIRST).
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO  (see end-of-file NON-GOALS)
--   No anon/public RLS, no Edge Function, no seed data, no Company-Admin write,
--   no UI, no pricing engine code, no quote numbering, no CRM behaviour.
--
-- KEY ARCHITECTURAL RULES ENCODED HERE
--   1. COMPANY-SCOPED, MULTI-COMPANY-READY. Every table carries a real
--      company_id uuid FK (RLS tenancy) + company_legacy_id text (app-facing
--      scope), mirroring customers (0007) / company_settings (0026). MVP runs
--      one company (Städalliansen) but the column makes Phase 2 multi-company a
--      pure policy change, not a schema change.
--   2. SUPER ADMIN ONLY (MVP control scope, confirmation #4). Active write/read
--      policies are super_admin only. The Company-Admin (Phase 2, confirmation
--      #5) policies are written out but COMMENTED — enabling them later needs no
--      schema change.
--   3. NO PUBLIC/ANON ACCESS HERE (confirmation: safe public submission path).
--      The unauthenticated calculator page does NOT read these tables directly.
--      A later SECURITY DEFINER Edge Function (service role, Slice 3) returns
--      only public-safe config and recomputes price server-side. Keeping pricing
--      internals (hourly rates, factors, margins) off the anon client is the
--      whole point — so there are intentionally NO `to anon` policies.
--   4. SOFT-DELETE EVERYWHERE (deleted_at). No DELETE policy on any table;
--      "removing" config is an UPDATE setting deleted_at (an upsert UNDELETES).
--      This also protects historical quotes (their snapshot, see 0059).
--   5. CLEANING PLANS ARE COMMERCIAL, NOT CONTENT. A plan never changes WHAT is
--      cleaned; it sets the hourly_rate + flexibility/priority/continuity terms.
--
-- COMPATIBILITY
--   Purely additive. New tables/one trigger fn only. Reads nothing, changes
--   nothing in customers, profiles, settings, services, work orders, bookings,
--   roles, media/assets, or any other existing domain. Reuses the existing
--   SECURITY DEFINER helpers from 0003 (is_super_admin / current_company_id /
--   current_base_role) so there is no recursive-RLS risk.
-- ============================================================================

-- ── 0. Shared updated_at trigger fn (Price Calculator domain) ───────────────
-- Reused by 0059 as well (apply 0058 before 0059).
create or replace function set_calculator_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ===========================================================================
-- 1. calculator_settings  (ONE row per company — the calculator's behaviour +
--    all public page copy. company_id is NOT NULL: settings are always scoped.)
-- ===========================================================================
create table if not exists calculator_settings (
  id                              uuid primary key default gen_random_uuid(),
  -- App-facing id, e.g. 'calc_settings_<companyLegacy>'. Idempotent upsert key.
  legacy_id                       text not null unique,
  company_id                      uuid not null references companies(id) on delete cascade,
  company_legacy_id               text not null,

  -- Master on/off. Default OFF so a deploy ships dark (release runbook: "deploy
  -- with calculator disabled by default").
  enabled                         boolean not null default false,

  -- Public routing handles. public_slug resolves the company from the public URL
  -- (e.g. 'rakna-ut-ditt-pris'); embed_key is an opaque handle for future
  -- embeds. Both are GLOBALLY unique (partial unique indexes below) because the
  -- public route resolves a single company from them.
  public_slug                     text,
  embed_key                       text,

  -- Result/price presentation.
  price_display_mode              text not null default 'range',   -- exact | range | hidden_until_submit
  show_price_before_contact       boolean not null default true,
  require_contact_before_result   boolean not null default false,
  show_login_prompt_after_submit  boolean not null default true,

  -- Quote economics + review.
  quote_validity_days             integer not null default 30,
  manual_review_threshold_amount  numeric,                          -- null = never auto-flag
  currency                        text not null default 'SEK',
  rut_display_mode                text not null default 'none',     -- none | show_after_rut | show_before_after

  -- Submission behaviour (consumed by the Slice 3 Edge Function).
  auto_create_prospect            boolean not null default true,
  auto_create_quote_request       boolean not null default true,
  default_quote_status            text not null default 'submitted',

  -- All editable page copy (title, subtitle, intro/help, result-panel text,
  -- quote-created confirmation, login-prompt text, back-to-website link,
  -- contact/help info, FAQ items, CTA labels). JSON so adding a copy slot needs
  -- no migration.
  content                         jsonb not null default '{}'::jsonb,
  -- Lossless overflow for any future flat field before it earns a column.
  data                            jsonb not null default '{}'::jsonb,

  deleted_at                      timestamptz,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now(),

  constraint calculator_settings_price_display_mode_check
    check (price_display_mode in ('exact', 'range', 'hidden_until_submit')),
  constraint calculator_settings_rut_display_mode_check
    check (rut_display_mode in ('none', 'show_after_rut', 'show_before_after')),
  constraint calculator_settings_default_quote_status_check
    check (default_quote_status in ('submitted', 'pending_review', 'ready_for_customer')),
  constraint calculator_settings_quote_validity_days_check
    check (quote_validity_days >= 0)
);

-- One LIVE settings row per company; slugs/embed keys globally unique when set.
create unique index if not exists uq_calculator_settings_company_live
  on calculator_settings(company_id) where deleted_at is null;
create unique index if not exists uq_calculator_settings_public_slug
  on calculator_settings(public_slug) where public_slug is not null and deleted_at is null;
create unique index if not exists uq_calculator_settings_embed_key
  on calculator_settings(embed_key) where embed_key is not null and deleted_at is null;
create index if not exists idx_calculator_settings_company
  on calculator_settings(company_id) where deleted_at is null;
create index if not exists idx_calculator_settings_enabled
  on calculator_settings(enabled) where deleted_at is null;

drop trigger if exists trg_calculator_settings_updated_at on calculator_settings;
create trigger trg_calculator_settings_updated_at
  before update on calculator_settings
  for each row execute function set_calculator_updated_at();

alter table calculator_settings enable row level security;

-- READ: super_admin only (MVP control scope).
drop policy if exists "calculator_settings_select_super_admin" on calculator_settings;
create policy "calculator_settings_select_super_admin" on calculator_settings
  for select to authenticated using (is_super_admin());

-- WRITE: super_admin only.
drop policy if exists "calculator_settings_insert_super_admin" on calculator_settings;
create policy "calculator_settings_insert_super_admin" on calculator_settings
  for insert to authenticated with check (is_super_admin());

drop policy if exists "calculator_settings_update_super_admin" on calculator_settings;
create policy "calculator_settings_update_super_admin" on calculator_settings
  for update to authenticated using (is_super_admin()) with check (is_super_admin());

-- ── PHASE 2 (Company-Admin ownership) — DO NOT ENABLE YET (confirmation #5) ──
-- Enabling these later is a pure policy add (no schema change):
--   create policy "calculator_settings_select_own_company" on calculator_settings
--     for select to authenticated
--     using (company_id is not null and company_id = current_company_id());
--   create policy "calculator_settings_write_own_company" on calculator_settings
--     for all to authenticated
--     using (current_base_role() = 'company_admin'
--            and company_id is not null and company_id = current_company_id())
--     with check (current_base_role() = 'company_admin'
--            and company_id is not null and company_id = current_company_id());

-- ===========================================================================
-- 2. calculator_services  (which services this company offers in the calculator)
-- ===========================================================================
create table if not exists calculator_services (
  id                    uuid primary key default gen_random_uuid(),
  legacy_id             text not null unique,
  company_id            uuid not null references companies(id) on delete cascade,
  company_legacy_id     text not null,

  -- Stable machine key the pricing engine switches on; display_name is editable.
  service_key           text not null,                 -- home_cleaning | move_out_cleaning | window_cleaning | office_cleaning
  display_name          text not null,
  description           text,

  -- Visibility model (proposal for the doc's "hide vs coming soon" question):
  --   enabled=true                  → selectable + priced.
  --   enabled=false, coming_soon=true  → shown as a disabled "Coming soon" card.
  --   enabled=false, coming_soon=false → hidden entirely.
  enabled               boolean not null default true,
  coming_soon           boolean not null default false,

  -- Which pure pricing formula applies (engine code, Slice 2/3, keys off this).
  pricing_model         text not null,                 -- home_cleaning_recommended_hours | move_out_fixed_plus_addons
  sort_order            integer not null default 0,
  -- Service-level config that does not warrant its own column yet.
  settings_json         jsonb not null default '{}'::jsonb,

  deleted_at            timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint calculator_services_pricing_model_check
    check (pricing_model in ('home_cleaning_recommended_hours', 'move_out_fixed_plus_addons'))
);

create unique index if not exists uq_calculator_services_company_key_live
  on calculator_services(company_id, service_key) where deleted_at is null;
create index if not exists idx_calculator_services_company
  on calculator_services(company_id) where deleted_at is null;
create index if not exists idx_calculator_services_sort
  on calculator_services(company_id, sort_order) where deleted_at is null;

drop trigger if exists trg_calculator_services_updated_at on calculator_services;
create trigger trg_calculator_services_updated_at
  before update on calculator_services
  for each row execute function set_calculator_updated_at();

alter table calculator_services enable row level security;

drop policy if exists "calculator_services_select_super_admin" on calculator_services;
create policy "calculator_services_select_super_admin" on calculator_services
  for select to authenticated using (is_super_admin());

drop policy if exists "calculator_services_insert_super_admin" on calculator_services;
create policy "calculator_services_insert_super_admin" on calculator_services
  for insert to authenticated with check (is_super_admin());

drop policy if exists "calculator_services_update_super_admin" on calculator_services;
create policy "calculator_services_update_super_admin" on calculator_services
  for update to authenticated using (is_super_admin()) with check (is_super_admin());
-- PHASE 2 company-admin policies: same shape as calculator_settings above.

-- ===========================================================================
-- 3. calculator_questions  (data-driven input fields per service)
--    PROPOSAL: questions are CONFIGURABLE ROWS (Super Admin can edit label /
--    help / required / options without code), but their PRICING SEMANTICS stay
--    in the pure engine keyed by question_key — so the engine is testable and
--    never driven by free-text. A default question set is SEEDED in a later
--    slice (not here).
-- ===========================================================================
create table if not exists calculator_questions (
  id                            uuid primary key default gen_random_uuid(),
  legacy_id                     text not null unique,
  company_id                    uuid not null references companies(id) on delete cascade,
  company_legacy_id             text not null,
  calculator_service_id         uuid not null references calculator_services(id) on delete cascade,
  calculator_service_legacy_id  text,

  question_key                  text not null,         -- sqm | bathrooms | frequency | postal_code | property_type | glazed_balcony | divisible_windows | desired_date | addons | ...
  label                         text not null,
  help_text                     text,
  input_type                    text not null,         -- number | integer | select | multiselect | boolean | text | postal_code | date
  required                      boolean not null default false,
  options_json                  jsonb not null default '[]'::jsonb,   -- choices for (multi)select
  validation_json               jsonb not null default '{}'::jsonb,   -- min/max/step/pattern
  -- Whether this answer feeds the pricing engine (vs. purely informational).
  affects_pricing               boolean not null default true,
  sort_order                    integer not null default 0,
  active                        boolean not null default true,

  deleted_at                    timestamptz,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),

  constraint calculator_questions_input_type_check
    check (input_type in (
      'number', 'integer', 'select', 'multiselect', 'boolean', 'text', 'postal_code', 'date'
    ))
);

create unique index if not exists uq_calculator_questions_service_key_live
  on calculator_questions(calculator_service_id, question_key) where deleted_at is null;
create index if not exists idx_calculator_questions_service
  on calculator_questions(calculator_service_id) where deleted_at is null;
create index if not exists idx_calculator_questions_company
  on calculator_questions(company_id) where deleted_at is null;
create index if not exists idx_calculator_questions_sort
  on calculator_questions(calculator_service_id, sort_order) where deleted_at is null;

drop trigger if exists trg_calculator_questions_updated_at on calculator_questions;
create trigger trg_calculator_questions_updated_at
  before update on calculator_questions
  for each row execute function set_calculator_updated_at();

alter table calculator_questions enable row level security;

drop policy if exists "calculator_questions_select_super_admin" on calculator_questions;
create policy "calculator_questions_select_super_admin" on calculator_questions
  for select to authenticated using (is_super_admin());

drop policy if exists "calculator_questions_insert_super_admin" on calculator_questions;
create policy "calculator_questions_insert_super_admin" on calculator_questions
  for insert to authenticated with check (is_super_admin());

drop policy if exists "calculator_questions_update_super_admin" on calculator_questions;
create policy "calculator_questions_update_super_admin" on calculator_questions
  for update to authenticated using (is_super_admin()) with check (is_super_admin());
-- PHASE 2 company-admin policies: same shape as calculator_settings above.

-- ===========================================================================
-- 4. cleaning_plans  (COMMERCIAL plans: hourly rate + operational terms ONLY)
--    Semantic rule (doc 04): a plan NEVER changes what is cleaned. It sets the
--    hourly_rate and the flexibility / continuity / priority terms. Names are
--    editable; plan_key is the stable machine key.
-- ===========================================================================
create table if not exists cleaning_plans (
  id                          uuid primary key default gen_random_uuid(),
  legacy_id                   text not null unique,
  company_id                  uuid not null references companies(id) on delete cascade,
  company_legacy_id           text not null,

  plan_key                    text not null,           -- flexible | fixed | priority (stable)
  name                        text not null,           -- editable display name
  description                 text,
  hourly_rate                 numeric not null,        -- currency per hour (currency on calculator_settings)

  -- Descriptive commercial terms (NOT cleaning content). Free-form-ish but
  -- constrained to known buckets so the UI can render badges consistently.
  flexibility_level           text,                    -- high | medium | low
  customer_day_time_control   text,                    -- company_controlled | preferred | guaranteed
  same_staff_preference_level text,                    -- low | medium | high
  booking_priority            text,                    -- standard | elevated | priority
  cancellation_terms_summary  text,

  is_default                  boolean not null default false,
  active                      boolean not null default true,
  sort_order                  integer not null default 0,
  data                        jsonb not null default '{}'::jsonb,

  deleted_at                  timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  constraint cleaning_plans_hourly_rate_check
    check (hourly_rate >= 0),
  constraint cleaning_plans_flexibility_level_check
    check (flexibility_level is null or flexibility_level in ('high', 'medium', 'low')),
  constraint cleaning_plans_day_time_control_check
    check (customer_day_time_control is null or customer_day_time_control in ('company_controlled', 'preferred', 'guaranteed')),
  constraint cleaning_plans_same_staff_check
    check (same_staff_preference_level is null or same_staff_preference_level in ('low', 'medium', 'high')),
  constraint cleaning_plans_booking_priority_check
    check (booking_priority is null or booking_priority in ('standard', 'elevated', 'priority'))
);

create unique index if not exists uq_cleaning_plans_company_key_live
  on cleaning_plans(company_id, plan_key) where deleted_at is null;
-- At most ONE default plan per company.
create unique index if not exists uq_cleaning_plans_one_default_per_company
  on cleaning_plans(company_id) where is_default and deleted_at is null;
create index if not exists idx_cleaning_plans_company
  on cleaning_plans(company_id) where deleted_at is null;
create index if not exists idx_cleaning_plans_sort
  on cleaning_plans(company_id, sort_order) where deleted_at is null;

drop trigger if exists trg_cleaning_plans_updated_at on cleaning_plans;
create trigger trg_cleaning_plans_updated_at
  before update on cleaning_plans
  for each row execute function set_calculator_updated_at();

alter table cleaning_plans enable row level security;

drop policy if exists "cleaning_plans_select_super_admin" on cleaning_plans;
create policy "cleaning_plans_select_super_admin" on cleaning_plans
  for select to authenticated using (is_super_admin());

drop policy if exists "cleaning_plans_insert_super_admin" on cleaning_plans;
create policy "cleaning_plans_insert_super_admin" on cleaning_plans
  for insert to authenticated with check (is_super_admin());

drop policy if exists "cleaning_plans_update_super_admin" on cleaning_plans;
create policy "cleaning_plans_update_super_admin" on cleaning_plans
  for update to authenticated using (is_super_admin()) with check (is_super_admin());
-- PHASE 2 company-admin policies: same shape as calculator_settings above.

-- ===========================================================================
-- 5. pricing_rules  (numeric factors + add-on prices per service)
--    Home cleaning  : base_hours, hours_per_sqm, minimum_hours,
--                     bathroom_extra_hours, range_min_percent, range_max_percent,
--                     rounding_increment, addon_hours_*.
--    Move-out clean : price_per_sqm, minimum_price, addon_glazed_balcony,
--                     addon_divisible_windows, addon_extra_bathroom,
--                     range_*_percent, rounding_increment.
--    The pure pricing engine (later slice) reads these by (service, rule_key).
--    These values are NEVER exposed to the anon client (no anon RLS — preview &
--    final price are computed server-side).
-- ===========================================================================
create table if not exists pricing_rules (
  id                            uuid primary key default gen_random_uuid(),
  legacy_id                     text not null unique,
  company_id                    uuid not null references companies(id) on delete cascade,
  company_legacy_id             text not null,
  calculator_service_id         uuid not null references calculator_services(id) on delete cascade,
  calculator_service_legacy_id  text,

  rule_key                      text not null,         -- e.g. base_hours | hours_per_sqm | price_per_sqm | addon_glazed_balcony | range_min_percent | rounding_increment
  rule_type                     text not null,         -- numeric_factor | addon_price | addon_hours | margin_percent | rounding | threshold
  value_numeric                 numeric,
  value_json                    jsonb not null default '{}'::jsonb,
  condition_json                jsonb not null default '{}'::jsonb,   -- optional applicability conditions
  active                        boolean not null default true,
  sort_order                    integer not null default 0,
  data                          jsonb not null default '{}'::jsonb,

  deleted_at                    timestamptz,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),

  constraint pricing_rules_rule_type_check
    check (rule_type in (
      'numeric_factor', 'addon_price', 'addon_hours', 'margin_percent', 'rounding', 'threshold'
    ))
);

create unique index if not exists uq_pricing_rules_service_key_live
  on pricing_rules(calculator_service_id, rule_key) where deleted_at is null;
create index if not exists idx_pricing_rules_service
  on pricing_rules(calculator_service_id) where deleted_at is null;
create index if not exists idx_pricing_rules_company
  on pricing_rules(company_id) where deleted_at is null;

drop trigger if exists trg_pricing_rules_updated_at on pricing_rules;
create trigger trg_pricing_rules_updated_at
  before update on pricing_rules
  for each row execute function set_calculator_updated_at();

alter table pricing_rules enable row level security;

drop policy if exists "pricing_rules_select_super_admin" on pricing_rules;
create policy "pricing_rules_select_super_admin" on pricing_rules
  for select to authenticated using (is_super_admin());

drop policy if exists "pricing_rules_insert_super_admin" on pricing_rules;
create policy "pricing_rules_insert_super_admin" on pricing_rules
  for insert to authenticated with check (is_super_admin());

drop policy if exists "pricing_rules_update_super_admin" on pricing_rules;
create policy "pricing_rules_update_super_admin" on pricing_rules
  for update to authenticated using (is_super_admin()) with check (is_super_admin());
-- PHASE 2 company-admin policies: same shape as calculator_settings above.

-- ============================================================================
-- INTENTIONALLY NOT INCLUDED YET (scope guard for this slice)
--   • No anon/public RLS and no Edge Function. The public page reads config &
--     submits via a SECURITY DEFINER service-role function in a later slice.
--   • No Company-Admin write/read (Phase 2; commented templates above).
--   • No seed data (default services / questions / plans / pricing values are a
--     reviewed Slice 2 seed bound to the real company + numbers).
--   • No pricing-engine SQL/RPC — pricing is pure, testable TS computed
--     server-side; this migration only stores its configuration.
--   • No entitlement/feature-key wiring (no calculator ServiceFeatureKey yet).
--   • No quote numbering, prospects, or quote_requests (see 0059).
--   • No DELETE policies anywhere (soft-delete via deleted_at only).
-- ============================================================================
