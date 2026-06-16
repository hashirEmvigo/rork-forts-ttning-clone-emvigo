-- ============================================================================
-- CleanOps — ARTNUM-1 (Phase 2 foundation): article-number SERIES + allocator
-- ============================================================================
--
-- PURPOSE
--   The database-authoritative, durable allocator for service article numbers.
--   A SERIES owns a numeric RANGE for a catalog/category within a uniqueness
--   scope (global master catalog OR a specific company catalog). Generated and
--   manually-entered article numbers must stay inside the owning category's
--   range, and two categories in the SAME scope may never own overlapping ranges.
--
-- RANGE / PREFIX OWNERSHIP (approved model)
--   Each category that opts in owns an inclusive integer range, e.g. the
--   "1000-series" owns 1001..1999 and the "2000-series" owns 2001..2999. Ranges
--   may not overlap within the same scope. A generated number is always the next
--   FREE value inside the range; a manual number must also fall inside the range
--   and not collide.
--
-- SCOPE / UNIQUENESS DOMAINS (mirror 0050)
--   scope_kind = 'global'  -> company_legacy_id IS NULL  (Super Admin master catalog)
--   scope_kind = 'company' -> company_legacy_id = <company legacy id>
--   The scope key coalesce(company_legacy_id,'__GLOBAL__') separates domains, so
--   global "1001" and company "1001" never conflict.
--
-- DURABILITY — next_value ONLY EVER MOVES FORWARD (no reuse, no MAX()+1)
--   next_value is the next number the series WILL issue (explicit semantics).
--   On configure it starts at range_start. generate_article_number issues the
--   first FREE value at/after next_value and advances next_value past it. The
--   value never rewinds, so a consumed generated number is never silently
--   reissued — even after a service is archived or removed. Re-issuing is only
--   possible through a future explicit destructive-reset policy (not built here).
--
-- AUTHORITY — RPCs ONLY (no client writes)
--   The series table has NO client INSERT/UPDATE/DELETE policies. The only way
--   to mutate it is via the SECURITY DEFINER RPCs below, which enforce their own
--   authorization (super_admin for global; super_admin or the owning company
--   admin for company scope). SELECT is allowed for the catalog UI.
--
-- SCOPE BOUNDARY (Phase 2 foundation)
--   Adds ONLY the series table, its guards, and the configure / generate /
--   validate RPCs. It does NOT touch AO/work orders, invoices, payroll, the
--   customer-number or staff-number allocators (number_counters is untouched),
--   import/export, or any reset tooling. Nothing here auto-assigns numbers.
-- ============================================================================

-- btree_gist lets a GiST EXCLUDE constraint combine a text scope key (=) with an
-- int4range overlap (&&) — the robust way to forbid overlapping ranges per scope.
create extension if not exists btree_gist;

create or replace function set_article_number_series_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- TABLE — one row per (scope, category).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists article_number_series (
  id                 uuid primary key default gen_random_uuid(),
  -- 'global' = Super Admin master catalog; 'company' = a specific company catalog.
  scope_kind         text not null,
  -- App-facing company id for company scope; NULL for global. Defines the domain.
  company_legacy_id  text,
  -- Owning category (app-facing service_categories.legacy_id).
  category_legacy_id text not null,
  -- Inclusive owned range, e.g. 1001..1999.
  range_start        integer not null,
  range_end          integer not null,
  -- Next number the series WILL issue (explicit). Starts at range_start; strictly forward.
  next_value         integer not null,
  -- false pauses issuing without losing config/high-water mark.
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint ans_scope_kind_valid
    check (scope_kind in ('global', 'company')),
  constraint ans_scope_consistency
    check (
      (scope_kind = 'global'  and company_legacy_id is null) or
      (scope_kind = 'company' and company_legacy_id is not null and btrim(company_legacy_id) <> '')
    ),
  constraint ans_category_not_blank
    check (btrim(category_legacy_id) <> ''),
  constraint ans_range_valid
    check (range_start >= 1 and range_end >= range_start),
  -- next_value lives within the range, or sits one past the end when exhausted.
  constraint ans_next_value_bounds
    check (next_value >= range_start and next_value <= range_end + 1)
);

