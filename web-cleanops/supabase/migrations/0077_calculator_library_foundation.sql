-- ============================================================================
-- 0077 — Calculator Library foundation  (GPM-CALC-LIBRARY-2A)
-- ============================================================================
-- Wave doc: docs/architecture/price-calculator/calculator-library-wave-1.md
--           (Ticket 1 — GPM-CALC-LIBRARY-2A: additive schema foundation, no backfill)
--
-- PURPOSE
--   Lay the additive schema foundation for REUSABLE calculator Question and
--   Add-on library items, so future tickets can let an admin activate a shared
--   library item onto a service instead of recreating it by hand every time.
--
--   This migration creates ONLY the two company-scoped master/library tables and
--   adds ONE nullable back-reference column to each existing service-scoped table:
--     • calculator_question_library_items  — reusable question DEFAULTS.
--     • calculator_addon_library_items     — reusable add-on DEFAULTS.
--     • calculator_questions.library_item_id  (nullable FK → question library)
--     • calculator_addons.library_item_id     (nullable FK → add-on library)
--
-- APPROVED ARCHITECTURE (wave doc §2)
--   • SEPARATE libraries (one for questions, one for add-ons) — NOT one unified
--     over-generalized table.
--   • The existing service-scoped tables (calculator_questions / calculator_addons)
--     remain the activation/override layer and the public read model. The library
--     tables only hold reusable defaults.
--   • COMPANY-SCOPED libraries first. No global/superadmin cross-company library.
--   • Existing rows keep working unchanged with `library_item_id = null` — a null
--     link means "custom row authored directly for this service" (today's behaviour).
--
-- GUARANTEES / NON-GOALS
--   • Purely ADDITIVE + IDEMPOTENT. Safe to re-run: create table/column/index
--     `if not exists`, drop+create trigger + policies. NO existing row is modified
--     and NO existing column is dropped or altered (only two NEW nullable columns).
--   • NO backfill, NO dedupe, NO migration of existing questions/add-ons into
--     library items (that is a later, separately-approved ticket).
--   • NO Admin UI, NO public config change, NO runtime/Edge change, NO seed rows.
--   • Multi-company-ready + super-admin-only RLS + soft-delete, mirroring the
--     calculator foundation (0058) and generic add-on engine (0074) conventions.
--   • Reuses the shared `set_calculator_updated_at()` trigger fn from 0058 and the
--     SECURITY DEFINER `is_super_admin()` helper from 0003 (no recursive-RLS risk).
-- ============================================================================

-- ===========================================================================
-- 1. calculator_question_library_items
--    Reusable, company-scoped question DEFAULTS. NOT tied to any service: the
--    same library item can seed a calculator_questions row on many services.
--    Stable machine key is `question_key` (unique per company among LIVE rows).
-- ===========================================================================
create table if not exists calculator_question_library_items (
  id                       uuid primary key default gen_random_uuid(),
  -- App-facing id, e.g. 'calc_qlib_<questionKey>_<companyLegacy>'. Idempotent upsert key.
  legacy_id                text not null unique,
  company_id               uuid not null references companies(id) on delete cascade,
  company_legacy_id        text not null,

  -- Stable machine key copied onto activated calculator_questions rows.
  question_key             text not null,

  -- Default copy + input model (mirrors calculator_questions columns 1:1 so
  -- activation is a plain copy of defaults + per-service override columns).
  label                    text not null,
  help_text                text,
  input_type               text not null,
  default_required         boolean not null default false,
  default_affects_pricing  boolean not null default true,
  default_options_json     jsonb not null default '[]'::jsonb,   -- choices for (multi)select
  default_validation_json  jsonb not null default '{}'::jsonb,   -- min/max/step/pattern
  default_sort_order       integer not null default 0,

  -- Library-only metadata.
  description              text,                                 -- internal admin note (not customer-facing)
  active                   boolean not null default true,        -- whether the library item is offered
  -- Lossless overflow for forward-compat (e.g. pricing_model_compatibility) before
  -- a field earns its own column. Does NOT change any behaviour today.
  data                     jsonb not null default '{}'::jsonb,

  deleted_at               timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint calculator_question_library_items_input_type_check
    check (input_type in (
      'number', 'integer', 'select', 'multiselect', 'boolean', 'text', 'postal_code', 'date'
    ))
);

comment on table calculator_question_library_items is
  'GPM-CALC-LIBRARY (0077): reusable, company-scoped question DEFAULTS. Activation copies these defaults onto a service-scoped calculator_questions row and sets that row''s library_item_id. The library item is never the public read model.';

-- One LIVE library item per (company, question_key).
create unique index if not exists uq_calculator_question_library_items_company_key_live
  on calculator_question_library_items(company_id, question_key) where deleted_at is null;
create index if not exists idx_calculator_question_library_items_company
  on calculator_question_library_items(company_id) where deleted_at is null;
create index if not exists idx_calculator_question_library_items_sort
  on calculator_question_library_items(company_id, default_sort_order) where deleted_at is null;

drop trigger if exists trg_calculator_question_library_items_updated_at on calculator_question_library_items;
create trigger trg_calculator_question_library_items_updated_at
  before update on calculator_question_library_items
  for each row execute function set_calculator_updated_at();

alter table calculator_question_library_items enable row level security;

drop policy if exists "calculator_question_library_items_select_super_admin" on calculator_question_library_items;
create policy "calculator_question_library_items_select_super_admin" on calculator_question_library_items
  for select to authenticated using (is_super_admin());

drop policy if exists "calculator_question_library_items_insert_super_admin" on calculator_question_library_items;
create policy "calculator_question_library_items_insert_super_admin" on calculator_question_library_items
  for insert to authenticated with check (is_super_admin());

drop policy if exists "calculator_question_library_items_update_super_admin" on calculator_question_library_items;
create policy "calculator_question_library_items_update_super_admin" on calculator_question_library_items
  for update to authenticated using (is_super_admin()) with check (is_super_admin());
-- No anon policy. No DELETE policy (soft-delete via deleted_at only).
-- PHASE 2 company-admin policies: same shape as calculator_settings (0058).

-- ===========================================================================
-- 2. calculator_addon_library_items
--    Reusable, company-scoped add-on DEFAULTS. NOT tied to any service. Stable
--    machine key is `addon_key` (unique per company among LIVE rows). Mirrors the
--    calculator_addons effect channels (time / fixed / percent) exactly.
-- ===========================================================================
create table if not exists calculator_addon_library_items (
  id                       uuid primary key default gen_random_uuid(),
  -- App-facing id, e.g. 'calc_alib_<addonKey>_<companyLegacy>'. Idempotent upsert key.
  legacy_id                text not null unique,
  company_id               uuid not null references companies(id) on delete cascade,
  company_legacy_id        text not null,

  -- Stable machine key copied onto activated calculator_addons rows.
  addon_key                text not null,

  -- Identity / copy (mirrors calculator_addons).
  name                     text not null,   -- internal/admin display name
  public_label             text not null,   -- customer-facing question/label text
  description              text,

  -- Input model (mirrors calculator_addons: 'boolean' | 'quantity' ONLY).
  input_type               text not null default 'boolean',
  boolean_default          boolean not null default false,
  quantity_min             numeric not null default 0,
  quantity_max             numeric,
  quantity_step            numeric not null default 1,
  quantity_default         numeric not null default 0,
  options_json             jsonb not null default '[]'::jsonb,   -- reserved forward-compat (unused for boolean/quantity)

  -- Default effect channels (explicit + typed; copied onto activated rows).
  effect_time_minutes      numeric not null default 0,   -- >= 0; adds service time
  effect_fixed_excl_vat    numeric not null default 0,   -- ± fixed amount excl VAT
  effect_percent           numeric not null default 0,   -- ± net additive percent

  -- Library-only metadata.
  default_sort_order       integer not null default 0,
  active                   boolean not null default true,
  data                     jsonb not null default '{}'::jsonb,

  deleted_at               timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  -- Constraints mirror calculator_addons (0074) exactly so a library default can
  -- always be copied onto a service-scoped row without violating its CHECKs.
  constraint calculator_addon_library_items_input_type_check
    check (input_type in ('boolean', 'quantity')),
  constraint calculator_addon_library_items_quantity_step_check
    check (quantity_step > 0),
  constraint calculator_addon_library_items_quantity_min_check
    check (quantity_min >= 0),
  constraint calculator_addon_library_items_quantity_max_check
    check (quantity_max is null or quantity_max >= quantity_min),
  constraint calculator_addon_library_items_quantity_default_min_check
    check (quantity_default >= quantity_min),
  constraint calculator_addon_library_items_quantity_default_max_check
    check (quantity_max is null or quantity_default <= quantity_max),
  constraint calculator_addon_library_items_effect_time_minutes_check
    check (effect_time_minutes >= 0 and effect_time_minutes <= 1440),
  constraint calculator_addon_library_items_effect_percent_check
    check (effect_percent >= -100 and effect_percent <= 100)
  -- effect_fixed_excl_vat intentionally UNCONSTRAINED (may be ± surcharge/discount).
);

comment on table calculator_addon_library_items is
  'GPM-CALC-LIBRARY (0077): reusable, company-scoped add-on DEFAULTS with explicit time/fixed/percent effect channels. Activation copies these defaults onto a service-scoped calculator_addons row and sets that row''s library_item_id. The library item is never the public read model.';

-- One LIVE library item per (company, addon_key).
create unique index if not exists uq_calculator_addon_library_items_company_key_live
  on calculator_addon_library_items(company_id, addon_key) where deleted_at is null;
create index if not exists idx_calculator_addon_library_items_company
  on calculator_addon_library_items(company_id) where deleted_at is null;
create index if not exists idx_calculator_addon_library_items_sort
  on calculator_addon_library_items(company_id, default_sort_order) where deleted_at is null;

drop trigger if exists trg_calculator_addon_library_items_updated_at on calculator_addon_library_items;
create trigger trg_calculator_addon_library_items_updated_at
  before update on calculator_addon_library_items
  for each row execute function set_calculator_updated_at();

alter table calculator_addon_library_items enable row level security;

drop policy if exists "calculator_addon_library_items_select_super_admin" on calculator_addon_library_items;
create policy "calculator_addon_library_items_select_super_admin" on calculator_addon_library_items
  for select to authenticated using (is_super_admin());

drop policy if exists "calculator_addon_library_items_insert_super_admin" on calculator_addon_library_items;
create policy "calculator_addon_library_items_insert_super_admin" on calculator_addon_library_items
  for insert to authenticated with check (is_super_admin());

drop policy if exists "calculator_addon_library_items_update_super_admin" on calculator_addon_library_items;
create policy "calculator_addon_library_items_update_super_admin" on calculator_addon_library_items
  for update to authenticated using (is_super_admin()) with check (is_super_admin());
-- No anon policy. No DELETE policy (soft-delete via deleted_at only).
-- PHASE 2 company-admin policies: same shape as calculator_settings (0058).

-- ===========================================================================
-- 3. Nullable back-reference columns on the existing service-scoped tables
--    A null value = a custom row authored directly for the service (today's
--    behaviour, unchanged). A non-null value = this row was activated from a
--    library item. ON DELETE SET NULL so a row keeps working even if its library
--    source is ever removed (the row simply becomes a custom row again).
-- ===========================================================================
alter table calculator_questions
  add column if not exists library_item_id uuid
  references calculator_question_library_items(id) on delete set null;

comment on column calculator_questions.library_item_id is
  'GPM-CALC-LIBRARY (0077): nullable link to the reusable calculator_question_library_items source. NULL = custom service question (unchanged legacy behaviour).';

alter table calculator_addons
  add column if not exists library_item_id uuid
  references calculator_addon_library_items(id) on delete set null;

comment on column calculator_addons.library_item_id is
  'GPM-CALC-LIBRARY (0077): nullable link to the reusable calculator_addon_library_items source. NULL = custom service add-on (unchanged legacy behaviour).';

-- Lookup indexes for "which service rows came from this library item" (partial:
-- only linked, live rows). These do not change any read path that exists today.
create index if not exists idx_calculator_questions_library_item
  on calculator_questions(library_item_id)
  where library_item_id is not null and deleted_at is null;
create index if not exists idx_calculator_addons_library_item
  on calculator_addons(library_item_id)
  where library_item_id is not null and deleted_at is null;

-- ============================================================================
-- INTENTIONALLY NOT INCLUDED (scope guard for GPM-CALC-LIBRARY-2A)
--   • NO seed rows / NO backfill / NO dedupe. The library tables start EMPTY;
--     every existing question/add-on keeps library_item_id = null and behaves
--     exactly as today. Backfill is a later, separately-approved ticket (6/7).
--   • NO Admin UI, NO public config change, NO runtime/Edge change, NO deploy.
--   • NO global/cross-company library, NO anon RLS, NO DELETE policy.
-- ============================================================================
