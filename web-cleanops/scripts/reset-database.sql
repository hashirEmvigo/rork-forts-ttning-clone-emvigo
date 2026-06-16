-- ============================================================================
--  CleanOps — CONTROLLED DATABASE RESET (Super-Admin-preserving)
-- ============================================================================
--
--  ⚠️  DESTRUCTIVE — ADMIN ONLY. Run in the Supabase SQL Editor (service role)
--      on a NON-production / testing project, or when you explicitly want to
--      wipe operational/test data and start the full flow from scratch.
--
--  GOAL
--    Keep ONLY the Super Admin account(s) + the platform-global configuration
--    the app needs to boot, and remove every piece of company/test data:
--      • Companies (every tenant)
--      • Company Admins / Employees / Customers (auth users + profiles)
--      • Employees / Customers / Teams / Areas / Postal cities / Languages
--      • Roles & assignments tied to companies
--      • Work Orders / service rows / occurrence exceptions
--      • Visit Occurrences (Missions) / Booking Queue / Booking Ledger / Schedule data
--      • Company services & catalog data, company settings
--      • Company entitlements / packages, activity log entries
--      • Company modules, checklists, protocols, media
--
--  HOW IT STAYS SAFE
--    1. It runs in a single transaction. If ANYTHING fails, NOTHING is applied.
--    2. It ABORTS unless at least one ACTIVE super_admin profile exists.
--    3. It NEVER deletes a super_admin profile or that user's auth login.
--    4. Deletion order is dependency-safe:
--         a) delete non-super-admin AUTH users first (this cascades their
--            `profiles` row via `profiles.id -> auth.users(id) ON DELETE CASCADE`),
--            so deleting companies later cannot violate the
--            `profiles_company_required_check` constraint.
--         b) delete all companies — every company-scoped table references
--            `companies(id) ON DELETE CASCADE`, so this single delete clears
--            customers, employees, teams, areas, postal_cities, languages,
--            roles(company), services(company), time_codes(company),
--            work_orders (+ rows/exceptions), visit_occurrences, booking_queue,
--            booking_ledger, company_settings, company_modules, checklist/protocol/media,
--            company entitlements, agreements, time bank, payroll export, etc.
--         c) clear platform-level append-only logs that referenced deleted
--            companies (they use ON DELETE SET NULL, so rows would otherwise
--            survive as orphans).
--
--  WHAT IS PRESERVED (intentionally)
--    • super_admin auth users + their `public.profiles` rows.
--    • Platform-global config the app needs (all have company_id IS NULL or no
--      company link): modules / module_categories, settings_templates,
--      global roles templates, global service catalog, global checklist
--      templates, global service entitlements / bundles, system_settings.
--      Development Center depends on these — they are NOT test data.
--
--  OPTIONAL HARD WIPE
--    If you also want to clear the platform-global *master library* (global
--    services/roles/checklists/etc.) for a truly bare platform, uncomment
--    "SECTION 4 — OPTIONAL GLOBAL MASTER-LIBRARY WIPE" at the bottom. Leave it
--    commented for the normal flow test (it does not affect the create-company
--    → admin → employees → customers → work-orders walkthrough).
--
--  USAGE
--    Supabase Dashboard → SQL Editor → paste this file → Run.
--    (The SQL Editor runs with privileges that can delete from auth.users and
--     cascade into the auth schema.)
--
--  By default this preserves EVERY super_admin. To keep exactly ONE specific
--  super admin and remove any others, see "SECTION 0b" and set the email.
-- ============================================================================

begin;

-- ─────────────────────────────────────────────────────────────────────────
-- SECTION 0 — SAFETY GATE: refuse to run without an active super_admin
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare
  super_count int;
begin
  select count(*) into super_count
  from public.profiles
  where base_role = 'super_admin' and status = 'active';

  if super_count = 0 then
    raise exception
      'ABORT: no active super_admin profile found. Refusing to wipe the database (would lock you out).';
  end if;

  raise notice 'Safety gate passed: % active super_admin profile(s) will be preserved.', super_count;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- SECTION 0b — (OPTIONAL) keep exactly ONE super admin by email
--   Leave commented to preserve ALL super_admins (default, safest).
--   To keep only one, set the email and uncomment. Other super_admin auth
--   users + profiles will then be deleted in SECTION 1.
-- ─────────────────────────────────────────────────────────────────────────
-- delete from auth.users u
-- using public.profiles p
-- where p.id = u.id
--   and p.base_role = 'super_admin'
--   and lower(coalesce(p.email, '')) <> lower('sebastian@stadalliansen.se');

-- ─────────────────────────────────────────────────────────────────────────
-- SECTION 1 — DELETE ALL NON-SUPER-ADMIN AUTH USERS
--   Cascades to their `profiles` row (profiles.id -> auth.users ON DELETE
--   CASCADE). Done BEFORE deleting companies so the company FK ON DELETE SET
--   NULL on profiles can never violate profiles_company_required_check.
-- ─────────────────────────────────────────────────────────────────────────
delete from auth.users u
using public.profiles p
where p.id = u.id
  and p.base_role <> 'super_admin';

-- Remove orphaned auth users that have NO profile at all (test artifacts /
-- failed creates). Never touch an email that belongs to a super_admin profile.
delete from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id)
  and lower(coalesce(u.email, '')) not in (
    select lower(email)
    from public.profiles
    where base_role = 'super_admin' and email is not null
  );

-- ─────────────────────────────────────────────────────────────────────────
-- SECTION 2 — DELETE ALL COMPANIES (cascades all company-scoped data)
--   Every company-scoped table references companies(id) ON DELETE CASCADE.
-- ─────────────────────────────────────────────────────────────────────────
delete from public.companies;