drop trigger if exists trg_article_number_series_updated_at on article_number_series;
create trigger trg_article_number_series_updated_at
  before update on article_number_series
  for each row execute function set_article_number_series_updated_at();

-- One series per category per scope.
create unique index if not exists uq_article_number_series_scope_category
  on article_number_series ((coalesce(company_legacy_id, '__GLOBAL__')), category_legacy_id);

-- No two series in the SAME scope may own overlapping ranges.
alter table article_number_series drop constraint if exists ans_no_overlapping_ranges;
alter table article_number_series add constraint ans_no_overlapping_ranges
  exclude using gist (
    (coalesce(company_legacy_id, '__GLOBAL__')) with =,
    int4range(range_start, range_end, '[]') with &&
  );

-- ─────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
--   READ: super_admin -> all; any authenticated user -> their own company's
--   series AND every global series (mirrors the services/categories read model).
--   WRITE: no client policies — mutate only through the SECURITY DEFINER RPCs.
-- ─────────────────────────────────────────────────────────────────────────
alter table article_number_series enable row level security;

drop policy if exists "ans_select_super_admin" on article_number_series;
create policy "ans_select_super_admin" on article_number_series
  for select to authenticated
  using (is_super_admin());

drop policy if exists "ans_select_global" on article_number_series;
create policy "ans_select_global" on article_number_series
  for select to authenticated
  using (scope_kind = 'global');

drop policy if exists "ans_select_own_company" on article_number_series;
create policy "ans_select_own_company" on article_number_series
  for select to authenticated
  using (
    company_legacy_id in (
      select c.legacy_id from public.companies c where c.id = current_company_id()
    )
  );

