-- ============================================================================
-- CleanOps — NUM-1 (Phase 3, staff): durable Staff ID for the Employees/Team page
-- ============================================================================
--
-- CONTEXT
--   Phase 1 (0043) added number_counters + allocate_number(...), the single
--   database authority for visible business numbers. Phase 2 (0044) wired the
--   CUSTOMER series. Phase 3 introduces ONE company-scoped STAFF series that
--   backs the clean numeric "Staff ID" shown for every row on the Employees /
--   Team page — both profile-only company admins AND employee records.
--
-- ONE SHARED SERIES ACROSS TWO TABLES
--   The Employees page mixes two record kinds:
--     * company_admin / employee LOGINS that live only in `profiles`
--       (e.g. an admin with no employee record of their own), and
--     * `employees` records (staff with or without a login).
--   They share a SINGLE per-company "staff" series so the page can show a clean,
--   contiguous numeric Staff ID for every visible person. allocate_number(scope,
--   'staff') is the ONLY authority that issues these values; because that counter
--   only ever moves forward, every issued number is unique within the company's
--   staff series regardless of which table stores it. The per-table unique guards
--   below are therefore defence-in-depth, exactly mirroring the customer guard in
--   0044.
--
-- WHY staff_number LIVES ON BOTH TABLES
--   A visible person is represented by EITHER an employee row (preferred when a
--   real employee record exists) OR a profile row (a login with no employee
--   record). Storing the bare integer on whichever row represents the person lets
--   both surfaces resolve a clean Staff ID. A person who has BOTH an employee
--   record and a login profile is shown ONCE on the page (the employee row wins,
--   deduped by email), so the backfill numbers the employee row and intentionally
--   leaves that person's profile row un-numbered — no double consumption.
--
-- DURABILITY / NO-REUSE
--   number_counters is never reset by the test-data cleanup (0043), so a consumed
--   staff number is never reissued. The unique guards are FULL indexes (no
--   partial WHERE), so an issued number stays reserved.
--
-- WHAT THIS MIGRATION DOES
--   1. Adds a nullable bare-integer `staff_number` to `employees` and `profiles`
--      (+ a positive-value CHECK on each).
--   2. Backfills existing visible staff/team rows per company into one shared
--      series, ordered by created_at ascending with the stable row id as the
--      tiebreaker, so Sebastian / Nadiia (profile company admins) and Somnath
--      (employee record) all receive clean numeric Staff IDs.
--   3. Seeds number_counters('<company legacy id>', 'staff') to the high-water
--      mark of the backfill so the NEXT allocate_number('staff') continues from
--      there (no collision with backfilled numbers).
--   4. Adds FULL company-scoped unique guards on both tables.
--
-- NON-GOALS / SAFETY
--   * Does NOT modify the auth provisioning trigger (0004); future admin-created
--     profiles receive their staff_number from the admin-create-user Edge
--     Function (the allocator's only privileged-context caller).
--   * Touches ONLY employees + profiles staff numbering and the staff counter.
--     Customers, work orders, invoices, bookings/Booking Ledger, service rows,
--     reset tooling, Schedule, Mission Log, Time Reporting, payroll, Customer
--     Portal and occurrence exceptions are untouched, as is the customer-number
--     allocator logic (allocate_number itself is unchanged).
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. COLUMNS — bare integer, nullable (null = not yet issued / not on this row).
-- ─────────────────────────────────────────────────────────────────────────
alter table employees add column if not exists staff_number integer;
alter table profiles  add column if not exists staff_number integer;

alter table employees drop constraint if exists employees_staff_number_positive;
alter table employees add constraint employees_staff_number_positive
  check (staff_number is null or staff_number >= 1);

alter table profiles drop constraint if exists profiles_staff_number_positive;
alter table profiles add constraint profiles_staff_number_positive
  check (staff_number is null or staff_number >= 1);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. BACKFILL — one shared per-company staff series across employees + profiles.
--    Order: created_at ascending, stable row id as the tiebreaker. A profile is
--    SKIPPED when an active employee row in the same company already represents
--    that person (matched by email), so a person shown once is numbered once.
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare
  c   record;
  r   record;
  seq integer;
begin
  for c in select id, legacy_id from public.companies loop
    seq := 0;
    for r in
      select src, row_id
        from (
          -- Visible employee records (soft-deleted rows are not shown and are
          -- left un-numbered; the full unique guard tolerates null staff_number).
          select 'employee'::text as src,
                 e.id            as row_id,
                 e.created_at    as created_at,
                 e.id::text      as tiebreak
            from public.employees e
           where e.company_id = c.id
             and e.deleted_at is null
          union all
          -- Profile-only staff/admin logins not already represented by an
          -- employee row (deduped by email within the company).
          select 'profile'::text as src,
                 p.id            as row_id,
                 p.created_at    as created_at,
                 p.id::text      as tiebreak
            from public.profiles p
           where p.company_id = c.id
             and p.base_role in ('company_admin', 'employee')
             and not exists (
               select 1
                 from public.employees e2
                where e2.company_id = c.id
                  and e2.deleted_at is null
                  and coalesce(p.email, '') <> ''
                  and lower(e2.email) = lower(p.email)
             )
        ) unified
       order by created_at asc nulls last, tiebreak asc
    loop
      seq := seq + 1;
      if r.src = 'employee' then
        update public.employees set staff_number = seq where id = r.row_id;
      else
        update public.profiles set staff_number = seq where id = r.row_id;
      end if;
    end loop;

    -- Seed the high-water mark so the next allocate_number('staff') continues
    -- past the backfilled numbers. Skipped when the company has no legacy id
    -- (the allocator scope key) or no staff rows were numbered.
    if seq > 0 and coalesce(btrim(c.legacy_id), '') <> '' then
      insert into public.number_counters (company_scope, entity_kind, last_issued_value, start_value)
      values (c.legacy_id, 'staff', seq, 1)
      on conflict (company_scope, entity_kind) do update
        set last_issued_value = greatest(number_counters.last_issued_value, excluded.last_issued_value);
    end if;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. FULL company-scoped unique guards (defence-in-depth; NO partial WHERE).
--    Multiple null staff_number rows coexist (Postgres treats nulls as
--    distinct), so un-numbered / soft-deleted rows never collide.
-- ─────────────────────────────────────────────────────────────────────────
create unique index if not exists uq_employees_company_staff_number
  on employees (company_legacy_id, staff_number);

create unique index if not exists uq_profiles_company_staff_number
  on profiles (company_id, staff_number);
