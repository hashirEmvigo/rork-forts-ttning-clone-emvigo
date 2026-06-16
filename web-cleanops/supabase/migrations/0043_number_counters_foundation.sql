-- ============================================================================
-- CleanOps — NUM-1: durable non-reusable visible-number allocator (foundation)
-- ============================================================================
--
-- PURPOSE
--   Provide the single, database-authoritative source for VISIBLE BUSINESS
--   NUMBERS (the company-facing running numbers such as the "1004" in a
--   customer reference, or the "1003" in a work-order reference). The database
--   is the ONLY place a visible number is ever decided. The frontend and
--   localStorage must never compute, reserve, mirror, or restore these numbers,
--   and the legacy MAX(existing)+1 approach is replaced entirely.
--
-- WHAT THIS IS NOT
--   This is NOT about technical/internal identifiers. Technical ids stay opaque,
--   randomly generated UUID-style values (gen_random_uuid(), makeId('cust_'),
--   etc.). Those are not customer-visible and are NOT issued from this table.
--   number_counters issues ONLY the visible, human-meaningful running numbers.
--
-- SCOPE MODEL — COMPANY-SCOPED, EACH COMPANY STARTS ITS OWN SERIES AT 1
--   Visible numbers are company-scoped. Every company owns an independent
--   series per entity kind. Company A and Company B BOTH legitimately have a
--   customer "1"; what is forbidden is Company A issuing customer "1" twice.
--   There is no shared/global visible-number series across companies.
--   The default first issued value is 1 (NOT 1001). A non-1 start may be
--   configured per counter later via start_value; nothing defaults to 1001.
--
-- DURABILITY — NUMBERS ARE CONSUMED PERMANENTLY, NEVER REUSED
--   company_scope is a STABLE TEXT key (the company legacy id, e.g.
--   'cmp_nordlys'). It is deliberately NOT a foreign key to companies(id).
--   A FK with ON DELETE CASCADE would delete the counter when the company is
--   removed, which would reset (reuse) that company's numbers — exactly what the
--   architecture forbids. Because there is no FK, deleting a company, soft- or
--   hard-deleting its records, or running the standard test-data cleanup leaves
--   the counter row untouched, so a consumed number can never be reissued.
--   (A brand-new company always gets a brand-new legacy id, hence a fresh
--   counter starting at 1 — consistent with "each company starts at 1".)
--
-- COUNTER SEMANTICS — STORES last_issued_value (HIGH-WATER MARK), NOT next_value
--   To remove all off-by-one ambiguity: the stored counter is the LAST value
--   that was actually issued (a permanent high-water mark). The next number to
--   hand out is always last_issued_value + 1. On a counter's very first use the
--   row is created with last_issued_value = start_value, and that first call
--   RETURNS start_value (default 1). The value only ever moves forward.
--
-- PHASE 1 BOUNDARY (foundation only)
--   This migration adds ONLY the number_counters table, the atomic
--   allocate_number RPC, and the security model. It does NOT wire customers,
--   work orders, employees, invoices, bookings, any UI display, or the reset
--   tooling to the allocator. No existing table, RPC, policy, or app behavior
--   is modified. Nothing calls allocate_number yet.
-- ============================================================================

create or replace function set_number_counters_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- TABLE — one row per (company_scope, entity_kind).
--   company_scope     : stable company legacy id (text). NO FK by design.
--   entity_kind       : lowercase snake_case kind, e.g. 'customer',
--                       'work_order', 'employee', 'invoice', 'booking'.
--   last_issued_value : high-water mark — the last number handed out.
--   start_value       : the first number to issue for this series (default 1).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists number_counters (
  id                 uuid primary key default gen_random_uuid(),
  company_scope      text not null,
  entity_kind        text not null,
  last_issued_value  integer not null default 0,
  start_value        integer not null default 1,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint number_counters_unique_scope_kind
    unique (company_scope, entity_kind),
  constraint number_counters_company_scope_not_blank
    check (btrim(company_scope) <> ''),
  constraint number_counters_entity_kind_format
    check (entity_kind ~ '^[a-z][a-z0-9_]*$'),
  constraint number_counters_start_value_positive
    check (start_value >= 1),
  constraint number_counters_last_issued_nonneg
    check (last_issued_value >= 0)
);

