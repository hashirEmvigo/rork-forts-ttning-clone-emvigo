-- ============================================================================
-- CleanOps — AO-2B
-- Support Work Order service-row archive/restore in update RPC
-- ============================================================================
--
-- Extends the existing transactional service-row update RPC so the allowlisted
-- `archived` boolean can be written to both:
--   1. work_orders.data.serviceRows parent aggregate
--   2. work_order_service_rows.archived flat index + data jsonb
--
-- This remains intentionally narrow. It does not hard-delete rows and does not
-- touch booking queue, occurrence exceptions, schedule, mission log, time
-- reporting, payroll, invoices, customer portal, or local/browser storage.
-- ============================================================================

create or replace function public.update_work_order_service_row(input jsonb)
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
  patch jsonb := input -> 'patch';
  input_company_legacy_id text := btrim(coalesce(input ->> 'company_legacy_id', ''));
  input_company_id uuid := nullif(input ->> 'company_id', '')::uuid;
  input_work_order_legacy_id text := btrim(coalesce(input ->> 'work_order_legacy_id', ''));
  input_service_row_legacy_id text := btrim(coalesce(input ->> 'service_row_legacy_id', ''));
  allowed_keys text[] := array[
    'serviceName',
    'articleNumber',
    'categoryName',
    'serviceType',
    'quantity',
    'unit',
    'price',
    'vat',
    'status',
    'notes',
    'serviceDate',
    'serviceEndDate',
    'plannedStartTime',
    'plannedEndTime',
    'recurrenceInterval',
    'archived',
    'updatedAt'
  ];
  bad_key text;
  existing_rows jsonb;
  target_row jsonb;
  patched_row jsonb;
  next_rows jsonb;
  next_data jsonb;
  effective_service_name text;
  effective_service_date text;
  effective_service_end_date text;
  effective_start_time text;
  effective_end_time text;
  effective_recurrence_interval text;
  effective_status text;
  expected_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required to update a work order service row.';
  end if;

  if input_company_legacy_id = '' then
    raise exception 'Company scope is required to update a work order service row.';
  end if;

  if input_company_id is null then
    raise exception 'Supabase company id is required to update a work order service row.';
  end if;

  if input_work_order_legacy_id = '' then
    raise exception 'Work order id is required to update a service row.';
  end if;

  if input_service_row_legacy_id = '' then
    raise exception 'Service row id is required to update a service row.';
  end if;

  if patch is null or jsonb_typeof(patch) <> 'object' or patch = '{}'::jsonb then
    raise exception 'Service row patch is required.';
  end if;

  select key
    into bad_key
    from jsonb_object_keys(patch) as keys(key)
   where not (key = any(allowed_keys))
   limit 1;

  if bad_key is not null then
    raise exception 'Field "%" cannot be updated by this service-row RPC.', bad_key;
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
    raise exception 'Cannot update a service row on a deleted work order.';
  end if;

  if parent_row.company_id is distinct from input_company_id
     or parent_row.company_legacy_id <> input_company_legacy_id then
    raise exception 'Work order company scope mismatch.';
  end if;

  if not (
    public.is_super_admin()
    or (parent_row.company_id is not null and parent_row.company_id = public.current_company_id())
  ) then
    raise exception 'Not authorized to update a service row for this company.';
  end if;

  existing_rows := coalesce(parent_row.data -> 'serviceRows', '[]'::jsonb);
  if jsonb_typeof(existing_rows) <> 'array' then
    raise exception 'Work order service row aggregate is invalid.';
  end if;

  expected_count := jsonb_array_length(existing_rows);
  if parent_row.service_row_count is distinct from expected_count then
    raise exception 'Work order service_row_count does not match the parent aggregate.';
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
    raise exception 'Cannot update a deleted service row.';
  end if;

  if flat_row.company_id is distinct from parent_row.company_id
     or flat_row.company_legacy_id <> parent_row.company_legacy_id then
    raise exception 'Service row company scope mismatch.';
  end if;

  patched_row := target_row || patch;

  if patch ? 'serviceName' then
    effective_service_name := btrim(coalesce(patch ->> 'serviceName', ''));
    if effective_service_name = '' then
      raise exception 'Service name is required.';
    end if;
    patched_row := jsonb_set(patched_row, '{serviceName}', to_jsonb(effective_service_name), true);
  end if;

  foreach bad_key in array array['articleNumber','categoryName','serviceType','unit','notes'] loop
    if patch ? bad_key then
      if patch ->> bad_key is null or btrim(coalesce(patch ->> bad_key, '')) = '' then
        patched_row := patched_row - bad_key;
      else
        patched_row := jsonb_set(patched_row, array[bad_key], to_jsonb(btrim(patch ->> bad_key)), true);
      end if;
    end if;
  end loop;

  if patch ? 'serviceDate' then
    effective_service_date := btrim(coalesce(patch ->> 'serviceDate', ''));
    if effective_service_date = '' then
      raise exception 'Service date is required.';
    end if;
    if effective_service_date !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'Service date must use YYYY-MM-DD format.';
    end if;
    patched_row := jsonb_set(patched_row, '{serviceDate}', to_jsonb(effective_service_date), true);
  end if;

  if patch ? 'plannedStartTime' then
    if patch ->> 'plannedStartTime' is null or btrim(coalesce(patch ->> 'plannedStartTime', '')) = '' then
      patched_row := patched_row - 'plannedStartTime';
    else
      if btrim(patch ->> 'plannedStartTime') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
        raise exception 'Planned start time must use HH:MM format.';
      end if;
      patched_row := jsonb_set(patched_row, '{plannedStartTime}', to_jsonb(btrim(patch ->> 'plannedStartTime')), true);
    end if;
  end if;

  if patch ? 'plannedEndTime' then
    if patch ->> 'plannedEndTime' is null or btrim(coalesce(patch ->> 'plannedEndTime', '')) = '' then
      patched_row := patched_row - 'plannedEndTime';
    else
      if btrim(patch ->> 'plannedEndTime') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
        raise exception 'Planned end time must use HH:MM format.';
      end if;
      patched_row := jsonb_set(patched_row, '{plannedEndTime}', to_jsonb(btrim(patch ->> 'plannedEndTime')), true);
    end if;
  end if;

  effective_start_time := nullif(btrim(coalesce(patched_row ->> 'plannedStartTime', '')), '');
  effective_end_time := nullif(btrim(coalesce(patched_row ->> 'plannedEndTime', '')), '');
  if effective_start_time is not null and effective_end_time is not null and effective_end_time <= effective_start_time then
    raise exception 'Planned end time must be after planned start time.';
  end if;

  if patch ? 'recurrenceInterval' then
    effective_recurrence_interval := coalesce(nullif(btrim(coalesce(patch ->> 'recurrenceInterval', '')), ''), 'one_time');
    if not (effective_recurrence_interval = any(array[
      'one_time','daily','every_2_days','every_3_days','weekly','every_2_weeks',
      'every_3_weeks','every_4_weeks','monthly','every_2_weeks_monday',
      'every_3_months','every_6_months','yearly'
    ])) then
      raise exception 'Unsupported recurrence interval.';
    end if;
    patched_row := jsonb_set(patched_row, '{recurrenceInterval}', to_jsonb(effective_recurrence_interval), true);
  end if;

  effective_recurrence_interval := coalesce(nullif(btrim(coalesce(patched_row ->> 'recurrenceInterval', '')), ''), 'one_time');
  effective_service_date := btrim(coalesce(patched_row ->> 'serviceDate', ''));
  if effective_service_date = '' then
    raise exception 'Service date is required.';
  end if;

  if patch ? 'serviceEndDate' then
    if patch ->> 'serviceEndDate' is null or btrim(coalesce(patch ->> 'serviceEndDate', '')) = '' or effective_recurrence_interval = 'one_time' then
      patched_row := patched_row - 'serviceEndDate';
    else
      effective_service_end_date := btrim(patch ->> 'serviceEndDate');
      if effective_service_end_date !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'Service end date must use YYYY-MM-DD format.';
      end if;
      if effective_service_end_date < effective_service_date then
        raise exception 'Service end date must be on or after the service date.';
      end if;
      patched_row := jsonb_set(patched_row, '{serviceEndDate}', to_jsonb(effective_service_end_date), true);
    end if;
  end if;

  effective_service_end_date := nullif(btrim(coalesce(patched_row ->> 'serviceEndDate', '')), '');
  if effective_recurrence_interval <> 'one_time'
     and effective_service_end_date is not null
     and effective_service_end_date < effective_service_date then
    raise exception 'Service end date must be on or after the service date.';
  end if;

  if patch ? 'status' then
    effective_status := btrim(coalesce(patch ->> 'status', ''));
    if not (effective_status = any(array['planned','in_progress','completed','inactive'])) then
      raise exception 'Unsupported service-row status.';
    end if;
    patched_row := jsonb_set(patched_row, '{status}', to_jsonb(effective_status), true);
  end if;

  if patch ? 'archived' then
    if jsonb_typeof(patch -> 'archived') <> 'boolean' then
      raise exception 'Archived must be a boolean.';
    end if;
    patched_row := jsonb_set(patched_row, '{archived}', patch -> 'archived', true);
  end if;

  if patch ? 'quantity' and jsonb_typeof(patch -> 'quantity') <> 'number' then
    raise exception 'Quantity must be numeric.';
  end if;
  if patch ? 'price' and patch -> 'price' <> 'null'::jsonb and jsonb_typeof(patch -> 'price') <> 'number' then
    raise exception 'Price must be numeric.';
  end if;
  if patch ? 'vat' and patch -> 'vat' <> 'null'::jsonb and jsonb_typeof(patch -> 'vat') <> 'number' then
    raise exception 'VAT must be numeric.';
  end if;

  if not (patched_row ? 'updatedAt') or btrim(coalesce(patched_row ->> 'updatedAt', '')) = '' then
    patched_row := jsonb_set(patched_row, '{updatedAt}', to_jsonb(to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')), true);
  end if;

  select coalesce(jsonb_agg(
           case when row_json ->> 'id' = input_service_row_legacy_id then patched_row else row_json end
           order by ordinality
         ), '[]'::jsonb)
    into next_rows
    from jsonb_array_elements(existing_rows) with ordinality as existing(row_json, ordinality);

  if jsonb_array_length(next_rows) <> expected_count then
    raise exception 'Updated service-row aggregate count changed unexpectedly.';
  end if;

  next_data := jsonb_set(parent_row.data, '{serviceRows}', next_rows, true);
  next_data := jsonb_set(next_data, '{updatedAt}', to_jsonb(patched_row ->> 'updatedAt'), true);

  update public.work_orders
     set data = next_data,
         updated_at = now()
   where id = parent_row.id
   returning * into updated_parent;

  update public.work_order_service_rows
     set service_name = btrim(coalesce(patched_row ->> 'serviceName', '')),
         article_number = nullif(btrim(coalesce(patched_row ->> 'articleNumber', '')), ''),
         status = coalesce(nullif(btrim(coalesce(patched_row ->> 'status', '')), ''), 'planned'),
         archived = coalesce((patched_row ->> 'archived')::boolean, false),
         service_date = nullif(btrim(coalesce(patched_row ->> 'serviceDate', '')), ''),
         service_end_date = nullif(btrim(coalesce(patched_row ->> 'serviceEndDate', '')), ''),
         planned_start_time = nullif(btrim(coalesce(patched_row ->> 'plannedStartTime', '')), ''),
         planned_end_time = nullif(btrim(coalesce(patched_row ->> 'plannedEndTime', '')), ''),
         recurrence_interval = coalesce(nullif(btrim(coalesce(patched_row ->> 'recurrenceInterval', '')), ''), 'one_time'),
         data = patched_row,
         updated_at = now()
   where id = flat_row.id
   returning * into updated_flat;

  if updated_parent.service_row_count is distinct from expected_count then
    raise exception 'Updated work order service_row_count does not match the parent aggregate.';
  end if;

  return jsonb_build_object(
    'workOrder', updated_parent.data,
    'serviceRow', updated_flat.data,
    'serviceRowCount', updated_parent.service_row_count
  );
end;
$$;

grant execute on function public.update_work_order_service_row(jsonb) to authenticated;
