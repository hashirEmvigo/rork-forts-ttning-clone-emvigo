-- ============================================================================
-- 0072 — Home Cleaning Pricing Blocks + editable size bands (Phase 2)
-- ============================================================================
-- Scope:
--   • Add calculator_size_bands for business-friendly Home Cleaning time rules.
--   • Seed editable Home Cleaning defaults. These are defaults, not hardcoded truth.
--   • Preserve old pricing_rules as fallback and Advanced recovery rules.
--   • No calculator activation. No manual SQL required. Safe to re-run.
-- ============================================================================

create table if not exists calculator_size_bands (
  id uuid primary key default gen_random_uuid(),
  legacy_id text not null unique,
  company_id uuid not null references companies(id) on delete cascade,
  company_legacy_id text not null,
  calculator_service_id uuid not null references calculator_services(id) on delete cascade,
  calculator_service_legacy_id text,
  service_key text not null,
  min_sqm numeric not null,
  max_sqm numeric,
  recommended_hours numeric not null,
  extra_hours_per_started_10_sqm numeric,
  extra_hours_start_after_sqm numeric,
  active boolean not null default true,
  sort_order integer not null default 0,
  data jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint calculator_size_bands_min_sqm_check check (min_sqm >= 0),
  constraint calculator_size_bands_max_sqm_check check (max_sqm is null or max_sqm >= min_sqm),
  constraint calculator_size_bands_recommended_hours_check check (recommended_hours > 0),
  constraint calculator_size_bands_extra_hours_check check (extra_hours_per_started_10_sqm is null or extra_hours_per_started_10_sqm >= 0),
  constraint calculator_size_bands_extra_start_check check (extra_hours_start_after_sqm is null or extra_hours_start_after_sqm >= min_sqm)
);

create index if not exists idx_calculator_size_bands_company_service_sort
  on calculator_size_bands(company_id, service_key, sort_order) where deleted_at is null;

create index if not exists idx_calculator_size_bands_service
  on calculator_size_bands(calculator_service_id, sort_order) where deleted_at is null;

drop trigger if exists trg_calculator_size_bands_updated_at on calculator_size_bands;
create trigger trg_calculator_size_bands_updated_at
  before update on calculator_size_bands
  for each row execute function set_calculator_updated_at();

alter table calculator_size_bands enable row level security;

drop policy if exists "calculator_size_bands_select_super_admin" on calculator_size_bands;
create policy "calculator_size_bands_select_super_admin" on calculator_size_bands
  for select to authenticated using (is_super_admin());

drop policy if exists "calculator_size_bands_insert_super_admin" on calculator_size_bands;
create policy "calculator_size_bands_insert_super_admin" on calculator_size_bands
  for insert to authenticated with check (is_super_admin());

drop policy if exists "calculator_size_bands_update_super_admin" on calculator_size_bands;
create policy "calculator_size_bands_update_super_admin" on calculator_size_bands
  for update to authenticated using (is_super_admin()) with check (is_super_admin());

do $$
declare
  v_company_id uuid;
  v_company_legacy text;
  v_home_id uuid;
  v_home_legacy text;
begin
  select cs.company_id, cs.company_legacy_id
    into v_company_id, v_company_legacy
  from calculator_settings cs
  where cs.public_slug = 'rakna-ut-ditt-pris'
    and cs.deleted_at is null
  order by cs.created_at asc
  limit 1;

  if v_company_id is null then
    raise notice '0072 skipped: calculator settings for rakna-ut-ditt-pris not found.';
    return;
  end if;

  select id, legacy_id
    into v_home_id, v_home_legacy
  from calculator_services
  where company_id = v_company_id
    and service_key = 'home_cleaning'
    and deleted_at is null
  limit 1;

  if v_home_id is null then
    raise notice '0072 skipped: home_cleaning service not found.';
    return;
  end if;

  insert into calculator_size_bands (
    legacy_id, company_id, company_legacy_id,
    calculator_service_id, calculator_service_legacy_id, service_key,
    min_sqm, max_sqm, recommended_hours,
    extra_hours_per_started_10_sqm, extra_hours_start_after_sqm,
    active, sort_order, data
  ) values
    ('calc_size_home_000_060_' || v_company_legacy, v_company_id, v_company_legacy, v_home_id, v_home_legacy, 'home_cleaning', 0, 60, 2.00, null, null, true, 1, '{}'::jsonb),
    ('calc_size_home_061_070_' || v_company_legacy, v_company_id, v_company_legacy, v_home_id, v_home_legacy, 'home_cleaning', 61, 70, 2.25, null, null, true, 2, '{}'::jsonb),
    ('calc_size_home_071_090_' || v_company_legacy, v_company_id, v_company_legacy, v_home_id, v_home_legacy, 'home_cleaning', 71, 90, 2.75, null, null, true, 3, '{}'::jsonb),
    ('calc_size_home_091_110_' || v_company_legacy, v_company_id, v_company_legacy, v_home_id, v_home_legacy, 'home_cleaning', 91, 110, 3.25, null, null, true, 4, '{}'::jsonb),
    ('calc_size_home_111_130_' || v_company_legacy, v_company_id, v_company_legacy, v_home_id, v_home_legacy, 'home_cleaning', 111, 130, 3.50, null, null, true, 5, '{}'::jsonb),
    ('calc_size_home_131_plus_' || v_company_legacy, v_company_id, v_company_legacy, v_home_id, v_home_legacy, 'home_cleaning', 131, null, 4.00, 0.25, 140, true, 6, '{}'::jsonb)
  on conflict (legacy_id) do nothing;
end $$;
