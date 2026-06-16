-- ============================================================================
-- 0073 — Calculator V2 plan-card columns + move-out condition plan seed
--        (Slice V2-D0)
-- ============================================================================
-- Scope (approved Slice V2-D0):
--   • Add four explicit, typed V2 plan-card columns to cleaning_plans:
--       start_adjustment_hours, price_per_sqm_excl_vat,
--       fixed_adjustment_excl_vat, minimum_price_excl_vat
--   • Seed three move_out_cleaning condition plans (good / normal / heavy).
--   • Existing home/office plans inherit start_adjustment_hours = 0 via the
--     NOT NULL DEFAULT 0 — NO backfill from legacy price_adjustment_value, and
--     NO preservation of the legacy "start adjustment changes displayed time"
--     behavior. In V2, start_adjustment_hours affects PRICE only.
--
-- Guarantees / non-goals:
--   • Additive + idempotent. Safe to re-run (ADD COLUMN IF NOT EXISTS,
--     guarded constraints, ON CONFLICT DO NOTHING seed).
--   • No hard deletes. Legacy columns (price_adjustment_type / price_adjustment_value)
--     and the global settings_json plan flags (plansEnabled, planPricingModel,
--     defaultPlanKey, baseHourlyRateExclVat) are PRESERVED and simply ignored by V2.
--   • No RLS / trigger / index-breaking change. The existing
--     uq_cleaning_plans_one_default_per_service constraint is respected (the seed
--     marks exactly ONE active default move-out plan).
--   • No Admin UI, public-runtime, or Edge Function change. Enables nothing and
--     wires no service to V2. No deploy required.
-- ============================================================================

-- ── 1. Additive V2 plan-card columns (idempotent) ──────────────────────────
alter table cleaning_plans
  add column if not exists start_adjustment_hours    numeric not null default 0,
  add column if not exists price_per_sqm_excl_vat    numeric,
  add column if not exists fixed_adjustment_excl_vat numeric not null default 0,
  add column if not exists minimum_price_excl_vat    numeric;

comment on column cleaning_plans.start_adjustment_hours is
  'V2 hourly plan: start-time PRICE adjustment in hours (price-only; may be ±). Never changes the customer-facing estimated service time.';
comment on column cleaning_plans.price_per_sqm_excl_vat is
  'V2 sqm_fixed plan: price per m² excl VAT (null for hourly plans).';
comment on column cleaning_plans.fixed_adjustment_excl_vat is
  'V2 plan: optional fixed amount excl VAT added to the raw price (may be ± for surcharge/discount).';
comment on column cleaning_plans.minimum_price_excl_vat is
  'V2 plan: optional minimum raw price (excl VAT) floor (null = no floor).';

-- ── 2. CHECK constraints (idempotent; Postgres lacks IF NOT EXISTS here) ────
do $$
begin
  -- Typo guard: a plausible start adjustment is a fraction of a day either way.
  -- ±24h blocks fat-finger entries (e.g. 240 instead of 2.40) while leaving
  -- ample room for any realistic per-visit pricing adjustment.
  if not exists (
    select 1 from pg_constraint where conname = 'cleaning_plans_start_adjustment_hours_check'
  ) then
    alter table cleaning_plans
      add constraint cleaning_plans_start_adjustment_hours_check
      check (start_adjustment_hours >= -24 and start_adjustment_hours <= 24);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'cleaning_plans_price_per_sqm_excl_vat_check'
  ) then
    alter table cleaning_plans
      add constraint cleaning_plans_price_per_sqm_excl_vat_check
      check (price_per_sqm_excl_vat is null or price_per_sqm_excl_vat >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'cleaning_plans_minimum_price_excl_vat_check'
  ) then
    alter table cleaning_plans
      add constraint cleaning_plans_minimum_price_excl_vat_check
      check (minimum_price_excl_vat is null or minimum_price_excl_vat >= 0);
  end if;

  -- fixed_adjustment_excl_vat is intentionally UNCONSTRAINED (may be ± to model
  -- a per-plan surcharge or discount).
end $$;

-- ── 3. Seed move_out_cleaning condition plans (idempotent) ─────────────────
--   Three configurable seed plans. The normal/default plan reuses the live
--   move-out baseline (pricing_rules.price_per_sqm = 35, minimum_price = 1500).
--   hourly_rate is NOT NULL with no default, so sqm_fixed plans store 0 (the V2
--   mapper ignores hourly_rate for sqm_fixed and reads price_per_sqm_excl_vat).
do $$
declare
  v_company_id     uuid;
  v_company_legacy text;
  v_moveout_id     uuid;
  v_moveout_legacy text;
begin
  -- Resolve the same dev/test company the prior calculator migrations target.
  select cs.company_id, cs.company_legacy_id
    into v_company_id, v_company_legacy
  from calculator_settings cs
  where cs.public_slug = 'rakna-ut-ditt-pris'
    and cs.deleted_at is null
  order by cs.created_at asc
  limit 1;

  if v_company_id is null then
    raise notice '0073 seed skipped: calculator settings for rakna-ut-ditt-pris not found.';
    return;
  end if;

  select id, legacy_id into v_moveout_id, v_moveout_legacy
  from calculator_services
  where company_id = v_company_id
    and service_key = 'move_out_cleaning'
    and deleted_at is null
  limit 1;

  if v_moveout_id is null then
    raise notice '0073 seed skipped: move_out_cleaning service not found for company "%".', v_company_legacy;
    return;
  end if;

  insert into cleaning_plans (
    legacy_id, company_id, company_legacy_id,
    calculator_service_id, calculator_service_legacy_id, service_key,
    plan_key, name, description, hourly_rate,
    price_per_sqm_excl_vat, fixed_adjustment_excl_vat, minimum_price_excl_vat,
    is_default, active, sort_order, data
  ) values
    (
      'clean_plan_moveout_good_condition_' || v_company_legacy, v_company_id, v_company_legacy,
      v_moveout_id, v_moveout_legacy, 'move_out_cleaning',
      'good_condition', 'Mycket gott skick',
      'Bostaden är i mycket gott skick och kräver mindre arbete.', 0,
      30, 0, 1500,
      false, true, 1, '{}'::jsonb
    ),
    (
      'clean_plan_moveout_normal_condition_' || v_company_legacy, v_company_id, v_company_legacy,
      v_moveout_id, v_moveout_legacy, 'move_out_cleaning',
      'normal_condition', 'Normalt skick',
      'Normalt skick. Standardpris för flyttstädning.', 0,
      35, 0, 1500,
      true, true, 2, '{}'::jsonb
    ),
    (
      'clean_plan_moveout_heavy_condition_' || v_company_legacy, v_company_id, v_company_legacy,
      v_moveout_id, v_moveout_legacy, 'move_out_cleaning',
      'heavy_condition', 'Mycket att göra',
      'Mer omfattande arbete krävs.', 0,
      42, 0, 1800,
      false, true, 3, '{}'::jsonb
    )
  on conflict (legacy_id) do nothing;

  raise notice '0073 applied: move_out_cleaning seeded with 3 condition plans for company "%".', v_company_legacy;
end $$;
