-- ============================================================================
-- CleanOps — BL-1: service-row removal cleans up generated booking_ledger rows
-- ============================================================================
--
-- remove_work_order_service_row (migration 0039) was written before booking_ledger
-- existed (migration 0040). It soft-deletes the flat work_order_service_rows row but
-- never touches booking_ledger, which is the new source of truth for generated
-- bookings. As a result, removing a service row left its generated bookings visible
-- in Booking List forever.
--
-- This migration replaces remove_work_order_service_row so the SAME transaction that
-- removes a service row also soft-deletes every booking_ledger row linked to that
-- service_row_id (scoped to the parent company).
--
-- Soft delete (deleted_at), not hard delete, because:
--   * migration 0040 ships NO delete policy on booking_ledger and documents that
--     removal/cancellation must be an explicit lifecycle update, not a hard delete;
--   * it mirrors the existing work_order_service_rows soft-delete lifecycle;
--   * the Booking List reader already excludes rows where deleted_at is not null,
--     so soft-deleted bookings disappear immediately and do not resurrect on refresh.
--
-- The protected-history guards (time_reports, mission_log_entries) are preserved
-- verbatim from 0039 and still run BEFORE any mutation, so a blocked removal never
-- touches booking_ledger.
--
-- Not in scope / intentionally untouched: booking_queue, schedule, occurrence
-- exceptions, Mission Log behavior, Time Reporting behavior, payroll, invoices,
-- Customer Portal, browser/local storage.
-- ============================================================================

create or replace function public.remove_work_order_service_row(input jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  parent_row public.work_orders%rowtype;
  updated_parent public.work_orders%rowtype;
  flat_row public.work_order_service_rows%rowtype;
  updated_flat public.work_order_service_rows%rowtype;
  input_company_legacy_id text := btrim(coalesce(input ->> 'company_legacy_id', ''));
  input_company_id uuid := nullif(input ->> 'company_id', '')::uuid;
  input_work_order_legacy_id text := btrim(coalesce(input ->> 'work_order_legacy_id', ''));
  input_service_row_legacy_id text := btrim(coalesce(input ->> 'service_row_legacy_id', ''));
  existing_rows jsonb;
  target_row jsonb;
  next_rows jsonb;
  next_data jsonb;
  expected_count integer;
  removed_booking_count integer := 0;
  removed_at timestamptz := now();
  removed_at_text text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if auth.uid() is null then
    raise exception 'Authentication required to remove a work order service row.';
  end if;

  if input_company_legacy_id = '' then
    raise exception 'Company scope is required to remove a work order service row.';
  end if;

  if input_company_id is null then
    raise exception 'Supabase company id is required to remove a work order service row.';
  end if;

  if input_work_order_legacy_id = '' then
    raise exception 'Work order id is required to remove a service row.';
  end if;

  if input_service_row_legacy_id = '' then
    raise exception 'Service row id is required to remove a service row.';
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
    raise exception 'Cannot remove a service row from a deleted work order.';
  end if;

  if parent_row.company_id is distinct from input_company_id
     or parent_row.company_legacy_id <> input_company_legacy_id then
    raise exception 'Work order company scope mismatch.';
  end if;

  if not (
    public.is_super_admin()
    or (parent_row.company_id is not null and parent_row.company_id = public.current_company_id())
  ) then
    raise exception 'Not authorized to remove a service row for this company.';
  end if;

  existing_rows := coalesce(parent_row.data -> 'serviceRows', '[]'::jsonb);
  if jsonb_typeof(existing_rows) <> 'array' then
    raise exception 'Work order service row aggregate is invalid.';
  end if;

  select existing.row_json
    into target_row
    from jsonb_array_elements(existing_rows) as existing(row_json)
   where existing.row_json ->> 'id' = input_service_row_legacy_id
   limit 1;

  if target_row is null then
    raise exception 'Service row was not found in the parent work order.';
  end if;

  select *
    into flat_row
    from public.work_order_service_rows
   where legacy_id = input_service_row_legacy_id
     and work_order_legacy_id = parent_row.legacy_id
   for update;

  if not found then
    raise exception 'Service row was not found in the flat service-row table.';
  end if;

  if flat_row.deleted_at is not null then
    raise exception 'Cannot remove a deleted service row.';
  end if;

  if flat_row.company_id is distinct from parent_row.company_id
     or flat_row.company_legacy_id <> parent_row.company_legacy_id then
    raise exception 'Service row company scope mismatch.';
  end if;

  if exists (
    select 1
      from public.time_reports tr
     where tr.company_id = parent_row.company_id
       and tr.service_row_legacy_id = input_service_row_legacy_id
       and tr.deleted_at is null
     limit 1
  ) then
    raise exception 'This service has protected time reporting history and cannot be deleted.';
  end if;

  if exists (
    select 1
      from public.mission_log_entries ml
     where ml.company_id = parent_row.company_id
       and ml.service_row_legacy_id = input_service_row_legacy_id
       and ml.deleted_at is null
       and (
         ml.mission_status in ('in_progress', 'completed', 'missed', 'requires_attention')
         or ml.requires_admin_review is true
       )
     limit 1
  ) then
    raise exception 'This service has protected execution history and cannot be deleted.';
  end if;

  select coalesce(jsonb_agg(existing.row_json order by existing.ordinality), '[]'::jsonb)
    into next_rows
    from jsonb_array_elements(existing_rows) with ordinality as existing(row_json, ordinality)
   where existing.row_json ->> 'id' <> input_service_row_legacy_id;

  expected_count := jsonb_array_length(existing_rows) - 1;
  if jsonb_array_length(next_rows) <> expected_count then
    raise exception 'Removed service-row aggregate count changed unexpectedly.';
  end if;

  next_data := jsonb_set(parent_row.data, '{serviceRows}', next_rows, true);
  next_data := jsonb_set(next_data, '{updatedAt}', to_jsonb(removed_at_text), true);

  update public.work_orders
     set data = next_data,
         service_row_count = jsonb_array_length(next_rows),
         updated_at = removed_at
   where id = parent_row.id
   returning * into updated_parent;

  update public.work_order_service_rows
     set deleted_at = removed_at,
         data = jsonb_set(flat_row.data, '{updatedAt}', to_jsonb(removed_at_text), true),
         updated_at = removed_at
   where id = flat_row.id
   returning * into updated_flat;

  -- Booking Ledger cleanup (BL-1). booking_ledger is the new source of truth for
  -- generated bookings; removing the producing service row must hide them from
  -- Booking List. Soft-delete every active ledger row for this service_row_id within
  -- the parent company. Guarded with to_regclass so an environment that has not yet
  -- applied 0040 still removes service rows without error. Idempotent via the
  -- deleted_at is null filter, so re-running never double-counts.
  if to_regclass('public.booking_ledger') is not null then
    update public.booking_ledger
       set deleted_at = removed_at,
           updated_at = removed_at
     where company_id = parent_row.company_id
       and service_row_id = input_service_row_legacy_id
       and deleted_at is null;
    get diagnostics removed_booking_count = row_count;
  end if;

  return jsonb_build_object(
    'workOrder', updated_parent.data,
    'serviceRow', updated_flat.data,
    'serviceRowCount', updated_parent.service_row_count,
    'removedBookingCount', removed_booking_count
  );
end;
$$;

grant execute on function public.remove_work_order_service_row(jsonb) to authenticated;
