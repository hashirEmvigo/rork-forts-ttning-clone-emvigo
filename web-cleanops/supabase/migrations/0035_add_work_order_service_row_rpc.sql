-- ============================================================================
-- CleanOps — CORE-WRITES-WORKORDERS-A1.2.1
-- Add one Work Order service row transactionally
-- ============================================================================
--
-- This RPC is intentionally narrow: it appends exactly one service row to the
-- parent work_orders.data.serviceRows aggregate, updates service_row_count, and
-- inserts the matching flat work_order_service_rows record in one database
-- transaction. It does not touch booking_queue, occurrence exceptions,
-- protocols, time reporting, invoices, staffing lifecycle, or any auth/profile
-- table.
-- ============================================================================

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

  return jsonb_build_object(
    'workOrder', updated_parent.data,
    'serviceRow', row_data,
    'serviceRowCount', updated_parent.service_row_count
  );
end;
$$;

grant execute on function public.add_work_order_service_row(jsonb) to authenticated;
