-- ============================================================================
-- 0074 — Generic add-on engine: calculator_addons table  (Slice V2-E0C)
-- ============================================================================
-- Scope (approved Slice V2-E0C):
--   • Create ONE new additive table `calculator_addons` — the generic,
--     service-agnostic add-on model that will power EVERY future calculator
--     add-on (home dog / bathroom / WC / oven, window spröjs / delbara rutor,
--     hard-to-access windows, …) WITHOUT any hardcoded, service-specific rule.
--   • Empty table ONLY. NO seed rows. Admin authors every add-on by hand in the
--     later Add-ons editor (Slice V2-E0E).
--
-- Input model (E0C correction): only 'boolean' and 'quantity' are allowed.
--   'single_select' is intentionally NOT permitted yet — it will be added in a
--   separate additive migration once the Admin UI, public rendering, and the V2
--   resolver actually support it. Allowing it in persisted data first would let
--   rows exist that nothing can render or price.
--
-- Effect channels are EXPLICIT + typed (no vague "affects_pricing yes/no"):
--   • effect_time_minutes   — adds calculated service time (price via time × rate)
--   • effect_fixed_excl_vat — adds a fixed amount excl VAT (may be ± surcharge/discount)
--   • effect_percent        — net additive percent modifier (may be ±)
--
-- Guarantees / non-goals:
--   • Additive + idempotent. Safe to re-run (create table/index if not exists,
--     drop+create trigger + policies). NO existing table is modified.
--   • Multi-company-ready + super-admin-only RLS + soft-delete, mirroring the
--     calculator foundation (0058) and size-bands (0072) conventions exactly.
--   • NO legacy add-on migration/seed. Old `pricing_rules` add-on keys
--     (addon_hours_*, pet_time_percent, …) and legacy `calculator_questions`
--     stay UNTOUCHED and are simply ignored by V2 — cleanup is a later slice.
--   • No Admin UI, no public runtime, no Edge Function, no V2-E wiring, no deploy.
-- ============================================================================

-- ── 1. calculator_addons (generic, service-scoped add-on definitions) ───────
create table if not exists calculator_addons (
  id                            uuid primary key default gen_random_uuid(),
  -- App-facing id, e.g. 'calc_addon_<addonKey>_<companyLegacy>'. Idempotent upsert key.
  legacy_id                     text not null unique,
  company_id                    uuid not null references companies(id) on delete cascade,
  company_legacy_id             text not null,
  calculator_service_id         uuid not null references calculator_services(id) on delete cascade,
  calculator_service_legacy_id  text,
  -- Stable machine key the engine/admin switch on (home_cleaning, window_cleaning, …).
  service_key                   text not null,

  -- ── Identity / copy ───────────────────────────────────────────────────────
  addon_key                     text not null,   -- stable machine key, unique per LIVE service
  name                          text not null,   -- internal/admin display name
  public_label                  text not null,   -- customer-facing question/label text
  description                   text,

  -- ── Input model (E0C: 'boolean' | 'quantity' ONLY) ───────────────────────
  input_type                    text not null default 'boolean',
  boolean_default               boolean not null default false,
  quantity_min                  numeric not null default 0,
  quantity_max                  numeric,
  quantity_step                 numeric not null default 1,
  quantity_default              numeric not null default 0,
  -- Reserved forward-compat escape hatch. Currently UNUSED for boolean/quantity.
  -- Does NOT enable 'single_select' — that needs its own additive migration plus
  -- Admin UI + public rendering + resolver support.
  options_json                  jsonb not null default '[]'::jsonb,

  -- ── Effect channels (explicit + typed) ───────────────────────────────────
  effect_time_minutes           numeric not null default 0,   -- >= 0; adds service time (× plan rate for hourly)
  effect_fixed_excl_vat         numeric not null default 0,   -- ± fixed amount excl VAT
  effect_percent                numeric not null default 0,   -- ± net additive percent (applied once, never compounded)

  -- ── Lifecycle ─────────────────────────────────────────────────────────────
  active                        boolean not null default true,
  public_visible                boolean not null default true,
  required                      boolean not null default false,
  sort_order                    integer not null default 0,
  data                          jsonb not null default '{}'::jsonb,

  deleted_at                    timestamptz,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),

  -- ── Constraints ───────────────────────────────────────────────────────────
  constraint calculator_addons_input_type_check
    check (input_type in ('boolean', 'quantity')),
  constraint calculator_addons_quantity_step_check
    check (quantity_step > 0),
  constraint calculator_addons_quantity_min_check
    check (quantity_min >= 0),
  constraint calculator_addons_quantity_max_check
    check (quantity_max is null or quantity_max >= quantity_min),
  constraint calculator_addons_quantity_default_min_check
    check (quantity_default >= quantity_min),
  constraint calculator_addons_quantity_default_max_check
    check (quantity_max is null or quantity_default <= quantity_max),
  -- Typo guard: a single add-on cannot add more than a full day of work.
  constraint calculator_addons_effect_time_minutes_check
    check (effect_time_minutes >= 0 and effect_time_minutes <= 1440),
  -- Typo guard: a single add-on percent stays within ±100%.
  constraint calculator_addons_effect_percent_check
    check (effect_percent >= -100 and effect_percent <= 100)
  -- effect_fixed_excl_vat is intentionally UNCONSTRAINED (may be ± for surcharge/discount).
);