-- ─────────────────────────────────────────────────────────────────────────
-- Internal helper — authorize a caller for a given series scope.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.ans_assert_scope_authorized(
  p_scope_kind text,
  p_company_legacy_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_company_scope text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if p_scope_kind = 'global' then
    if not public.is_super_admin() then
      raise exception 'Only a super admin may manage the global article-number series.';
    end if;
    return;
  end if;

  if p_scope_kind = 'company' then
    if public.is_super_admin() then
      return;
    end if;
    select c.legacy_id into v_caller_company_scope
      from public.companies c
     where c.id = public.current_company_id();
    if v_caller_company_scope is null or v_caller_company_scope <> p_company_legacy_id then
      raise exception 'Not authorized to manage article numbers for company scope %.', p_company_legacy_id;
    end if;
    return;
  end if;

  raise exception 'Unknown article-number scope kind %.', p_scope_kind;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- RPC — configure_article_number_series(...)
--   Creates or updates the series for a (scope, category). Once any number has
--   been issued (next_value > range_start) the START is LOCKED and the range may
--   only be WIDENED at the end (never shrunk below the issued high-water mark);
--   is_active may always be toggled. Overlapping ranges are rejected by the
--   exclusion constraint and surfaced as a friendly error.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.configure_article_number_series(
  p_scope_kind text,
  p_company_legacy_id text,
  p_category_legacy_id text,
  p_range_start integer,
  p_range_end integer,
  p_is_active boolean default true
)
returns article_number_series
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company text := nullif(btrim(coalesce(p_company_legacy_id, '')), '');
  v_category text := nullif(btrim(coalesce(p_category_legacy_id, '')), '');
  v_scope_key text;
  v_existing article_number_series;
  v_result article_number_series;
begin
  if p_scope_kind not in ('global', 'company') then
    raise exception 'Unknown article-number scope kind %.', p_scope_kind;
  end if;
  if p_scope_kind = 'global' and v_company is not null then
    raise exception 'Global article-number series must not carry a company.';
  end if;
  if p_scope_kind = 'company' and v_company is null then
    raise exception 'Company article-number series requires a company.';
  end if;
  if v_category is null then
    raise exception 'An article-number series requires a category.';
  end if;
  if p_range_start is null or p_range_end is null or p_range_start < 1 or p_range_end < p_range_start then
    raise exception 'Invalid range: start must be >= 1 and end must be >= start (got %..%).', p_range_start, p_range_end;
  end if;

  perform public.ans_assert_scope_authorized(p_scope_kind, v_company);

  v_scope_key := coalesce(v_company, '__GLOBAL__');

  select * into v_existing
    from public.article_number_series
   where coalesce(company_legacy_id, '__GLOBAL__') = v_scope_key
     and category_legacy_id = v_category
   for update;

  begin
    if v_existing.id is null then
      insert into public.article_number_series (
        scope_kind, company_legacy_id, category_legacy_id,
        range_start, range_end, next_value, is_active
      )
      values (
        p_scope_kind, v_company, v_category,
        p_range_start, p_range_end, p_range_start, coalesce(p_is_active, true)
      )
      returning * into v_result;
    else
      -- Numbers already issued -> START is locked, range may only widen at the end.
      if v_existing.next_value > v_existing.range_start then
        if p_range_start <> v_existing.range_start then
          raise exception 'The start of this series is locked because numbers have already been issued (start stays %).', v_existing.range_start;
        end if;
        if p_range_end < v_existing.next_value - 1 then
          raise exception 'Cannot shrink the range below the highest issued number (% already issued).', v_existing.next_value - 1;
        end if;
        update public.article_number_series
           set range_end = p_range_end,
               is_active = coalesce(p_is_active, true)
         where id = v_existing.id
        returning * into v_result;
      else
        -- Nothing issued yet -> full reconfigure; reset next_value to the new start.
        update public.article_number_series
           set range_start = p_range_start,
               range_end = p_range_end,
               next_value = p_range_start,
               is_active = coalesce(p_is_active, true)
         where id = v_existing.id
        returning * into v_result;
      end if;
    end if;
  exception
    when exclusion_violation then
      raise exception 'This range overlaps another category''s article-number range in the same catalog. Pick a non-overlapping range.';
  end;

  return v_result;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- RPC — generate_article_number(...)
--   Atomically issues the next FREE article number inside the category's range.
--   Locks the series row, skips any value already used by a non-deleted service
--   in the same scope (so manual entries never collide with generated ones), and
--   advances next_value forward. Raises when no series is configured/active or
--   the range is exhausted.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.generate_article_number(
  p_scope_kind text,
  p_company_legacy_id text,
  p_category_legacy_id text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company text := nullif(btrim(coalesce(p_company_legacy_id, '')), '');
  v_category text := nullif(btrim(coalesce(p_category_legacy_id, '')), '');
  v_scope_key text;
  v_series article_number_series;
  v_issued integer;
begin
  if p_scope_kind not in ('global', 'company') then
    raise exception 'Unknown article-number scope kind %.', p_scope_kind;
  end if;
  if v_category is null then
    raise exception 'An article-number series requires a category.';
  end if;

  perform public.ans_assert_scope_authorized(p_scope_kind, v_company);

  v_scope_key := coalesce(v_company, '__GLOBAL__');

  select * into v_series
    from public.article_number_series
   where coalesce(company_legacy_id, '__GLOBAL__') = v_scope_key
     and category_legacy_id = v_category
   for update;

  if v_series.id is null then
    raise exception 'No article-number series is configured for this category.';
  end if;
  if not v_series.is_active then
    raise exception 'The article-number series for this category is not active.';
  end if;

  -- First free value at/after next_value, skipping numbers already taken by a
  -- non-deleted service in this scope (manual entries included).
  select n
    into v_issued
    from generate_series(v_series.next_value, v_series.range_end) as n
   where not exists (
     select 1
       from public.services s
      where coalesce(s.company_legacy_id, '__GLOBAL__') = v_scope_key
        and s.deleted_at is null
        and s.article_number = n::text
   )
   order by n
   limit 1;

  if v_issued is null then
    raise exception 'The article-number range for this category is exhausted (%..%).', v_series.range_start, v_series.range_end;
  end if;

  update public.article_number_series
     set next_value = v_issued + 1
   where id = v_series.id;

  return v_issued::text;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- RPC — validate_manual_article_number(...)
--   Pre-flight check for a manually-entered article number. Returns jsonb
--   { ok, code, message }. Codes:
--     ok            — empty value, or valid + unique (+ in range when a series exists)
--     duplicate     — already used by another non-deleted service in this scope
--     out_of_range  — a series exists and the number is outside its range
--     not_numeric   — a series exists and the value is not a plain integer
--     no_series     — no series configured (ok=true; uniqueness still enforced;
--                     the UI surfaces a soft hint and disables Generate)
--   The DB unique guards (0050) are the hard backstop; this RPC powers friendly,
--   pre-emptive UX. p_exclude_service_legacy_id ignores the row being edited.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.validate_manual_article_number(
  p_scope_kind text,
  p_company_legacy_id text,
  p_category_legacy_id text,
  p_article_number text,
  p_exclude_service_legacy_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company text := nullif(btrim(coalesce(p_company_legacy_id, '')), '');
  v_category text := nullif(btrim(coalesce(p_category_legacy_id, '')), '');
  v_exclude text := nullif(btrim(coalesce(p_exclude_service_legacy_id, '')), '');
  v_value text := nullif(btrim(coalesce(p_article_number, '')), '');
  v_scope_key text;
  v_series article_number_series;
  v_is_duplicate boolean;
  v_numeric integer;
begin
  if p_scope_kind not in ('global', 'company') then
    raise exception 'Unknown article-number scope kind %.', p_scope_kind;
  end if;

  perform public.ans_assert_scope_authorized(p_scope_kind, v_company);

  -- An empty article number is always acceptable (clearing the field).
  if v_value is null then
    return jsonb_build_object('ok', true, 'code', 'ok', 'message', '');
  end if;

  v_scope_key := coalesce(v_company, '__GLOBAL__');

  -- Uniqueness is enforced in EVERY case (series or not).
  select exists (
    select 1
      from public.services s
     where coalesce(s.company_legacy_id, '__GLOBAL__') = v_scope_key
       and s.deleted_at is null
       and s.article_number = v_value
       and (v_exclude is null or s.legacy_id <> v_exclude)
  ) into v_is_duplicate;

  if v_is_duplicate then
    return jsonb_build_object(
      'ok', false, 'code', 'duplicate',
      'message', 'Another service in this catalog already uses article number ' || v_value || '.'
    );
  end if;

  if v_category is null then
    return jsonb_build_object('ok', true, 'code', 'no_series', 'message', '');
  end if;

  select * into v_series
    from public.article_number_series
   where coalesce(company_legacy_id, '__GLOBAL__') = v_scope_key
     and category_legacy_id = v_category;

  if v_series.id is null then
    return jsonb_build_object('ok', true, 'code', 'no_series', 'message', '');
  end if;

  -- A configured series requires a plain integer inside its range.
  if v_value !~ '^[0-9]+$' then
    return jsonb_build_object(
      'ok', false, 'code', 'not_numeric',
      'message', 'This category uses a numeric article-number series (' || v_series.range_start || '–' || v_series.range_end || ').'
    );
  end if;

  v_numeric := v_value::integer;
  if v_numeric < v_series.range_start or v_numeric > v_series.range_end then
    return jsonb_build_object(
      'ok', false, 'code', 'out_of_range',
      'message', 'Article number must be within ' || v_series.range_start || '–' || v_series.range_end || ' for this category.'
    );
  end if;

  return jsonb_build_object('ok', true, 'code', 'ok', 'message', '');
end;
$$;

grant execute on function public.configure_article_number_series(text, text, text, integer, integer, boolean) to authenticated;
grant execute on function public.generate_article_number(text, text, text) to authenticated;
grant execute on function public.validate_manual_article_number(text, text, text, text, text) to authenticated;
