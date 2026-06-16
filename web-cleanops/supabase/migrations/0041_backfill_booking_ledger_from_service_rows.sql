-- ============================================================================
-- CleanOps — BL-1: one-time backfill of booking_ledger from existing service rows
-- ============================================================================
--
-- Generation normally happens at add-time through add_work_order_service_row ->
-- generate_booking_ledger_for_service_row (migration 0040). Service rows created
-- BEFORE 0040 was applied have no booking_ledger entries yet, so they never appear
-- in Booking List. This backfill reproduces the exact same booking_id /
-- booking_series_id formulas and the same Booking Generation Horizon / service-end
-- bounds, so already-created AO services surface in Booking List without re-adding.
--
-- Safe to re-run: the unique (company_id, service_row_id, booking_date) key plus
-- "on conflict do nothing" makes this idempotent and convergent with future
-- add-time generation. Runs as a privileged role at apply time (no auth.uid()),
-- so it does NOT call the auth-guarded generator function; it expands occurrences
-- inline via generate_series instead.
--
-- Not in scope: Mission Log, Time Reporting, payroll, invoices, Schedule
-- automation, occurrence exceptions, Customer Portal, booking_queue.
-- ============================================================================

do $$
declare
  horizon_months integer := 6;
  horizon_end date;
begin
  if to_regclass('public.booking_ledger') is null then
    raise notice 'booking_ledger does not exist yet; skipping backfill (apply 0040 first).';
    return;
  end if;

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
    data
  )
  select
    'bkg_' || substr(md5(sr.legacy_id || ':' || occ.occurrence_date::text), 1, 24) as booking_id,
    'bks_' || substr(md5(wo.legacy_id || ':' || sr.legacy_id), 1, 24)              as booking_series_id,
    wo.company_id,
    wo.company_legacy_id,
    wo.customer_legacy_id,
    wo.legacy_id,
    sr.legacy_id,
    occ.occurrence_date::text,
    nullif(btrim(coalesce(sr.planned_start_time, '')), ''),
    nullif(btrim(coalesce(sr.planned_end_time, '')), ''),
    'scheduled',
    'unplanned',
    'not_started',
    'not_ready',
    'not_ready',
    jsonb_build_object(
      'bookingId', 'bkg_' || substr(md5(sr.legacy_id || ':' || occ.occurrence_date::text), 1, 24),
      'bookingSeriesId', 'bks_' || substr(md5(wo.legacy_id || ':' || sr.legacy_id), 1, 24),
      'companyId', wo.company_legacy_id,
      'customerId', wo.customer_legacy_id,
      'workOrderId', wo.legacy_id,
      'serviceRowId', sr.legacy_id,
      'bookingDate', occ.occurrence_date::text,
      'plannedStartTime', nullif(btrim(coalesce(sr.planned_start_time, '')), ''),
      'plannedEndTime', nullif(btrim(coalesce(sr.planned_end_time, '')), ''),
      'bookingStatus', 'scheduled',
      'planningStatus', 'unplanned',
      'executionStatus', 'not_started',
      'billingStatus', 'not_ready',
      'payrollStatus', 'not_ready',
      'recurrenceInterval', coalesce(nullif(btrim(coalesce(sr.recurrence_interval, '')), ''), 'one_time'),
      'source', 'ao_service_row_backfill'
    )
  from public.work_order_service_rows sr
  join public.work_orders wo
    on wo.legacy_id = sr.work_order_legacy_id
   and wo.deleted_at is null
  cross join lateral (
    select gs::date as occurrence_date
    from generate_series(
      sr.service_date::date,
      case
        when coalesce(nullif(btrim(coalesce(sr.recurrence_interval, '')), ''), 'one_time') = 'one_time'
          then sr.service_date::date
        else least(
          horizon_end,
          coalesce(nullif(btrim(coalesce(sr.service_end_date, '')), '')::date, horizon_end)
        )
      end,
      case coalesce(nullif(btrim(coalesce(sr.recurrence_interval, '')), ''), 'one_time')
        when 'one_time' then interval '100 years'
        when 'daily' then interval '1 day'
        when 'every_2_days' then interval '2 days'
        when 'every_3_days' then interval '3 days'
        when 'weekly' then interval '7 days'
        when 'every_2_weeks' then interval '14 days'
        when 'every_2_weeks_monday' then interval '14 days'
        when 'every_3_weeks' then interval '21 days'
        when 'every_4_weeks' then interval '28 days'
        when 'monthly' then interval '1 month'
        when 'every_3_months' then interval '3 months'
        when 'every_6_months' then interval '6 months'
        when 'yearly' then interval '12 months'
        else interval '100 years'
      end
    ) as gs
  ) occ
  where sr.deleted_at is null
    and sr.archived is not true
    and wo.company_id is not null
    and sr.service_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    and coalesce(nullif(btrim(coalesce(sr.recurrence_interval, '')), ''), 'one_time') in (
      'one_time', 'daily', 'every_2_days', 'every_3_days', 'weekly',
      'every_2_weeks', 'every_2_weeks_monday', 'every_3_weeks', 'every_4_weeks',
      'monthly', 'every_3_months', 'every_6_months', 'yearly'
    )
  on conflict (company_id, service_row_id, booking_date) do nothing;
end $$;
