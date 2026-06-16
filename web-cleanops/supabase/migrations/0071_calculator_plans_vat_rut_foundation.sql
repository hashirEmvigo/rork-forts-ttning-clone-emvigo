-- ============================================================================
-- 0071 — Calculator Plans/VAT/RUT foundation (Phase 1)
-- ============================================================================
-- Scope:
--   • Extend cleaning_plans for service-scoped Home/Office plans.
--   • Add plan-level VAT + RUT calculation/display fields.
--   • Add calculator_settings.default_vat_rate_percent.
--   • Seed Office Cleaning plan rows without enabling office plan pricing.
--   • Preserve old rows, old rule keys, quote history, and calculator enabled state.
--   • No hard deletes. No RLS changes. Safe to re-run.
-- ============================================================================

alter table calculator_settings
  add column if not exists default_vat_rate_percent numeric not null default 25;

alter table cleaning_plans
  add column if not exists calculator_service_id uuid references calculator_services(id) on delete set null,
  add column if not exists calculator_service_legacy_id text,
  add column if not exists service_key text not null default 'home_cleaning',
  add column if not exists vat_rate_percent numeric not null default 25,
  add column if not exists price_adjustment_type text not null default 'fixed_amount',
  add column if not exists price_adjustment_value numeric not null default 0,
  add column if not exists rut_eligible boolean not null default false,
  add column if not exists rut_enabled boolean not null default false,
  add column if not exists rut_percent numeric not null default 50,
  add column if not exists rut_apply_to text not null default 'total_customer_price',
  add column if not exists show_rut_breakdown boolean not null default true;

