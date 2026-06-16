-- ============================================================================
-- CleanOps — TSE-1: Customer Temporary Scheduling Exceptions DB foundation
-- ============================================================================
--
-- Temporary Scheduling Exceptions are customer-scoped, date-bound planning wishes.
-- They are guidance only: not guarantees, not occurrence exceptions, not Booking
-- Queue instructions, and not schedule mutation commands.
--
-- SCOPE — DB foundation ONLY.
--   * No app runtime reads or writes this table in this phase.
--   * No localStorage persistence, fallback, backout bridge, mirror, or offline queue.
--   * No customer portal write policies in this phase.
--   * No mutation of WorkOrder service rows, occurrence exceptions, Booking Queue,
--     Schedule Core, Mission Log, Time Reporting, payroll, invoice, or history.
-- ============================================================================

-- Required for GiST equality support on uuid columns in the overlap exclusion.
create extension if not exists btree_gist;

create or replace function customer_temporary_scheduling_windows_are_valid(windows jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  item jsonb;
begin
  if windows is null or jsonb_typeof(windows) <> 'array' then
    return false;
  end if;

  for item in select value from jsonb_array_elements(windows) loop
    if jsonb_typeof(item) <> 'object' then
      return false;
    end if;

    if not (item ? 'start_time') or not (item ? 'end_time') then
      return false;
    end if;

    if jsonb_typeof(item -> 'start_time') <> 'string'
       or jsonb_typeof(item -> 'end_time') <> 'string' then
      return false;
    end if;

    if (item ->> 'start_time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or (item ->> 'end_time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      return false;
    end if;

    if (item ->> 'start_time') >= (item ->> 'end_time') then
      return false;
    end if;
  end loop;

  if exists (
    select 1
    from jsonb_array_elements(windows) with ordinality as a(value, ord)
    join jsonb_array_elements(windows) with ordinality as b(value, ord)
      on a.ord < b.ord
    where (a.value ->> 'start_time') < (b.value ->> 'end_time')
      and (b.value ->> 'start_time') < (a.value ->> 'end_time')
  ) then
    return false;
  end if;

  return true;
end;
$$;

create table if not exists customer_temporary_scheduling_exceptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  source text not null,
  status text not null default 'submitted',
  start_date date not null,
  end_date date not null,
  windows jsonb not null default '[]'::jsonb,
  reason_code text not null,
  customer_note text,
  admin_note text,
  created_by_actor_type text not null,
  created_by_user_id uuid,
  created_by_customer_id uuid,
  client_request_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by_actor_type text,
  cancelled_by_user_id uuid,
  cancelled_by_customer_id uuid,
  reviewed_at timestamptz,
  reviewed_by_user_id uuid,

  constraint ctse_status_check
    check (status in ('submitted', 'accepted_for_planning', 'cancelled')),

  constraint ctse_source_check
    check (source in ('admin_console', 'customer_portal', 'system')),

  constraint ctse_created_by_actor_type_check
    check (created_by_actor_type in ('admin', 'customer', 'system')),

  constraint ctse_cancelled_by_actor_type_check
    check (
      cancelled_by_actor_type is null
      or cancelled_by_actor_type in ('admin', 'customer', 'system')
    ),

  constraint ctse_reason_code_check
    check (reason_code in (
      'customer_away',
      'temporary_access_change',
      'temporary_time_preference',
      'holiday_period',
      'building_access',
      'other'
    )),

  constraint ctse_date_range_check
    check (end_date >= start_date),

  constraint ctse_windows_valid_check
    check (customer_temporary_scheduling_windows_are_valid(windows)),

  constraint ctse_cancelled_state_check
    check (
      (
        status = 'cancelled'
        and cancelled_at is not null
        and cancelled_by_actor_type is not null
      )
      or
      (
        status <> 'cancelled'
        and cancelled_at is null
        and cancelled_by_actor_type is null
        and cancelled_by_user_id is null
        and cancelled_by_customer_id is null
      )
    ),

  constraint ctse_cancelled_actor_consistency_check
    check (
      cancelled_by_actor_type is null
      or (cancelled_by_actor_type = 'admin' and cancelled_by_user_id is not null)
      or (cancelled_by_actor_type = 'customer' and cancelled_by_customer_id is not null)
      or cancelled_by_actor_type = 'system'
    ),

  constraint ctse_review_consistency_check
    check (
      status <> 'accepted_for_planning'
      or (reviewed_at is not null and reviewed_by_user_id is not null)
    ),

  constraint ctse_created_actor_consistency_check
    check (
      (created_by_actor_type = 'admin' and created_by_user_id is not null)
      or (created_by_actor_type = 'customer' and created_by_customer_id is not null)
      or created_by_actor_type = 'system'
    ),

  constraint ctse_client_request_id_not_blank_check
    check (client_request_id is null or length(btrim(client_request_id)) > 0)
);

-- One customer may not have more than one non-cancelled temporary exception whose
-- inclusive date range overlaps. The '[)' daterange uses end_date + 1 so a row
-- from 2026-06-01 to 2026-06-01 blocks that whole calendar day, while an ending
-- 2026-06-01 row is adjacent to a starting 2026-06-02 row.
alter table customer_temporary_scheduling_exceptions
  drop constraint if exists ctse_no_overlapping_active_ranges;

alter table customer_temporary_scheduling_exceptions
  add constraint ctse_no_overlapping_active_ranges
  exclude using gist (
    company_id with =,
    customer_id with =,
    daterange(start_date, end_date + 1, '[)') with &&
  )
  where (status <> 'cancelled');

-- Lookup / planning indexes.
create index if not exists idx_ctse_company_customer_start
  on customer_temporary_scheduling_exceptions(company_id, customer_id, start_date desc);

create index if not exists idx_ctse_company_date_range
  on customer_temporary_scheduling_exceptions using gist (
    company_id,
    daterange(start_date, end_date + 1, '[)')
  );

create index if not exists idx_ctse_company_status_created
  on customer_temporary_scheduling_exceptions(company_id, status, created_at desc);

create index if not exists idx_ctse_review_queue
  on customer_temporary_scheduling_exceptions(company_id, created_at desc)
  where status = 'submitted';

create index if not exists idx_ctse_customer_portal_list
  on customer_temporary_scheduling_exceptions(company_id, customer_id, status, start_date desc);

create unique index if not exists idx_ctse_idempotency
  on customer_temporary_scheduling_exceptions(company_id, customer_id, source, client_request_id)
  where client_request_id is not null;

-- Keep updated_at fresh on every update (same per-domain trigger pattern as the
-- existing operational migrations).
create or replace function set_customer_temporary_scheduling_exceptions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_ctse_updated_at on customer_temporary_scheduling_exceptions;
create trigger trg_ctse_updated_at
  before update on customer_temporary_scheduling_exceptions
  for each row
  execute function set_customer_temporary_scheduling_exceptions_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY — admin DB foundation only
--
-- Phase 3A allows admin/super-admin SELECT and initial submitted INSERT only.
-- No UPDATE policies are provided: review/cancel mutation is deferred until a
-- later slice can protect immutable fields or route workflow changes through
-- reviewed RPCs.
--
-- Customer Portal identity mapping is intentionally deferred: there is not yet a
-- reviewed, testable profile→customer ownership helper. Therefore Phase 3A adds
-- no customer read/write policies. Customer self-service policies must be added
-- only in the later Customer Portal phase after that mapping is approved.
--
-- Tenant consistency note: this migration intentionally does not alter the core
-- customers table to add a composite unique constraint. The table-level FK uses
-- customers(id); authenticated admin INSERT policies additionally require the
-- referenced customer to belong to the same company. Full constraint-level
-- customer/company enforcement remains a future schema review item.
--
-- System actor writes are server-only via service role. No authenticated client
-- policy allows a row to be inserted as source='system'.
-- ─────────────────────────────────────────────────────────────────────────
alter table customer_temporary_scheduling_exceptions enable row level security;

-- READ: company admin within own company.
drop policy if exists "ctse_select_company_admin" on customer_temporary_scheduling_exceptions;
create policy "ctse_select_company_admin" on customer_temporary_scheduling_exceptions
  for select to authenticated
  using (
    current_base_role() = 'company_admin'
    and company_id is not null
    and company_id = current_company_id()
  );

-- READ: super admin across companies.
drop policy if exists "ctse_select_super_admin" on customer_temporary_scheduling_exceptions;
create policy "ctse_select_super_admin" on customer_temporary_scheduling_exceptions
  for select to authenticated
  using (is_super_admin());

-- INSERT: company admin can create admin-console rows only for own company.
drop policy if exists "ctse_insert_company_admin" on customer_temporary_scheduling_exceptions;
create policy "ctse_insert_company_admin" on customer_temporary_scheduling_exceptions
  for insert to authenticated
  with check (
    current_base_role() = 'company_admin'
    and company_id is not null
    and company_id = current_company_id()
    and source = 'admin_console'
    and status = 'submitted'
    and created_by_actor_type = 'admin'
    and created_by_user_id = auth.uid()
    and cancelled_at is null
    and cancelled_by_actor_type is null
    and cancelled_by_user_id is null
    and cancelled_by_customer_id is null
    and reviewed_at is null
    and reviewed_by_user_id is null
    and exists (
      select 1
      from customers c
      where c.id = customer_temporary_scheduling_exceptions.customer_id
        and c.company_id = customer_temporary_scheduling_exceptions.company_id
    )
  );

-- INSERT: super admin can create admin-console rows across companies.
drop policy if exists "ctse_insert_super_admin" on customer_temporary_scheduling_exceptions;
create policy "ctse_insert_super_admin" on customer_temporary_scheduling_exceptions
  for insert to authenticated
  with check (
    is_super_admin()
    and source = 'admin_console'
    and status = 'submitted'
    and created_by_actor_type = 'admin'
    and created_by_user_id = auth.uid()
    and cancelled_at is null
    and cancelled_by_actor_type is null
    and cancelled_by_user_id is null
    and cancelled_by_customer_id is null
    and reviewed_at is null
    and reviewed_by_user_id is null
    and exists (
      select 1
      from customers c
      where c.id = customer_temporary_scheduling_exceptions.customer_id
        and c.company_id = customer_temporary_scheduling_exceptions.company_id
    )
  );

-- NOTE: no UPDATE policy on purpose — review/cancel mutation is deferred.
-- NOTE: no DELETE policy on purpose — hard delete is blocked under RLS.
