-- ============================================================================
-- CleanOps — BL-1: Booking Ledger foundation
-- ============================================================================
--
-- New target model: AO / WorkOrder service rows generate real booking jobs.
-- This migration intentionally does NOT extend booking_queue. booking_queue stays
-- legacy one-row-per-service-row snapshot storage while Booking List reads from
-- booking_ledger.
--
-- Scope:
--   1. Create booking_ledger: one row per actual generated booking occurrence.
--   2. Add a narrow generator for one service row.
--   3. Replace add_work_order_service_row so service-row creation and booking
--      generation happen in the same database transaction.
--
-- Not in scope: Mission Log, Time Reporting, payroll, invoices, Schedule
-- automation, occurrence exceptions, Customer Portal, localStorage, backout
-- bridges, dirty-browser rehydration, offline queues.
-- ============================================================================

create or replace function set_booking_ledger_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists booking_ledger (
  id                  uuid primary key default gen_random_uuid(),
  booking_id          text unique not null,
  booking_series_id   text not null,
  company_id          uuid references companies(id) on delete cascade,
  company_legacy_id   text not null,
  customer_id         text not null,
  work_order_id       text not null,
  service_row_id      text not null,
  booking_date        text not null,
  planned_start_time  text,
  planned_end_time    text,
  booking_status      text not null default 'scheduled',
  planning_status     text not null default 'unplanned',
  execution_status    text not null default 'not_started',
  billing_status      text not null default 'not_ready',
  payroll_status      text not null default 'not_ready',
  data                jsonb not null default '{}'::jsonb,
  deleted_at          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint booking_ledger_booking_status_check
    check (booking_status in ('scheduled', 'cancelled', 'completed')),
  constraint booking_ledger_planning_status_check
    check (planning_status in ('unplanned', 'planned')),
  constraint booking_ledger_execution_status_check
    check (execution_status in ('not_started', 'in_progress', 'completed', 'cancelled')),
  constraint booking_ledger_billing_status_check
    check (billing_status in ('not_ready', 'ready', 'billed')),
  constraint booking_ledger_payroll_status_check
    check (payroll_status in ('not_ready', 'ready', 'processed')),
  constraint booking_ledger_booking_date_check
    check (booking_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  constraint booking_ledger_no_duplicate_service_date
    unique (company_id, service_row_id, booking_date)
);

create index if not exists idx_booking_ledger_company_date
  on booking_ledger(company_id, booking_date);
create index if not exists idx_booking_ledger_companylegacy_date
  on booking_ledger(company_legacy_id, booking_date);
create index if not exists idx_booking_ledger_series
  on booking_ledger(company_id, booking_series_id, booking_date);
create index if not exists idx_booking_ledger_work_order
  on booking_ledger(work_order_id);
create index if not exists idx_booking_ledger_service_row
  on booking_ledger(service_row_id);
create index if not exists idx_booking_ledger_customer
  on booking_ledger(customer_id);
create index if not exists idx_booking_ledger_active
  on booking_ledger(company_id) where deleted_at is null;

drop trigger if exists trg_booking_ledger_updated_at on booking_ledger;
create trigger trg_booking_ledger_updated_at
  before update on booking_ledger
  for each row execute function set_booking_ledger_updated_at();

alter table booking_ledger enable row level security;

drop policy if exists "booking_ledger_select_own_company" on booking_ledger;
create policy "booking_ledger_select_own_company" on booking_ledger
  for select to authenticated
  using (company_id is not null and company_id = current_company_id());

drop policy if exists "booking_ledger_select_super_admin" on booking_ledger;
create policy "booking_ledger_select_super_admin" on booking_ledger
  for select to authenticated
  using (is_super_admin());

drop policy if exists "booking_ledger_insert_own_company" on booking_ledger;
create policy "booking_ledger_insert_own_company" on booking_ledger
  for insert to authenticated
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "booking_ledger_insert_super_admin" on booking_ledger;
create policy "booking_ledger_insert_super_admin" on booking_ledger
  for insert to authenticated
  with check (is_super_admin());

drop policy if exists "booking_ledger_update_own_company" on booking_ledger;
create policy "booking_ledger_update_own_company" on booking_ledger
  for update to authenticated
  using (company_id is not null and company_id = current_company_id())
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "booking_ledger_update_super_admin" on booking_ledger;
create policy "booking_ledger_update_super_admin" on booking_ledger
  for update to authenticated
  using (is_super_admin())
  with check (is_super_admin());

-- No DELETE policy. Future removal/cancellation must be an explicit lifecycle
-- update, not a hard delete.

create or replace function public.generate_booking_ledger_for_service_row(input jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  input_company_id uuid := nullif(input ->> 'company_id', '')::uuid;
  input_company_legacy_id text := btrim(coalesce(input ->> 'company_legacy_id', ''));
  input_customer_id text := btrim(coalesce(input ->> 'customer_id', ''));
  input_work_order_id text := btrim(coalesce(input ->> 'work_order_id', ''));
  row_data jsonb := input -> 'row';
  row_legacy_id text;
  recurrence_interval text;
  service_start_date date;
  service_end_date date;
  horizon_months integer := 6;
  horizon_end date;
  upper_date date;
  occurrence_date date;
  occurrence_index integer := 0;
  step_days integer := null;
  step_months integer := null;
  booking_id text;
  booking_series_id text;
  inserted_count integer := 0;
  affected_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required to generate booking ledger rows.';
  end if;

  if input_company_id is null then
    raise exception 'Supabase company id is required to generate booking ledger rows.';
  end if;

  if input_company_legacy_id = '' then
    raise exception 'Company scope is required to generate booking ledger rows.';
  end if;

  if input_customer_id = '' then
    raise exception 'Customer id is required to generate booking ledger rows.';
  end if;

  if input_work_order_id = '' then
    raise exception 'Work order id is required to generate booking ledger rows.';
  end if;

  if row_data is null or jsonb_typeof(row_data) <> 'object' then
    raise exception 'Service row payload is required to generate booking ledger rows.';
  end if;

  row_legacy_id := btrim(coalesce(row_data ->> 'id', ''));
  if row_legacy_id = '' then
    raise exception 'Service row id is required to generate booking ledger rows.';
  end if;

  if btrim(coalesce(row_data ->> 'serviceDate', '')) = '' then
    raise exception 'Service date is required to generate booking ledger rows.';
  end if;

  service_start_date := (row_data ->> 'serviceDate')::date;
  recurrence_interval := coalesce(nullif(btrim(coalesce(row_data ->> 'recurrenceInterval', '')), ''), 'one_time');
  booking_series_id := 'bks_' || substr(md5(input_work_order_id || ':' || row_legacy_id), 1, 24);

  -- Booking Generation Horizon (Super Admin setting). Guarded with to_regclass so a
  -- not-yet-applied system_settings table can never abort service-row creation; the
  -- horizon then falls back to the 6-month default declared above.
  if to_regclass('public.system_settings') is not null then
    select coalesce(
             max(
               case
                 when (data ->> 'bookingGenerationHorizonMonths') ~ '^(1|3|6|12)$'
                   then (data ->> 'bookingGenerationHorizonMonths')::integer
                 else null
               end
             ),
             6
           )
      into horizon_months
      from public.system_settings
     where legacy_id = 'global'
       and deleted_at is null;
  end if;

  horizon_end := (current_date + make_interval(months => horizon_months))::date;

  if recurrence_interval = 'one_time' then
    upper_date := service_start_date;
  else
    if btrim(coalesce(row_data ->> 'serviceEndDate', '')) <> '' then
      service_end_date := (row_data ->> 'serviceEndDate')::date;
      if service_end_date < service_start_date then
        raise exception 'Service end date must be on or after the service date.';
      end if;
      upper_date := least(horizon_end, service_end_date);
    else
      upper_date := horizon_end;
    end if;
  end if;

  case recurrence_interval
    when 'one_time' then step_days := null;
    when 'daily' then step_days := 1;
    when 'every_2_days' then step_days := 2;
    when 'every_3_days' then step_days := 3;
    when 'weekly' then step_days := 7;
    when 'every_2_weeks' then step_days := 14;
    when 'every_2_weeks_monday' then step_days := 14;
    when 'every_3_weeks' then step_days := 21;
    when 'every_4_weeks' then step_days := 28;
    when 'monthly' then step_months := 1;
    when 'every_3_months' then step_months := 3;
    when 'every_6_months' then step_months := 6;
    when 'yearly' then step_months := 12;
    else raise exception 'Unsupported recurrence interval for booking generation: %', recurrence_interval;
  end case;

  loop
    if recurrence_interval = 'one_time' then
      occurrence_date := service_start_date;
    elsif step_days is not null then
      occurrence_date := service_start_date + (occurrence_index * step_days);
    else
      occurrence_date := (service_start_date + make_interval(months => occurrence_index * step_months))::date;
    end if;

    exit when occurrence_date > upper_date;
    exit when occurrence_index >= 500;

    booking_id := 'bkg_' || substr(md5(row_legacy_id || ':' || occurrence_date::text), 1, 24);

    insert into public.booking_ledger (
      booking_id,
      booking_series_id,
      company_id,
      company_legacy_id,
      customer_id,
      work_order_id,
      service_row_id,
      booking_date,
      planned_start_time,
      planned_end_time,
      booking_status,
      planning_status,
      execution_status,
      billing_status,
      payroll_status,
      deleted_at,
      data
    ) values (
      booking_id,
      booking_series_id,
      input_company_id,
      input_company_legacy_id,
      input_customer_id,
      input_work_order_id,
      row_legacy_id,
      occurrence_date::text,
      nullif(btrim(coalesce(row_data ->> 'plannedStartTime', '')), ''),
      nullif(btrim(coalesce(row_data ->> 'plannedEndTime', '')), ''),
      'scheduled',
      'unplanned',
      'not_started',
      'not_ready',
      'not_ready',
      null,
      jsonb_build_object(
        'bookingId', booking_id,
        'bookingSeriesId', booking_series_id,
        'companyId', input_company_legacy_id,
        'customerId', input_customer_id,
        'workOrderId', input_work_order_id,
        'serviceRowId', row_legacy_id,
        'bookingDate', occurrence_date::text,
        'plannedStartTime', nullif(btrim(coalesce(row_data ->> 'plannedStartTime', '')), ''),
        'plannedEndTime', nullif(btrim(coalesce(row_data ->> 'plannedEndTime', '')), ''),
        'bookingStatus', 'scheduled',
        'planningStatus', 'unplanned',
        'executionStatus', 'not_started',
        'billingStatus', 'not_ready',
        'payrollStatus', 'not_ready',
        'recurrenceInterval', recurrence_interval,
        'source', 'ao_service_row'
      )
    )
    on conflict (company_id, service_row_id, booking_date) do nothing;

    get diagnostics affected_count = row_count;
    inserted_count := inserted_count + affected_count;

    exit when recurrence_interval = 'one_time';
    occurrence_index := occurrence_index + 1;
  end loop;

  return inserted_count;
end;
$$;

grant execute on function public.generate_booking_ledger_for_service_row(jsonb) to authenticated;

create or replace function public.add_work_order_service_row(input jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  parent_row public.work_orders%rowtype;
  updated_parent public.work_orders%rowtype;
  row_data jsonb := input -> 'row';
  input_company_legacy_id text := btrim(coalesce(input ->> 'company_legacy_id', ''));
  input_company_id uuid := nullif(input ->> 'company_id', '')::uuid;
  input_work_order_legacy_id text := btrim(coalesce(input ->> 'work_order_legacy_id', ''));
  row_legacy_id text;
  existing_rows jsonb;
  next_rows jsonb;
  next_data jsonb;
  next_sort_order integer;
  assigned_employee_ids text[];
  service_name text;
  service_date text;
  recurrence_interval text;
  generated_booking_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required to add a work order service row.';
  end if;

  if input_company_legacy_id = '' then
    raise exception 'Company scope is required to add a work order service row.';
  end if;

  if input_company_id is null then
    raise exception 'Supabase company id is required to add a work order service row.';
  end if;

  if input_work_order_legacy_id = '' then
    raise exception 'Work order id is required to add a service row.';
  end if;

  if row_data is null or jsonb_typeof(row_data) <> 'object' then
    raise exception 'Service row payload is required.';
  end if;

  row_legacy_id := btrim(coalesce(row_data ->> 'id', ''));
  service_name := btrim(coalesce(row_data ->> 'serviceName', ''));
  service_date := btrim(coalesce(row_data ->> 'serviceDate', ''));
  recurrence_interval := coalesce(nullif(btrim(coalesce(row_data ->> 'recurrenceInterval', '')), ''), 'one_time');

  if row_legacy_id = '' then
    raise exception 'Service row id is required.';
  end if;

  if btrim(coalesce(row_data ->> 'sourceServiceId', '')) = '' then
    raise exception 'Selected service id is required.';
  end if;

  if service_name = '' then
    raise exception 'Service name is required.';
  end if;

  if service_date = '' then
    raise exception 'Service date is required.';
  end if;

  if recurrence_interval = 'one_time' then
    row_data := row_data - 'serviceEndDate';
  elsif btrim(coalesce(row_data ->> 'serviceEndDate', '')) <> '' and (row_data ->> 'serviceEndDate') < service_date then
    raise exception 'Service end date must be on or after the service date.';
  end if;

  select *
    into parent_row
    from public.work_orders
   where legacy_id = input_work_order_legacy_id
   for update;

  if not found then
    raise exception 'Work order not found.';
  end if;

  if parent_row.deleted_at is not null then
    raise exception 'Cannot add a service row to a deleted work order.';
  end if;

  if parent_row.company_id is distinct from input_company_id
     or parent_row.company_legacy_id <> input_company_legacy_id then
    raise exception 'Work order company scope mismatch.';
  end if;

  if not (
    public.is_super_admin()
    or (parent_row.company_id is not null and parent_row.company_id = public.current_company_id())
  ) then
    raise exception 'Not authorized to add a service row for this company.';
  end if;

  existing_rows := coalesce(parent_row.data -> 'serviceRows', '[]'::jsonb);
  if jsonb_typeof(existing_rows) <> 'array' then
    raise exception 'Work order service row aggregate is invalid.';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(existing_rows) as existing(row_json)
     where existing.row_json ->> 'id' = row_legacy_id
  ) then
    raise exception 'Service row already exists on this work order.';
  end if;

  if exists (
    select 1
      from public.work_order_service_rows
     where legacy_id = row_legacy_id
       and deleted_at is null
  ) then
    raise exception 'Service row id already exists.';
  end if;

  select coalesce(max((existing.row_json ->> 'sortOrder')::integer), -1) + 1
    into next_sort_order
    from jsonb_array_elements(existing_rows) as existing(row_json)
   where (existing.row_json ->> 'sortOrder') ~ '^-?[0-9]+$';

  next_sort_order := coalesce(next_sort_order, 0);
  row_data := jsonb_set(row_data, '{sortOrder}', to_jsonb(next_sort_order), true);
  row_data := jsonb_set(row_data, '{archived}', 'false'::jsonb, true);

  assigned_employee_ids := coalesce(
    array(select jsonb_array_elements_text(coalesce(row_data -> 'assignedEmployeeIds', '[]'::jsonb))),
    '{}'::text[]
  );

  next_rows := existing_rows || jsonb_build_array(row_data);
  next_data := jsonb_set(parent_row.data, '{serviceRows}', next_rows, true);
  if btrim(coalesce(row_data ->> 'updatedAt', '')) <> '' then
    next_data := jsonb_set(next_data, '{updatedAt}', to_jsonb(row_data ->> 'updatedAt'), true);
  end if;

  update public.work_orders
     set data = next_data,
         service_row_count = jsonb_array_length(next_rows),
         updated_at = now()
   where id = parent_row.id
   returning * into updated_parent;

  insert into public.work_order_service_rows (
    legacy_id,
    company_id,
    company_legacy_id,
    work_order_legacy_id,
    service_name,
    article_number,
    status,
    archived,
    service_date,
    service_end_date,
    planned_start_time,
    planned_end_time,
    recurrence_interval,
    assigned_employee_ids,
    unassigned_employee_slots,
    sort_order,
    variation_count,
    deleted_at,
    data
  ) values (
    row_legacy_id,
    parent_row.company_id,
    parent_row.company_legacy_id,
    parent_row.legacy_id,
    service_name,
    nullif(btrim(coalesce(row_data ->> 'articleNumber', '')), ''),
    coalesce(nullif(btrim(coalesce(row_data ->> 'status', '')), ''), 'planned'),
    false,
    service_date,
    nullif(btrim(coalesce(row_data ->> 'serviceEndDate', '')), ''),
    nullif(btrim(coalesce(row_data ->> 'plannedStartTime', '')), ''),
    nullif(btrim(coalesce(row_data ->> 'plannedEndTime', '')), ''),
    recurrence_interval,
    assigned_employee_ids,
    greatest(0, coalesce(nullif(row_data ->> 'unassignedEmployeeSlots', '')::integer, 0)),
    next_sort_order,
    jsonb_array_length(coalesce(row_data -> 'variations', '[]'::jsonb)),
    null,
    row_data
  );

  generated_booking_count := public.generate_booking_ledger_for_service_row(jsonb_build_object(
    'company_id', parent_row.company_id,
    'company_legacy_id', parent_row.company_legacy_id,
    'customer_id', parent_row.customer_legacy_id,
    'work_order_id', parent_row.legacy_id,
    'row', row_data
  ));

  if generated_booking_count < 1 then
    raise exception 'Service row did not generate any booking ledger rows.';
  end if;

  return jsonb_build_object(
    'workOrder', updated_parent.data,
    'serviceRow', row_data,
    'serviceRowCount', updated_parent.service_row_count,
    'generatedBookingCount', generated_booking_count
  );
end;
$$;

grant execute on function public.add_work_order_service_row(jsonb) to authenticated;