-- Add constraints idempotently (Postgres does not support IF NOT EXISTS for ADD CONSTRAINT).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'cleaning_plans_vat_rate_percent_check'
  ) then
    alter table cleaning_plans
      add constraint cleaning_plans_vat_rate_percent_check check (vat_rate_percent >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'cleaning_plans_price_adjustment_type_check'
  ) then
    alter table cleaning_plans
      add constraint cleaning_plans_price_adjustment_type_check
      check (price_adjustment_type in ('fixed_amount', 'percent'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'cleaning_plans_rut_percent_check'
  ) then
    alter table cleaning_plans
      add constraint cleaning_plans_rut_percent_check check (rut_percent >= 0 and rut_percent <= 100);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'cleaning_plans_rut_apply_to_check'
  ) then
    alter table cleaning_plans
      add constraint cleaning_plans_rut_apply_to_check
      check (rut_apply_to in ('total_customer_price', 'labor_service_price_only'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'calculator_settings_default_vat_rate_percent_check'
  ) then
    alter table calculator_settings
      add constraint calculator_settings_default_vat_rate_percent_check
      check (default_vat_rate_percent >= 0);
  end if;
end $$;

-- Replace company-scoped plan uniqueness with service-scoped uniqueness.
drop index if exists uq_cleaning_plans_company_key_live;
drop index if exists uq_cleaning_plans_one_default_per_company;

create unique index if not exists uq_cleaning_plans_company_service_key_live
  on cleaning_plans(company_id, service_key, plan_key) where deleted_at is null;

create unique index if not exists uq_cleaning_plans_one_default_per_service
  on cleaning_plans(company_id, service_key) where is_default and deleted_at is null;

create index if not exists idx_cleaning_plans_company_service_sort
  on cleaning_plans(company_id, service_key, sort_order) where deleted_at is null;

do $$
declare
  v_company_id uuid;
  v_company_legacy text;
  v_home_id uuid;
  v_home_legacy text;
  v_office_id uuid;
  v_office_legacy text;
  v_office_hourly numeric;
begin
  -- Resolve the same dev/test company used by the prior calculator migrations.
  select cs.company_id, cs.company_legacy_id
    into v_company_id, v_company_legacy
  from calculator_settings cs
  where cs.public_slug = 'rakna-ut-ditt-pris'
    and cs.deleted_at is null
  order by cs.created_at asc
  limit 1;

  if v_company_id is null then
    raise notice '0071 skipped: calculator settings for rakna-ut-ditt-pris not found.';
    return;
  end if;

  select id, legacy_id into v_home_id, v_home_legacy
  from calculator_services
  where company_id = v_company_id
    and service_key = 'home_cleaning'
    and deleted_at is null
  limit 1;

  select id, legacy_id into v_office_id, v_office_legacy
  from calculator_services
  where company_id = v_company_id
    and service_key = 'office_cleaning'
    and deleted_at is null
  limit 1;

  update calculator_settings
  set default_vat_rate_percent = coalesce(default_vat_rate_percent, 25)
  where company_id = v_company_id
    and deleted_at is null;

  -- Existing seeded plans are Home Cleaning plans. Preserve ids/legacy ids/rates.
  if v_home_id is not null then
    update cleaning_plans
    set calculator_service_id = coalesce(calculator_service_id, v_home_id),
        calculator_service_legacy_id = coalesce(calculator_service_legacy_id, v_home_legacy),
        service_key = coalesce(nullif(service_key, ''), 'home_cleaning'),
        vat_rate_percent = coalesce(vat_rate_percent, 25),
        rut_eligible = true,
        rut_enabled = true,
        rut_percent = coalesce(rut_percent, 50),
        rut_apply_to = coalesce(nullif(rut_apply_to, ''), 'total_customer_price'),
        show_rut_breakdown = true
    where company_id = v_company_id
      and deleted_at is null
      and (service_key is null or service_key = 'home_cleaning');

    update calculator_services
    set settings_json = coalesce(settings_json, '{}'::jsonb)
      || jsonb_build_object(
        'requiresCleaningPlan', true,
        'plansEnabled', true,
        'planPricingModel', coalesce(settings_json ->> 'planPricingModel', 'hourly_rate_by_plan'),
        'defaultPlanKey', coalesce(settings_json ->> 'defaultPlanKey', 'flexible'),
        'baseHourlyRateExclVat', coalesce((settings_json ->> 'baseHourlyRateExclVat')::numeric, 399),
        'defaultVatRatePercent', coalesce((settings_json ->> 'defaultVatRatePercent')::numeric, 25)
      )
    where id = v_home_id;
  end if;

  -- Office pricing remains rule-driven unless explicitly enabled in admin.
  if v_office_id is not null then
    select pr.value_numeric into v_office_hourly
    from pricing_rules pr
    where pr.company_id = v_company_id
      and pr.calculator_service_id = v_office_id
      and pr.rule_key = 'hourly_rate'
      and pr.deleted_at is null
    order by pr.active desc, pr.sort_order asc
    limit 1;

    update calculator_services
    set settings_json = coalesce(settings_json, '{}'::jsonb)
      || jsonb_build_object(
        'requiresCleaningPlan', false,
        'plansEnabled', false,
        'planPricingModel', coalesce(settings_json ->> 'planPricingModel', 'hourly_rate_by_plan'),
        'defaultPlanKey', coalesce(settings_json ->> 'defaultPlanKey', 'standard'),
        'baseHourlyRateExclVat', coalesce((settings_json ->> 'baseHourlyRateExclVat')::numeric, v_office_hourly),
        'defaultVatRatePercent', coalesce((settings_json ->> 'defaultVatRatePercent')::numeric, 25)
      )
    where id = v_office_id;

    insert into cleaning_plans (
      legacy_id, company_id, company_legacy_id,
      calculator_service_id, calculator_service_legacy_id, service_key,
      plan_key, name, description, hourly_rate, vat_rate_percent,
      price_adjustment_type, price_adjustment_value,
      rut_eligible, rut_enabled, rut_percent, rut_apply_to, show_rut_breakdown,
      flexibility_level, customer_day_time_control, same_staff_preference_level,
      booking_priority, cancellation_terms_summary,
      is_default, active, sort_order, data
    ) values
      (
        'clean_plan_office_standard_' || v_company_legacy, v_company_id, v_company_legacy,
        v_office_id, v_office_legacy, 'office_cleaning',
        'standard', 'Standard', 'Standardupplägg för kontorsstädning.', coalesce(v_office_hourly, 0), 25,
        'fixed_amount', 0,
        false, false, 50, 'total_customer_price', false,
        'medium', 'preferred', 'medium', 'standard', null,
        true, true, 1, '{}'::jsonb
      ),
      (
        'clean_plan_office_fixed_' || v_company_legacy, v_company_id, v_company_legacy,
        v_office_id, v_office_legacy, 'office_cleaning',
        'fixed', 'Fast', 'Fast återkommande upplägg för kontorsstädning.', coalesce(v_office_hourly, 0), 25,
        'fixed_amount', 0,
        false, false, 50, 'total_customer_price', false,
        'low', 'guaranteed', 'medium', 'elevated', null,
        false, true, 2, '{}'::jsonb
      ),
      (
        'clean_plan_office_priority_' || v_company_legacy, v_company_id, v_company_legacy,
        v_office_id, v_office_legacy, 'office_cleaning',
        'priority', 'Prioritet', 'Prioriterat upplägg för kontorsstädning.', coalesce(v_office_hourly, 0), 25,
        'fixed_amount', 0,
        false, false, 50, 'total_customer_price', false,
        'low', 'guaranteed', 'high', 'priority', null,
        false, true, 3, '{}'::jsonb
      )
    on conflict (legacy_id) do update
      set calculator_service_id = excluded.calculator_service_id,
          calculator_service_legacy_id = excluded.calculator_service_legacy_id,
          service_key = excluded.service_key,
          vat_rate_percent = excluded.vat_rate_percent,
          rut_eligible = excluded.rut_eligible,
          rut_enabled = excluded.rut_enabled,
          rut_percent = excluded.rut_percent,
          rut_apply_to = excluded.rut_apply_to,
          show_rut_breakdown = excluded.show_rut_breakdown;
  end if;

  -- Do not activate the calculator.
  update calculator_settings
  set enabled = enabled
  where company_id = v_company_id
    and deleted_at is null;
end $$;
