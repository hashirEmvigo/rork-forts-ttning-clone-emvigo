-- ============================================================================
-- CleanOps — ARTNUM-1 (Phase 2 foundation): durable service ARTICLE NUMBER column
-- ============================================================================
--
-- PURPOSE
--   Article numbers are durable BUSINESS / ACCOUNTING / SERVICE codes (used as
--   quick codes when adding services to work orders and, later, for invoicing
--   and import/export). They are Supabase-authoritative — never generated in the
--   frontend/localStorage and never MAX(existing)+1. This migration adds the
--   flat, indexed `article_number` column to `services`, keeps it in sync with
--   the lossless `data` jsonb, backfills existing rows, and adds the uniqueness
--   guards. The database-backed durable SERIES + allocator RPCs live in the
--   companion migration 0051.
--
-- UNIQUENESS DOMAINS — SEPARATE GLOBAL vs PER-COMPANY (approved model)
--   * GLOBAL master catalog: article numbers unique among GLOBAL services
--     (company_id IS NULL AND company_legacy_id IS NULL).
--   * COMPANY catalog: article numbers unique PER COMPANY (company_legacy_id).
--   Cross-scope duplicates are intentionally ALLOWED: global "1001",
--   Company A "1001" and Company B "1001" can all coexist; what is forbidden is
--   two GLOBAL services sharing "1001" or two services inside the SAME company
--   sharing "1001".
--
-- WHY A FLAT COLUMN DERIVED FROM `data` (single source of truth)
--   `articleNumber` already lives inside the lossless `data` jsonb that every
--   service writer (createServiceInSupabase / updateServiceInSupabase /
--   Copy-into-company / migration mirror) persists. Rather than ask every writer
--   to also set a flat column (and risk drift), a BEFORE INSERT/UPDATE trigger
--   PROJECTS `data->>'articleNumber'` into the indexed `article_number` column.
--   The jsonb stays authoritative; the column is a derived projection that the
--   unique guards and the 0051 allocator/validation RPCs read. Any writer that
--   sets `data` automatically gets a correct, indexed article number.
--
-- ARCHIVE / RESTORE IS NOT AFFECTED (deliberate)
--   Service archive/restore only flips `status` (and is still localStorage-backed
--   today). Article-number RESERVATION keys off `deleted_at` (Supabase-
--   authoritative, written only by the authoritative create/update/copy/hard-
--   delete paths) plus the durable 0051 series counter — NEVER off `status`.
--   Archiving a service therefore never frees or reuses its article number: the
--   row keeps `deleted_at IS NULL`, so it stays inside the unique guard below and
--   is still seen by the allocator's collision check.
--
-- EXISTING-DATA PRECHECK (stop-and-report, not force)
--   BEFORE creating the unique guards this migration SCANS existing services for
--   duplicate article numbers in each uniqueness domain. If any duplicate exists
--   it RAISES a descriptive exception and the whole migration rolls back
--   (transactional) — i.e. it STOPS AND REPORTS instead of forcing a constraint
--   that would fail with an opaque error. Blank/whitespace values are normalised
--   to NULL (un-numbered) and never collide.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. COLUMN — flat, indexed, nullable (NULL = no article number on this row).
-- ─────────────────────────────────────────────────────────────────────────
alter table services add column if not exists article_number text;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. SYNC TRIGGER — project data->>'articleNumber' into the flat column.
--    The jsonb remains the single source of truth; the column is derived on
--    every INSERT and UPDATE (incl. ON CONFLICT DO UPDATE upserts), so the
--    indexed value can never drift from the stored Service payload. Blank /
--    whitespace article numbers normalise to NULL.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function set_services_article_number()
returns trigger
language plpgsql
as $$
begin
  new.article_number = nullif(btrim(coalesce(new.data->>'articleNumber', '')), '');
  return new;
end;
$$;

drop trigger if exists trg_services_article_number on services;
create trigger trg_services_article_number
  before insert or update on services
  for each row
  execute function set_services_article_number();

-- ─────────────────────────────────────────────────────────────────────────
-- 3. BACKFILL — populate the column for existing rows from the jsonb.
-- ─────────────────────────────────────────────────────────────────────────
update services
   set article_number = nullif(btrim(coalesce(data->>'articleNumber', '')), '')
 where article_number is distinct from nullif(btrim(coalesce(data->>'articleNumber', '')), '');

-- ─────────────────────────────────────────────────────────────────────────
-- 4. PRECHECK — scan for duplicate article numbers per uniqueness domain.
--    Stop-and-report (RAISE) instead of forcing the unique guards onto dirty
--    data. Only ACTIVE (deleted_at IS NULL) rows with a non-null article number
--    participate, mirroring the partial unique indexes created below.
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare
  v_global_dupes text;
  v_company_dupes text;
begin
  -- GLOBAL scope: company_id IS NULL AND company_legacy_id IS NULL.
  select string_agg(d.article_number || ' (x' || d.cnt || ')', ', ' order by d.article_number)
    into v_global_dupes
    from (
      select article_number, count(*) as cnt
        from services
       where company_id is null
         and company_legacy_id is null
         and deleted_at is null
         and article_number is not null
       group by article_number
      having count(*) > 1
    ) d;

  -- COMPANY scope: per company_legacy_id.
  select string_agg(
           d.company_legacy_id || ':' || d.article_number || ' (x' || d.cnt || ')',
           ', ' order by d.company_legacy_id, d.article_number)
    into v_company_dupes
    from (
      select company_legacy_id, article_number, count(*) as cnt
        from services
       where company_legacy_id is not null
         and deleted_at is null
         and article_number is not null
       group by company_legacy_id, article_number
      having count(*) > 1
    ) d;

  if v_global_dupes is not null or v_company_dupes is not null then
    raise exception
      'ARTNUM-1 precheck FAILED — duplicate article numbers exist; migration stopped (no constraints applied). Global duplicates: [%]. Company duplicates: [%]. Resolve these before re-running.',
      coalesce(v_global_dupes, 'none'),
      coalesce(v_company_dupes, 'none');
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. UNIQUE GUARDS — partial, per uniqueness domain.
--    * NULL article numbers (un-numbered services) never collide.
--    * Soft-deleted rows (deleted_at IS NOT NULL) are excluded so removing a
--      service does not block re-creating it (the upsert un-deletes by
--      legacy_id); durable NO-REUSE of GENERATED numbers is guaranteed by the
--      0051 series high-water mark, which never rewinds.
--    * GLOBAL guard keys on article_number alone (one global domain).
--    * COMPANY guard keys on (company_legacy_id, article_number).
-- ─────────────────────────────────────────────────────────────────────────
create unique index if not exists uq_services_global_article_number
  on services (article_number)
  where company_id is null
    and company_legacy_id is null
    and article_number is not null
    and deleted_at is null;

create unique index if not exists uq_services_company_article_number
  on services (company_legacy_id, article_number)
  where company_legacy_id is not null
    and article_number is not null
    and deleted_at is null;