-- ─────────────────────────────────────────────────────────────────────────
-- SECTION 2b — EXPLICIT CLEAR OF NEVER-GLOBAL LEDGER/QUEUE TABLES
--   booking_ledger (0040) and booking_queue (0025) reference companies(id) ON
--   DELETE CASCADE but their company_id column is NULLABLE. A row with a NULL
--   company_id (legacy/backfill artifact) would NOT be removed by the SECTION 2
--   company cascade and would survive in Booking List. Both tables are 100%
--   company-scoped (there are NO global rows), so an unconditional clear is safe
--   and guarantees Booking List shows 0 rows after reset. Guarded with
--   to_regclass so the script is resilient if a table is not present.
-- ─────────────────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.booking_ledger') is not null then
    delete from public.booking_ledger;
  end if;
  if to_regclass('public.booking_queue') is not null then
    delete from public.booking_queue;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- SECTION 3 — CLEAR PLATFORM-LEVEL LOGS / ORPHANS
--   These reference companies with ON DELETE SET NULL, so rows would survive
--   as orphans after the company delete. For a clean test slate, clear them.
--   (Use `delete from` guarded with `to_regclass` so the script is resilient
--    if a table does not exist in this project.)
-- ─────────────────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.activity_events') is not null then
    delete from public.activity_events;
  end if;
  if to_regclass('public.entitlement_activity_log') is not null then
    delete from public.entitlement_activity_log;
  end if;
  if to_regclass('public.service_entitlement_log') is not null then
    delete from public.service_entitlement_log;
  end if;
  if to_regclass('public.audit_events') is not null then
    delete from public.audit_events;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- SECTION 4 — OPTIONAL GLOBAL MASTER-LIBRARY WIPE  (leave commented normally)
--   Uncomment ONLY if you want a truly bare platform with no global catalog.
--   This removes global (company_id IS NULL) templates/catalog the Super Admin
--   maintains. NOT required for the standard create-company flow test.
-- ─────────────────────────────────────────────────────────────────────────
-- delete from public.checklist_templates where company_id is null;
-- delete from public.services           where company_id is null;
-- delete from public.service_categories where company_id is null;
-- delete from public.time_codes         where company_id is null;
-- delete from public.roles              where company_id is null and is_system = false;
-- delete from public.settings_templates;
-- delete from public.service_global_entitlements;

-- ─────────────────────────────────────────────────────────────────────────
-- SECTION 5 — VERIFICATION (read-only; results print in the SQL Editor)
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare
  companies_left   int;
  profiles_left    int;
  non_super_left   int;
  auth_users_left  int;
  customers_left   int;
  workorders_left  int;
  wo_rows_left     int;
  wo_exc_left      int;
  employees_left   int;
  ledger_left      int := 0;
  queue_left       int := 0;
begin
  select count(*) into companies_left  from public.companies;
  select count(*) into profiles_left   from public.profiles;
  select count(*) into non_super_left  from public.profiles where base_role <> 'super_admin';
  select count(*) into auth_users_left from auth.users;
  select count(*) into customers_left  from public.customers;
  select count(*) into workorders_left from public.work_orders;
  select count(*) into wo_rows_left    from public.work_order_service_rows;
  select count(*) into wo_exc_left     from public.work_order_occurrence_exceptions;
  select count(*) into employees_left  from public.employees;
  if to_regclass('public.booking_ledger') is not null then
    execute 'select count(*) from public.booking_ledger' into ledger_left;
  end if;
  if to_regclass('public.booking_queue') is not null then
    execute 'select count(*) from public.booking_queue' into queue_left;
  end if;

  raise notice '─────────────────────────────────────────────';
  raise notice 'RESET SUMMARY (pre-commit):';
  raise notice '  companies remaining ............ %', companies_left;
  raise notice '  profiles remaining ............. % (all should be super_admin)', profiles_left;
  raise notice '  non-super-admin profiles ....... % (must be 0)', non_super_left;
  raise notice '  auth.users remaining ........... % (should equal super_admin count)', auth_users_left;
  raise notice '  customers remaining ............ % (must be 0)', customers_left;
  raise notice '  work_orders remaining .......... % (must be 0)', workorders_left;
  raise notice '  work_order_service_rows ........ % (must be 0)', wo_rows_left;
  raise notice '  occurrence_exceptions .......... % (must be 0)', wo_exc_left;
  raise notice '  employees remaining ............ % (must be 0)', employees_left;
  raise notice '  booking_ledger remaining ....... % (must be 0)', ledger_left;
  raise notice '  booking_queue remaining ........ % (must be 0)', queue_left;
  raise notice '─────────────────────────────────────────────';

  if companies_left <> 0 then
    raise exception 'ABORT: % companies still present after delete.', companies_left;
  end if;
  if non_super_left <> 0 then
    raise exception 'ABORT: % non-super-admin profiles still present.', non_super_left;
  end if;
  if customers_left <> 0 or workorders_left <> 0 or wo_rows_left <> 0
     or wo_exc_left <> 0 or employees_left <> 0 then
    raise exception 'ABORT: company-scoped rows survived (customers=%, work_orders=%, service_rows=%, exceptions=%, employees=%).',
      customers_left, workorders_left, wo_rows_left, wo_exc_left, employees_left;
  end if;
  if ledger_left <> 0 or queue_left <> 0 then
    raise exception 'ABORT: booking rows survived (booking_ledger=%, booking_queue=%).', ledger_left, queue_left;
  end if;
end $$;

-- Final preserved-accounts listing.
select id, email, base_role, company_id, status
from public.profiles
order by created_at;

-- If everything above looks correct, COMMIT. If anything looks wrong, ROLLBACK.
commit;
-- rollback;  -- ← use this instead of commit to abort without applying changes.