comment on table calculator_addons is
  'V2 generic add-on engine: service-scoped, configurable add-ons with explicit time/fixed/percent effect channels. Replaces hardcoded legacy add-on rules; V2 ignores legacy add-on keys. Empty until Admin authors add-ons.';
comment on column calculator_addons.input_type is
  'Customer input model. E0C allows only boolean | quantity. single_select is reserved for a later additive migration once UI/resolver support it.';
comment on column calculator_addons.options_json is
  'Reserved forward-compat escape hatch (unused for boolean/quantity). Does NOT enable single_select.';
comment on column calculator_addons.effect_time_minutes is
  'Adds calculated service time (minutes, per unit for quantity). For hourly services this changes price via time × plan hourly rate. >= 0.';
comment on column calculator_addons.effect_fixed_excl_vat is
  'Fixed amount excl VAT added to the raw price (per unit for quantity). May be ± (surcharge/discount).';
comment on column calculator_addons.effect_percent is
  'Net additive percent modifier applied once (never compounded). May be ± within [-100, 100].';

-- ── 2. Indexes ──────────────────────────────────────────────────────────────
-- At most ONE live add-on per (service, addon_key).
create unique index if not exists uq_calculator_addons_service_addon_key_live
  on calculator_addons(calculator_service_id, addon_key) where deleted_at is null;
create index if not exists idx_calculator_addons_service
  on calculator_addons(calculator_service_id) where deleted_at is null;
create index if not exists idx_calculator_addons_company
  on calculator_addons(company_id) where deleted_at is null;
create index if not exists idx_calculator_addons_sort
  on calculator_addons(calculator_service_id, sort_order) where deleted_at is null;
-- Public loader: active + visible rows for a service, in sort order.
create index if not exists idx_calculator_addons_public
  on calculator_addons(calculator_service_id, sort_order)
  where active and public_visible and deleted_at is null;

-- ── 3. updated_at trigger (reuses the shared calculator fn from 0058) ───────
drop trigger if exists trg_calculator_addons_updated_at on calculator_addons;
create trigger trg_calculator_addons_updated_at
  before update on calculator_addons
  for each row execute function set_calculator_updated_at();

-- ── 4. RLS — super_admin only (MVP control scope). No anon. No DELETE. ──────
alter table calculator_addons enable row level security;

drop policy if exists "calculator_addons_select_super_admin" on calculator_addons;
create policy "calculator_addons_select_super_admin" on calculator_addons
  for select to authenticated using (is_super_admin());

drop policy if exists "calculator_addons_insert_super_admin" on calculator_addons;
create policy "calculator_addons_insert_super_admin" on calculator_addons
  for insert to authenticated with check (is_super_admin());

drop policy if exists "calculator_addons_update_super_admin" on calculator_addons;
create policy "calculator_addons_update_super_admin" on calculator_addons
  for update to authenticated using (is_super_admin()) with check (is_super_admin());
-- No anon policy (public config returns add-ons via a later SECURITY DEFINER path).
-- No DELETE policy (soft-delete via deleted_at only).
-- PHASE 2 company-admin policies: same shape as calculator_settings (0058).

-- ============================================================================
-- INTENTIONALLY NOT INCLUDED (scope guard for Slice V2-E0C)
--   • NO seed rows. Empty table only — Admin creates dog / bathroom / WC / oven /
--     spröjs / delbara rutor / hard-to-access windows by hand later (V2-E0E).
--   • NO legacy migration/mapping/seed of pricing_rules add-on keys
--     (addon_hours_*, pet_time_percent) or legacy calculator_questions.
--   • NO 'single_select' input type yet.
--   • NO anon RLS, NO DELETE policy, NO Edge Function, NO public runtime,
--     NO V2-E wiring, NO Admin UI, NO deploy.
-- ============================================================================