drop trigger if exists trg_number_counters_updated_at on number_counters;
create trigger trg_number_counters_updated_at
  before update on number_counters
  for each row execute function set_number_counters_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
--   The counter table is sacred: numbers must never be hand-edited, rewound, or
--   reused. Therefore there are NO client INSERT / UPDATE / DELETE policies.
--   The ONLY way to mutate a counter is the SECURITY DEFINER allocate_number
--   RPC below, which enforces authorization and moves the value strictly
--   forward. Direct client writes are denied by RLS.
--
--   SELECT is allowed for visibility/debugging only:
--     * super_admin reads all counters,
--     * a company may read its own counters (scope == caller's company).
-- ─────────────────────────────────────────────────────────────────────────
alter table number_counters enable row level security;

drop policy if exists "number_counters_select_super_admin" on number_counters;
create policy "number_counters_select_super_admin" on number_counters
  for select to authenticated
  using (is_super_admin());

drop policy if exists "number_counters_select_own_company" on number_counters;
create policy "number_counters_select_own_company" on number_counters
  for select to authenticated
  using (
    company_scope in (
      select c.legacy_id
        from public.companies c
       where c.id = current_company_id()
    )
  );

-- ─────────────────────────────────────────────────────────────────────────
-- RPC — allocate_number(company_scope, entity_kind, start_value default 1)
--   Atomically issues and CONSUMES the next visible number for a company's
--   entity series and RETURNS the issued number.
--
--   Returns: integer — the number that was issued/consumed by THIS call.
--
--   Atomicity: a single INSERT ... ON CONFLICT DO UPDATE ... RETURNING. On the
--   first call the row is created with last_issued_value = start_value and that
--   value is returned. On every later call PostgreSQL locks the existing row and
--   increments last_issued_value by exactly 1, so concurrent callers serialize
--   and each receives a distinct, strictly increasing number. No MAX()+1, no
--   read-then-write race, no gap-filling.
--
--   Authorization: super_admin may allocate for any company scope; any other
--   authenticated caller may allocate ONLY for their own company, so one tenant
--   can never advance or burn another tenant's series.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.allocate_number(
  p_company_scope text,
  p_entity_kind text,
  p_start_value integer default 1
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_scope text := btrim(coalesce(p_company_scope, ''));
  v_entity_kind text := lower(btrim(coalesce(p_entity_kind, '')));
  v_start_value integer := coalesce(p_start_value, 1);
  v_caller_company_scope text;
  v_issued integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required to allocate a number.';
  end if;

  if v_company_scope = '' then
    raise exception 'Company scope is required to allocate a number.';
  end if;

  if v_entity_kind = '' then
    raise exception 'Entity kind is required to allocate a number.';
  end if;

  if v_entity_kind !~ '^[a-z][a-z0-9_]*$' then
    raise exception 'Entity kind % must be lowercase snake_case.', v_entity_kind;
  end if;

  if v_start_value < 1 then
    raise exception 'Start value must be at least 1 (got %).', v_start_value;
  end if;

  -- Per-tenant authorization. super_admin bypasses the scope match.
  if not public.is_super_admin() then
    select c.legacy_id
      into v_caller_company_scope
      from public.companies c
     where c.id = public.current_company_id();

    if v_caller_company_scope is null or v_caller_company_scope <> v_company_scope then
      raise exception 'Not authorized to allocate numbers for company scope %.', v_company_scope;
    end if;
  end if;

  -- Atomic allocate-and-consume. First use seeds last_issued_value = start_value
  -- (so the first issued number IS start_value, default 1); subsequent uses lock
  -- the row and move the high-water mark forward by exactly 1. start_value is
  -- only honoured at creation and is intentionally ignored on conflict, so a
  -- series start can never be changed after numbers have been issued.
  insert into public.number_counters as nc (
    company_scope, entity_kind, last_issued_value, start_value
  )
  values (v_company_scope, v_entity_kind, v_start_value, v_start_value)
  on conflict (company_scope, entity_kind) do update
    set last_issued_value = nc.last_issued_value + 1
  returning nc.last_issued_value into v_issued;

  return v_issued;
end;
$$;

grant execute on function public.allocate_number(text, text, integer) to authenticated;
