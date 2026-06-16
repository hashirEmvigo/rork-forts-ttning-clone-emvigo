# CleanOps — Manual Supabase Migration Runbook (0006 → 0016)

> **Status:** PREPARATION ONLY. This document is the controlled execution package
> for manually applying migrations `0006` → `0016` in the **existing** live
> Supabase project's SQL Editor. Nothing here is executed by the agent.
>
> **Execution channel:** Supabase Dashboard → SQL Editor (runs as a privileged
> role, which is why DDL succeeds here but not through Rork's anon-bound tools).

---

## A. Manual migration runbook

### Pre-flight (read once, before Step 1)

1. **Confirm you are on the correct project.** Supabase Dashboard project ref must
   match the host in `EXPO_PUBLIC_SUPABASE_URL`
   (`https://swqcdcpwofdnmoureifu.supabase.co`). If it does not match, **STOP** —
   do not run anything.
2. **Confirm the foundation exists.** Migrations `0002`–`0005` are already applied
   (`companies`, `profiles`, and the SECURITY DEFINER helpers
   `is_super_admin()`, `current_company_id()`, `current_base_role()`). Every
   migration below depends on these helpers. Verify:
   ```sql
   select
     to_regclass('public.companies')              as companies,
     to_regclass('public.profiles')               as profiles,
     pg_get_functiondef('public.is_super_admin()'::regprocedure)      is not null as has_is_super_admin,
     pg_get_functiondef('public.current_company_id()'::regprocedure)  is not null as has_current_company_id,
     pg_get_functiondef('public.current_base_role()'::regprocedure)   is not null as has_current_base_role;
   ```
   All five columns must be non-null / `true`. **If any is null/false, STOP.**
3. **DO NOT run `0001_schema_plan.sql`.** It is a plan-only file that creates
   thinner/conflicting versions of operational tables. It is excluded from this
   runbook entirely.

### Execution model (strict)

```
Migration N  →  Verification SQL  →  REST check  →  PASS?  →  approve  →  Migration N+1
                                                  └─ FAIL ─→  STOP, report, rollback if needed
```

- Run **one migration at a time**. Never paste two migration files together.
- The **exact SQL for each step is the verbatim contents of the corresponding
  file** in `web-cleanops/supabase/migrations/`. These files are the single
  source of truth — copy the whole file into the SQL Editor and run it. Do **not**
  retype or summarise the SQL (transcription drift is a real risk). Each step
  below names the exact file, the objects it creates, the verification SQL, the
  REST target, stop conditions, and an emergency-only rollback.
- All migrations are **idempotent** (`create table if not exists`,
  `create index if not exists`, `drop policy if exists` before `create policy`,
  `add column if not exists`). Re-running a step that partially succeeded is safe.
- **REST checks** use the anon key. Expected result for a freshly created, empty,
  RLS-protected table is **HTTP 200 with an empty array `[]`** (anon is
  authenticated-only blocked → returns `[]`, not rows). A `PGRST205`
  "Could not find the table ... in the schema cache" means the table is missing
  **or** the schema cache is stale — see the final cache-reload step.

REST check template (run in a terminal; substitute the table name):
```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://swqcdcpwofdnmoureifu.supabase.co/rest/v1/<TABLE>?select=id&limit=1" \
  -H "apikey: $EXPO_PUBLIC_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $EXPO_PUBLIC_SUPABASE_ANON_KEY"
```
Expected: `200`. (Note: PostgREST cache may lag a few seconds after DDL — if you
get `404`/`PGRST205` immediately after a migration, run the cache-reload from the
final step and retry once before treating it as a failure.)

---

## B–E. Per-migration blocks (SQL · verification · REST · stop · rollback)

> **Reusable verification helpers**
>
> Table exists:
> ```sql
> select to_regclass('public.<TABLE>') is not null as table_exists;
> ```
> RLS enabled:
> ```sql
> select relrowsecurity as rls_enabled
> from pg_class where oid = 'public.<TABLE>'::regclass;
> ```
> Policy list:
> ```sql
> select policyname, cmd from pg_policies
> where schemaname = 'public' and tablename = '<TABLE>'
> order by policyname;
> ```

---

### Step 1 — Migration `0006_entitlement_schema`

- **SQL block:** paste the full contents of
  `supabase/migrations/0006_entitlement_schema.sql`.
- **Creates:** function `set_entitlement_updated_at()`; tables
  `entitlement_bundles`, `entitlement_bundle_grants`,
  `entitlement_bundle_grant_limits`, `company_bundle_assignments`,
  `company_feature_overrides`, `company_feature_override_limits`,
  `entitlement_activity_log`; their indexes, `updated_at` triggers, and RLS
  policies.
- **Verification SQL:**
  ```sql
  -- B. tables exist (expect 7 rows)
  select table_name
  from information_schema.tables
  where table_schema = 'public'
    and table_name in (
      'entitlement_bundles','entitlement_bundle_grants',
      'entitlement_bundle_grant_limits','company_bundle_assignments',
      'company_feature_overrides','company_feature_override_limits',
      'entitlement_activity_log'
    )
  order by table_name;

  -- D. RLS enabled on all 7 (expect every row rls_enabled = true)
  select relname, relrowsecurity as rls_enabled
  from pg_class
  where relnamespace = 'public'::regnamespace
    and relname in (
      'entitlement_bundles','entitlement_bundle_grants',
      'entitlement_bundle_grant_limits','company_bundle_assignments',
      'company_feature_overrides','company_feature_override_limits',
      'entitlement_activity_log'
    )
  order by relname;

  -- partial unique invariants present (expect 2 rows)
  select indexname from pg_indexes
  where schemaname='public'
    and indexname in ('uniq_active_base_plan','uniq_active_override');
  ```
- **REST target:** `entitlement_bundles` (also spot-check
  `company_bundle_assignments`). Expect `200`.
- **Stop conditions:** any of the 7 tables missing; any `rls_enabled = false`;
  either partial unique index missing; SQL error referencing a missing helper
  (`is_super_admin`/`current_company_id`/`current_base_role`) → STOP, the
  foundation pre-flight failed.
- **Rollback (emergency only — destroys entitlement tables):**
  ```sql
  drop table if exists entitlement_activity_log cascade;
  drop table if exists company_feature_override_limits cascade;
  drop table if exists company_feature_overrides cascade;
  drop table if exists company_bundle_assignments cascade;
  drop table if exists entitlement_bundle_grant_limits cascade;
  drop table if exists entitlement_bundle_grants cascade;
  drop table if exists entitlement_bundles cascade;
  drop function if exists set_entitlement_updated_at() cascade;
  ```

---

### Step 2 — Migration `0007_customers_table`

- **SQL block:** paste the full contents of
  `supabase/migrations/0007_customers_table.sql`.
- **Creates:** table `customers`; its indexes; function
  `set_customers_updated_at()` + trigger; RLS policies (select/insert/update for
  own-company and super-admin; **no delete**).
- **Verification SQL:**
  ```sql
  select to_regclass('public.customers') is not null as table_exists;
  select relrowsecurity as rls_enabled from pg_class where oid='public.customers'::regclass;
  -- expect 6 policies, no DELETE policy
  select policyname, cmd from pg_policies
  where schemaname='public' and tablename='customers' order by policyname;
  ```
- **REST target:** `customers`. Expect `200`.
- **Stop conditions:** table missing; `rls_enabled = false`; any DELETE policy
  present (must be none); REST ≠ 200 after cache reload.
- **Rollback (emergency only):**
  ```sql
  drop table if exists customers cascade;
  drop function if exists set_customers_updated_at() cascade;
  ```

---

### Step 3 — Migration `0008_work_orders_tables`

- **SQL block:** paste the full contents of
  `supabase/migrations/0008_work_orders_tables.sql`.
- **Creates:** tables `work_orders`, `work_order_service_rows`,
  `work_order_occurrence_exceptions`; indexes; function
  `set_work_orders_updated_at()` + 3 triggers; RLS policies (no delete).
- **Verification SQL:**
  ```sql
  select table_name from information_schema.tables
  where table_schema='public'
    and table_name in ('work_orders','work_order_service_rows','work_order_occurrence_exceptions')
  order by table_name;  -- expect 3 rows

  select relname, relrowsecurity as rls_enabled from pg_class
  where relnamespace='public'::regnamespace
    and relname in ('work_orders','work_order_service_rows','work_order_occurrence_exceptions')
  order by relname;  -- all true
  ```
- **REST targets:** `work_orders`, `work_order_service_rows`,
  `work_order_occurrence_exceptions`. Each expect `200`.
- **Stop conditions:** any of the 3 tables missing; any `rls_enabled = false`;
  REST ≠ 200 after cache reload.
- **Rollback (emergency only):**
  ```sql
  drop table if exists work_order_occurrence_exceptions cascade;
  drop table if exists work_order_service_rows cascade;
  drop table if exists work_orders cascade;
  drop function if exists set_work_orders_updated_at() cascade;
  ```

---

### Step 4 — Migration `0009_work_orders_soft_delete`

- **Depends on Step 3.** Must run **after** `0008`.
- **SQL block:** paste the full contents of
  `supabase/migrations/0009_work_orders_soft_delete.sql`.
- **Creates:** adds `deleted_at timestamptz` to the 3 work-order tables; partial
  active-row indexes. No new tables, no policy changes.
- **Verification SQL:**
  ```sql
  -- expect 3 rows, all with deleted_at present
  select table_name, column_name, data_type, is_nullable
  from information_schema.columns
  where table_schema='public'
    and column_name='deleted_at'
    and table_name in ('work_orders','work_order_service_rows','work_order_occurrence_exceptions')
  order by table_name;

  -- partial indexes present (expect 3 rows)
  select indexname from pg_indexes
  where schemaname='public'
    and indexname in ('idx_work_orders_active','idx_wo_rows_active','idx_wo_exceptions_active');
  ```
- **REST target:** `work_orders?select=id,deleted_at&limit=1`. Expect `200` and
  the `deleted_at` column resolves (no `PGRST` column error).
- **Stop conditions:** `deleted_at` missing on any of the 3 tables; any partial
  index missing; REST column error after cache reload.
- **Rollback (emergency only — only if this step must be reverted independently):**
  ```sql
  drop index if exists idx_wo_exceptions_active;
  drop index if exists idx_wo_rows_active;
  drop index if exists idx_work_orders_active;
  alter table work_order_occurrence_exceptions drop column if exists deleted_at;
  alter table work_order_service_rows          drop column if exists deleted_at;
  alter table work_orders                      drop column if exists deleted_at;
  ```

---

### Step 5 — Migration `0010_employees_table`

- **SQL block:** paste the full contents of
  `supabase/migrations/0010_employees_table.sql`.
- **Creates:** table `employees` (includes `deleted_at`); indexes + partial
  active index; function `set_employees_updated_at()` + trigger; RLS policies
  (no delete).
- **Verification SQL:**
  ```sql
  select to_regclass('public.employees') is not null as table_exists;
  select relrowsecurity as rls_enabled from pg_class where oid='public.employees'::regclass;
  select indexname from pg_indexes
  where schemaname='public' and tablename='employees' and indexname='idx_employees_active';
  ```
- **REST target:** `employees`. Expect `200`.
- **Stop conditions:** table missing; `rls_enabled=false`; `idx_employees_active`
  missing; REST ≠ 200 after cache reload.
- **Rollback (emergency only):**
  ```sql
  drop table if exists employees cascade;
  drop function if exists set_employees_updated_at() cascade;
  ```

---

### Step 6 — Migration `0011_time_codes`

- **SQL block:** paste the full contents of
  `supabase/migrations/0011_time_codes.sql`.
- **Creates:** table `time_codes`; two partial unique indexes
  (`time_codes_global_code_key`, `time_codes_company_code_key`); supporting
  indexes; RLS `select` policy `time_codes_read`.
- **Verification SQL:**
  ```sql
  select to_regclass('public.time_codes') is not null as table_exists;
  select relrowsecurity as rls_enabled from pg_class where oid='public.time_codes'::regclass;
  select indexname from pg_indexes
  where schemaname='public' and tablename='time_codes'
    and indexname in ('time_codes_global_code_key','time_codes_company_code_key')
  order by indexname;  -- expect 2 rows
  ```
- **REST target:** `time_codes`. Expect `200`.
- **Stop conditions:** table missing; `rls_enabled=false`; either partial unique
  index missing; REST ≠ 200 after cache reload.
- **Rollback (emergency only):**
  ```sql
  drop table if exists time_codes cascade;
  ```

---

### Step 7 — Migration `0012_payroll_export`

- **SQL block:** paste the full contents of
  `supabase/migrations/0012_payroll_export.sql`.
- **Creates:** tables `payroll_export_capabilities`, `payroll_export_profiles`,
  `payroll_export_runs`; indexes; RLS `select` policies.
  (`PayrollBasis` is intentionally NOT created.)
- **Verification SQL:**
  ```sql
  select table_name from information_schema.tables
  where table_schema='public'
    and table_name in ('payroll_export_capabilities','payroll_export_profiles','payroll_export_runs')
  order by table_name;  -- expect 3 rows

  select relname, relrowsecurity as rls_enabled from pg_class
  where relnamespace='public'::regnamespace
    and relname in ('payroll_export_capabilities','payroll_export_profiles','payroll_export_runs')
  order by relname;  -- all true
  ```
- **REST targets:** `payroll_export_capabilities`, `payroll_export_profiles`,
  `payroll_export_runs`. Each expect `200`.
- **Stop conditions:** any of the 3 tables missing; any `rls_enabled=false`;
  REST ≠ 200 after cache reload.
- **Rollback (emergency only):**
  ```sql
  drop table if exists payroll_export_runs cascade;
  drop table if exists payroll_export_profiles cascade;
  drop table if exists payroll_export_capabilities cascade;
  ```

---

### Step 8 — Migration `0013_customer_agreements`

- **SQL block:** paste the full contents of
  `supabase/migrations/0013_customer_agreements.sql`.
- **Creates:** tables `customer_agreements`, `customer_agreement_lines`; unique
  index `uq_customer_agreements_group_version`; scope indexes; function
  `set_customer_agreements_updated_at()` + 2 triggers; RLS policies (no delete).
- **Verification SQL:**
  ```sql
  select table_name from information_schema.tables
  where table_schema='public'
    and table_name in ('customer_agreements','customer_agreement_lines')
  order by table_name;  -- expect 2 rows

  select relname, relrowsecurity as rls_enabled from pg_class
  where relnamespace='public'::regnamespace
    and relname in ('customer_agreements','customer_agreement_lines')
  order by relname;  -- all true

  select indexname from pg_indexes
  where schemaname='public' and indexname='uq_customer_agreements_group_version';
  ```
- **REST targets:** `customer_agreements`, `customer_agreement_lines`. Each
  expect `200`.
- **Stop conditions:** either table missing; any `rls_enabled=false`; unique
  index missing; REST ≠ 200 after cache reload.
- **Rollback (emergency only):**
  ```sql
  drop table if exists customer_agreement_lines cascade;
  drop table if exists customer_agreements cascade;
  drop function if exists set_customer_agreements_updated_at() cascade;
  ```

---

### Step 9 — Migration `0014_time_bank`

- **SQL block:** paste the full contents of
  `supabase/migrations/0014_time_bank.sql`.
- **Creates:** tables `time_bank_wallets`, `time_bank_transactions`; unique index
  `uq_time_bank_wallets_group`; ledger indexes; function
  `set_time_bank_wallets_updated_at()` + trigger; RLS — wallets get
  select/insert/update; **transactions get SELECT + INSERT only** (append-only;
  no update/delete policy by design).
- **Verification SQL:**
  ```sql
  select table_name from information_schema.tables
  where table_schema='public'
    and table_name in ('time_bank_wallets','time_bank_transactions')
  order by table_name;  -- expect 2 rows

  select relname, relrowsecurity as rls_enabled from pg_class
  where relnamespace='public'::regnamespace
    and relname in ('time_bank_wallets','time_bank_transactions')
  order by relname;  -- all true

  -- append-only proof: transactions must have NO update/delete policy
  select cmd, count(*) from pg_policies
  where schemaname='public' and tablename='time_bank_transactions'
  group by cmd order by cmd;  -- expect only SELECT and INSERT

  select indexname from pg_indexes
  where schemaname='public' and indexname='uq_time_bank_wallets_group';
  ```
- **REST targets:** `time_bank_wallets`, `time_bank_transactions`. Each expect
  `200`.
- **Stop conditions:** either table missing; any `rls_enabled=false`; any
  UPDATE/DELETE policy on `time_bank_transactions` (must be none); unique index
  missing; REST ≠ 200 after cache reload.
- **Rollback (emergency only):**
  ```sql
  drop table if exists time_bank_transactions cascade;
  drop table if exists time_bank_wallets cascade;
  drop function if exists set_time_bank_wallets_updated_at() cascade;
  ```

---

### Step 10 — Migration `0015_agreement_templates`

- **SQL block:** paste the full contents of
  `supabase/migrations/0015_agreement_templates.sql`.
- **Creates:** tables `agreement_templates`, `agreement_template_lines`; indexes;
  function `set_agreement_templates_updated_at()` + 2 triggers; RLS — global
  read for all authenticated, company-scoped + super-admin write; **no delete**.
  > This is the table whose absence produced the original `PGRST205`
  > "Could not find the table 'public.agreement_templates'" errors. After this
  > step + the final cache reload, the Agreement Templates UI list/create works.
- **Verification SQL:**
  ```sql
  select table_name from information_schema.tables
  where table_schema='public'
    and table_name in ('agreement_templates','agreement_template_lines')
  order by table_name;  -- expect 2 rows

  select relname, relrowsecurity as rls_enabled from pg_class
  where relnamespace='public'::regnamespace
    and relname in ('agreement_templates','agreement_template_lines')
  order by relname;  -- all true

  -- global-read policy present on both tables (expect 2 rows)
  select tablename, policyname from pg_policies
  where schemaname='public'
    and policyname in ('agt_select_global','agtl_select_global')
  order by tablename;
  ```
- **REST targets:** `agreement_templates`, `agreement_template_lines`. Each
  expect `200`.
- **Stop conditions:** either table missing; any `rls_enabled=false`; either
  global-read policy missing; REST ≠ 200 after cache reload.
- **Rollback (emergency only):**
  ```sql
  drop table if exists agreement_template_lines cascade;
  drop table if exists agreement_templates cascade;
  drop function if exists set_agreement_templates_updated_at() cascade;
  ```

---

### Step 11 — Migration `0016_time_bank_legacy_notes`

- **Depends on Step 9** (conceptually pairs with `0014`). Run **after** `0014`.
- **SQL block:** paste the full contents of
  `supabase/migrations/0016_time_bank_legacy_notes.sql`.
- **Creates:** table `time_bank_legacy_notes` (informational only — **no
  `minutes` column**); indexes; RLS SELECT + INSERT only (append-only).
- **Verification SQL:**
  ```sql
  select to_regclass('public.time_bank_legacy_notes') is not null as table_exists;
  select relrowsecurity as rls_enabled from pg_class where oid='public.time_bank_legacy_notes'::regclass;

  -- balance-safety proof: there must be NO minutes column
  select count(*) as minutes_column_count
  from information_schema.columns
  where table_schema='public' and table_name='time_bank_legacy_notes' and column_name='minutes';
  -- expect 0

  -- append-only proof: only SELECT + INSERT policies
  select cmd, count(*) from pg_policies
  where schemaname='public' and tablename='time_bank_legacy_notes'
  group by cmd order by cmd;
  ```
- **REST target:** `time_bank_legacy_notes`. Expect `200`.
- **Stop conditions:** table missing; `rls_enabled=false`; a `minutes` column
  exists (must be 0); any UPDATE/DELETE policy present; REST ≠ 200 after cache
  reload.
- **Rollback (emergency only):**
  ```sql
  drop table if exists time_bank_legacy_notes cascade;
  ```

---

## F. Final PostgREST schema cache reload (run once, AFTER Step 11)

PostgREST caches the schema; new tables can return `PGRST205` until it reloads.
Run in the SQL Editor:

```sql
notify pgrst, 'reload schema';
```

Then wait ~5–10 seconds. (Alternative refresh paths if `NOTIFY` does not take
effect: Supabase Dashboard → **Settings → API → "Reload schema cache"**, or
toggle/save any setting on **Settings → API** which forces a PostgREST restart.)

---

## G. Final full validation checklist

Run all of these after the cache reload. Every check must pass.

**1. All 18 new tables exist (expect 18 rows):**
```sql
select table_name
from information_schema.tables
where table_schema='public'
  and table_name in (
    'entitlement_bundles','entitlement_bundle_grants','entitlement_bundle_grant_limits',
    'company_bundle_assignments','company_feature_overrides','company_feature_override_limits',
    'entitlement_activity_log',
    'customers',
    'work_orders','work_order_service_rows','work_order_occurrence_exceptions',
    'employees',
    'time_codes',
    'payroll_export_capabilities','payroll_export_profiles','payroll_export_runs',
    'customer_agreements','customer_agreement_lines',
    'time_bank_wallets','time_bank_transactions',
    'agreement_templates','agreement_template_lines',
    'time_bank_legacy_notes'
  )
order by table_name;
```
> (The IN-list intentionally enumerates all 24 expected objects across 0006–0016;
> confirm the count returned equals the number created — none should be missing.)

**2. RLS enabled on every new table (every row must be `true`):**
```sql
select relname, relrowsecurity as rls_enabled
from pg_class
where relnamespace='public'::regnamespace
  and relname in (
    'entitlement_bundles','entitlement_bundle_grants','entitlement_bundle_grant_limits',
    'company_bundle_assignments','company_feature_overrides','company_feature_override_limits',
    'entitlement_activity_log','customers','work_orders','work_order_service_rows',
    'work_order_occurrence_exceptions','employees','time_codes',
    'payroll_export_capabilities','payroll_export_profiles','payroll_export_runs',
    'customer_agreements','customer_agreement_lines','time_bank_wallets',
    'time_bank_transactions','agreement_templates','agreement_template_lines',
    'time_bank_legacy_notes'
  )
order by relname;
```

**3. Append-only ledgers have NO update/delete policies (expect 0 rows):**
```sql
select tablename, cmd from pg_policies
where schemaname='public'
  and tablename in ('time_bank_transactions','time_bank_legacy_notes')
  and cmd in ('UPDATE','DELETE');
```

**4. No DELETE policies anywhere in the new set (expect 0 rows):**
```sql
select tablename, policyname from pg_policies
where schemaname='public' and cmd='DELETE'
  and tablename in (
    'customers','work_orders','work_order_service_rows','work_order_occurrence_exceptions',
    'employees','customer_agreements','customer_agreement_lines',
    'time_bank_wallets','time_bank_transactions','agreement_templates',
    'agreement_template_lines','time_bank_legacy_notes'
  );
```

**5. REST 200 for every new table (terminal loop):**
```bash
BASE="https://swqcdcpwofdnmoureifu.supabase.co/rest/v1"
KEY="$EXPO_PUBLIC_SUPABASE_ANON_KEY"
for t in entitlement_bundles entitlement_bundle_grants entitlement_bundle_grant_limits \
         company_bundle_assignments company_feature_overrides company_feature_override_limits \
         entitlement_activity_log customers work_orders work_order_service_rows \
         work_order_occurrence_exceptions employees time_codes \
         payroll_export_capabilities payroll_export_profiles payroll_export_runs \
         customer_agreements customer_agreement_lines time_bank_wallets \
         time_bank_transactions agreement_templates agreement_template_lines \
         time_bank_legacy_notes; do
  code=$(curl -s -o /dev/null -w "%{http_code}" \
    "$BASE/$t?select=*&limit=1" -H "apikey: $KEY" -H "Authorization: Bearer $KEY")
  echo "$code  $t"
done
```
Every line must read `200`.

**6. Application smoke checks (in the deployed app, logged in as Super Admin):**
- [ ] **Agreement Templates** — list loads; create a draft global template
  succeeds (no `PGRST205`).
- [ ] **Customer Agreements** — agreement detail host page loads without table
  errors.
- [ ] **Time Bank** — admin panel mounts on an agreement; no missing-table errors.
- [ ] **Employees** — page loads.
- [ ] **Customers** — page loads.
- [ ] **Work Orders** — list/detail load.
- [ ] **Time Codes / Payroll Export** — dependency screens load.
- [ ] **Entitlements** — Super Admin entitlement screens load.
- [ ] **Browser console** — no `PGRST205` / "table not found in schema cache" /
  missing-table errors on any of the above.

---

## H. Final expected success criteria

The migration run is **SUCCESS** when **all** of the following hold:

1. Steps 1–11 each completed with no SQL error and were verified individually
   before proceeding (one-at-a-time model honoured).
2. Final checklist §1 returns all expected tables; §2 shows RLS `true` everywhere;
   §3 and §4 return **0 rows** (append-only + no-delete invariants intact).
3. Final checklist §5 returns `200` for every table.
4. Schema cache reloaded; no `PGRST205` anywhere.
5. App smoke checks (§6) all pass with a clean console.
6. `0001_schema_plan` was **never** run; no env vars changed; no service-role key
   added to the app; no feature flags enabled; no production-authoritative read
   flips; no data migrations performed (schema + policies only).

**Verdict scale:** `SUCCESS` (all above) · `SUCCESS WITH WARNINGS` (all tables +
RLS + REST pass, but a non-blocking smoke check is deferred) · `FAILED` (any stop
condition triggered — halt, report root cause + affected migration, apply the
emergency rollback for that step only, and wait for approval before retrying).

---

### Appendix — recommended order (locked)

```
0006 → 0007 → 0008 → 0009 → 0010 → 0011 → 0012 → 0013 → 0014 → 0015 → 0016
```
Constraints respected: `0009` follows `0008` (adds columns to its tables); `0016`
follows `0014` (pairs with the Time Bank wallet/ledger); `0001_schema_plan` is
**skipped**. All other steps are numeric-order and dependency-clean.

---

# CleanOps — Controlled `0032` Time Reporting Apply-and-Verify Runbook

> **Status:** PREPARATION ONLY. This block is the controlled execution package for
> manually applying **one** migration — `0032_time_reporting_tables.sql` — in the
> deployed **dev/demo** Supabase project's SQL Editor. **Nothing here is executed by
> the agent.** A human operator with Supabase Dashboard / SQL Editor access runs it.
>
> **Why manual:** DDL must run as a privileged role in the SQL Editor; Rork's tools
> are anon-bound and cannot create tables. Read-only verification (the REST probe)
> *can* be run by anon and is the gate that proves the apply succeeded.
>
> **This block is schema-only.** It does **not** change any feature flag, does not
> enable dual-write/shadow/read/authoritative modes, does not rebuild/redeploy, and
> does not run checkout tests. Those are separate, later, explicitly-approved steps.

## TR0. Preconditions (read once, before doing anything)

1. **Confirm the locked flag state is unchanged.** All of the following must remain
   as they are today — this runbook changes **none** of them:
   - `EXPO_PUBLIC_MISSION_LOG_DUAL_WRITE = true` (already-validated; the only ON flag)
   - `TIME_REPORTING_DUAL_WRITE` — OFF
   - `TIME_REPORTING_SHADOW_VALIDATE` — OFF
   - `TIME_REPORTING_SUPABASE_READ` — OFF
   - `TIME_REPORTING_SUPABASE_AUTHORITATIVE` — OFF
   - `MISSION_LOG_SUPABASE_READ` — OFF
   - `MISSION_LOG_SUPABASE_AUTHORITATIVE` — OFF
2. **Confirm you are on the correct project.** The Supabase Dashboard project ref
   must match the host in `EXPO_PUBLIC_SUPABASE_URL`
   (`https://swqcdcpwofdnmoureifu.supabase.co`). If it does not match, **STOP**.
3. **Confirm the foundation exists.** `0032` depends on `companies` and the
   SECURITY DEFINER helpers `is_super_admin()` and `current_company_id()` (used in
   every RLS policy). Verify:
   ```sql
   select
     to_regclass('public.companies') is not null                                as companies,
     pg_get_functiondef('public.is_super_admin()'::regprocedure)     is not null as has_is_super_admin,
     pg_get_functiondef('public.current_company_id()'::regprocedure) is not null as has_current_company_id;
   ```
   All three must be `true`. **If any is false, STOP** — apply the earlier foundation
   migrations first.
4. **Confirm the exact migration to apply** is
   `web-cleanops/supabase/migrations/0032_time_reporting_tables.sql` (the
   `TIMEREPORTING-1` schema foundation) — and **only** that file.
5. **No checkout testing before verification passes.** Do not run any checkout, do
   not flip `TIME_REPORTING_DUAL_WRITE`, until the TR3 schema-cache probe is green.

## TR1. SQL Editor apply step

- **File location:** `web-cleanops/supabase/migrations/0032_time_reporting_tables.sql`.
- **How to run safely:** open the deployed dev/demo project → **SQL Editor** → new
  query → paste the **entire, verbatim** contents of the file → **Run**. Do not
  retype or summarise the SQL (transcription drift is a real risk). Run this file
  **alone** — do not paste any other migration in the same query.
- **Idempotency:** the migration is fully idempotent — `create table if not
  exists`, `create index if not exists`, `create or replace function`,
  `drop trigger/policy if exists` before each `create`. Re-running a partially-applied
  step is safe and will not duplicate objects or error on existing ones.
- **What success looks like:** the query completes with **no error** ("Success. No
  rows returned"). It creates one function (`set_time_reporting_updated_at()`) and
  **nine tables** with their indexes, `updated_at` triggers (on the six mutable
  tables), and RLS policies.

## TR2. PostgREST schema-cache reload (run once, immediately after TR1)

New tables can return `PGRST205` until PostgREST reloads its schema cache. In the
SQL Editor:
```sql
notify pgrst, 'reload schema';
```
Wait ~5–10 seconds. (Alternatives if `NOTIFY` does not take: Dashboard →
**Settings → API → "Reload schema cache"**, or save any setting on **Settings → API**
to force a PostgREST restart.)

## TR3. Read-only verification — nine-table schema-cache probe (the gate)

Run this in a terminal. Expected for every freshly-created, empty, RLS-protected
table: **HTTP `200` with an empty array `[]`** (anon is RLS-blocked from rows → it
returns `[]`, not data). `PGRST205` / `404` means the table is missing **or** the
cache is still stale — see TR5.

```bash
BASE="https://swqcdcpwofdnmoureifu.supabase.co/rest/v1"
KEY="$EXPO_PUBLIC_SUPABASE_ANON_KEY"
for t in time_reports time_allocations time_report_events time_report_flags \
         time_report_flag_events time_report_messages time_deviation_reason_codes \
         saved_filters saved_review_queues; do
  code=$(curl -s -o /dev/null -w "%{http_code}" \
    "$BASE/$t?select=id&limit=1" -H "apikey: $KEY" -H "Authorization: Bearer $KEY")
  echo "$code  $t"
done
```

**Exact nine-table list (all must return `200`):**

| # | Table | Kind |
|---|---|---|
| 1 | `time_reports` | mutable (soft-delete) |
| 2 | `time_allocations` | mutable (soft-delete) |
| 3 | `time_report_events` | append-only (immutable) |
| 4 | `time_report_flags` | mutable (soft-delete) |
| 5 | `time_report_flag_events` | append-only (immutable) |
| 6 | `time_report_messages` | append-only |
| 7 | `time_deviation_reason_codes` | mutable (soft-delete) |
| 8 | `saved_filters` | mutable (soft-delete) |
| 9 | `saved_review_queues` | mutable (soft-delete) |

**Expected result: all nine lines read `200`.** This probe alone is sufficient to
prove `0032` is applied and visible in the schema cache.

## TR4. Optional privileged SQL verification (run in SQL Editor)

Stronger, optional confirmation beyond the REST gate.

**1. All nine tables exist (expect 9 rows):**
```sql
select table_name from information_schema.tables
where table_schema='public'
  and table_name in (
    'time_reports','time_allocations','time_report_events','time_report_flags',
    'time_report_flag_events','time_report_messages','time_deviation_reason_codes',
    'saved_filters','saved_review_queues'
  )
order by table_name;
```

**2. RLS enabled on every table (every row `rls_enabled = true`):**
```sql
select relname, relrowsecurity as rls_enabled
from pg_class
where relnamespace='public'::regnamespace
  and relname in (
    'time_reports','time_allocations','time_report_events','time_report_flags',
    'time_report_flag_events','time_report_messages','time_deviation_reason_codes',
    'saved_filters','saved_review_queues'
  )
order by relname;
```

**3. Own-company + super-admin policies present (expect SELECT/INSERT pairs on each;
the six mutable tables also have UPDATE pairs):**
```sql
select tablename, cmd, count(*) as policy_count
from pg_policies
where schemaname='public'
  and tablename in (
    'time_reports','time_allocations','time_report_events','time_report_flags',
    'time_report_flag_events','time_report_messages','time_deviation_reason_codes',
    'saved_filters','saved_review_queues'
  )
group by tablename, cmd
order by tablename, cmd;
```

**4. Unique `legacy_id` upsert keys exist on all nine (expect 9 rows):**
```sql
select tc.table_name, tc.constraint_name
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name
 and tc.table_schema  = kcu.table_schema
where tc.table_schema='public'
  and tc.constraint_type='UNIQUE'
  and kcu.column_name='legacy_id'
  and tc.table_name in (
    'time_reports','time_allocations','time_report_events','time_report_flags',
    'time_report_flag_events','time_report_messages','time_deviation_reason_codes',
    'saved_filters','saved_review_queues'
  )
order by tc.table_name;
```

**5. Relevant mirror/readiness indexes present (spot-check the lookup keys the
checkout-mirror / parity path uses):**
```sql
select indexname from pg_indexes
where schemaname='public'
  and indexname in (
    'idx_time_reports_service_row','idx_time_reports_mission_entry',
    'idx_time_reports_company_status','idx_time_allocations_report',
    'idx_time_report_events_report_occurred','idx_time_report_flags_open'
  )
order by indexname;
```

**6. Append-only invariant — events/flag-events/messages must have NO update/delete
policy (expect 0 rows):**
```sql
select tablename, cmd from pg_policies
where schemaname='public'
  and tablename in ('time_report_events','time_report_flag_events','time_report_messages')
  and cmd in ('UPDATE','DELETE');
```

**7. No DELETE policy anywhere in the 0032 set (soft-delete convention; expect 0
rows):**
```sql
select tablename, policyname from pg_policies
where schemaname='public' and cmd='DELETE'
  and tablename in (
    'time_reports','time_allocations','time_report_events','time_report_flags',
    'time_report_flag_events','time_report_messages','time_deviation_reason_codes',
    'saved_filters','saved_review_queues'
  );
```

## TR5. Failure handling

- **`PGRST205` on any table immediately after apply:** the cache is likely stale.
  Re-run TR2 (`notify pgrst, 'reload schema';`), wait ~10s, then re-run the TR3
  probe **once**. Schema-cache lag is normal for a few seconds after DDL.
- **`PGRST205` persists after a second reload + ~30s:** treat as a real failure —
  the table was not created. Re-open `0032` in the SQL Editor, check the run output
  for the first SQL error, fix the root cause (most commonly a missing foundation
  helper from TR0 step 3), and re-run the whole file (it is idempotent).
- **SQL error referencing `is_super_admin` / `current_company_id`:** the foundation
  is missing → **STOP**, apply the earlier foundation migrations, then retry `0032`.
- **When to STOP and report:** any table missing after a second cache reload; any
  `rls_enabled = false`; any UPDATE/DELETE policy on an append-only table; any
  DELETE policy in the set; any missing unique `legacy_id` key. Report which table
  and which check failed; do **not** proceed to flag enablement.
- **No-go criteria (do NOT enable `TIME_REPORTING_DUAL_WRITE`):** the TR3 probe is
  not fully green; OR any TR4 invariant fails; OR any flag in TR0 step 1 was changed.

## TR6. Exit criteria

The `0032` apply-and-verify is **DONE** when **all** of the following hold:

1. `0032_time_reporting_tables.sql` applied with no SQL error.
2. TR3 nine-table REST probe returns `200` for **all nine** tables.
3. (Recommended) TR4 confirms: 9 tables exist, RLS `true` everywhere, unique
   `legacy_id` keys present, append-only tables have no UPDATE/DELETE policy, and no
   DELETE policy anywhere in the set. At minimum the TR3 probe must pass.
4. **No feature flags were changed** — the TR0 step 1 locked state is intact.
5. No rebuild/redeploy performed; no checkout tests run; no application data
   inserted/updated/deleted.

When all criteria hold, the migration gate is satisfied and the project is **ready
for a separate, explicitly-approved step** to enable **only**
`EXPO_PUBLIC_TIME_REPORTING_DUAL_WRITE=true` (followed by rebuild/redeploy and the
controlled checkout validation set). That enablement is **out of scope** for this
runbook block.

---

# Controlled `TIME_REPORTING_DUAL_WRITE` Checkout Validation Script (A / B / C / Retry)

> **This is a HUMAN-OPERATOR validation. The Rork agent cannot execute it.** Three
> hard constraints make this operator-only:
>
> 1. **Checkout requires an authenticated, deployed-app session.** A Time Reporting
>    mirror fires from exactly one place — `AppContext.submitTimeReportCheckout` →
>    `if (shouldMirrorTimeReportingCheckout()) void mirrorTimeReportingCheckout(...)`.
>    That is a logged-in UI action against a real work order / service row; it cannot
>    be triggered headlessly.
> 2. **Cutover telemetry is browser-session, in-memory.** `getTimeReportingCutoverState()`
>    (`attempted / succeeded / failed / skippedMissingCompany`) lives in the running
>    tab's memory and is surfaced only in **Development Center → Time Reporting Parity
>    Diagnostics**. It is not persisted or remotely readable.
> 3. **Anon Supabase access cannot verify RLS-protected written rows.** The anon REST
>    probe only proves a table exists (`200 []`); it can never read company-scoped
>    rows. Row-level confirmation requires either the in-app diagnostics panel or
>    privileged SQL run by the operator.
>
> The agent's role is limited to documenting this script. **All steps below are
> performed by a human operator.**

## TRV0. Preconditions (confirm before any checkout)

1. **Deployed flag state** (the controlled enablement, already accepted as deployed):
   - `EXPO_PUBLIC_TIME_REPORTING_DUAL_WRITE = true` — **deployed**
   - `TIME_REPORTING_SHADOW_VALIDATE = false`
   - `TIME_REPORTING_SUPABASE_READ = false`
   - `TIME_REPORTING_SUPABASE_AUTHORITATIVE = false`
   - `MISSION_LOG_SUPABASE_READ = false`
   - `MISSION_LOG_SUPABASE_AUTHORITATIVE = false`
   - `EXPO_PUBLIC_MISSION_LOG_DUAL_WRITE = true` (already-validated; may remain ON)
2. **`0032` schema gate passed** — the TR3 nine-table probe returned `200 []` for all
   nine tables on the deployed dev/demo project (`swqcdcpwofdnmoureifu`).
3. **Diagnostics available** — log into the deployed app and confirm **Development
   Center → Time Reporting Parity Diagnostics** loads and shows the cutover counters.
4. **Use disposable test data** — one throwaway test customer / work order / service
   row, ideally in a test company you can clean up. Do not validate against real
   production records.
5. **No flag changes during validation.** Shadow validation, reads and authoritative
   mode stay OFF for the entire script.

## TRV1. Baseline (before any checkout)

1. Open **Development Center → Time Reporting Parity Diagnostics**.
2. Record the cutover counters **before** running any checkout:
   - `attempted` = ____
   - `succeeded` = ____
   - `failed` = ____
   - `skippedMissingCompany` = ____
3. Note the **Parity Runner** state — it must read empty/idle, because
   `TIME_REPORTING_SHADOW_VALIDATE = false` means no parity comparison runs.

> All deltas in the following sections are measured **relative to this baseline**.

## TRV2. Checkout A — auto-approved, no deviation

**Action:** complete one checkout for the test service row that is **auto-approved**
with **no deviation** (actual matches scheduled).

**Expected telemetry delta (vs. baseline):**
- `attempted` **+1**
- `succeeded` **+1**
- `failed` **+0**
- `skippedMissingCompany` **+0**

**Expected table effects:**
- `time_reports`: **1** mirrored report for this checkout's `legacy_id`.
- `time_allocations`: scheduled allocation present.
- `time_report_events`: one `submitted` event present.
- `time_report_flags`: **none**.
- `time_report_messages`: **none**.

## TRV3. Checkout B — deviation requiring review, no comment

**Action:** complete one checkout that produces a **deviation requiring review**,
with **no comment** entered.

**Expected telemetry delta (vs. running total):**
- `attempted` **+1**
- `succeeded` **+1**
- `failed` **+0**
- `skippedMissingCompany` **+0**

**Expected table effects:**
- `time_reports`: mirrored report present.
- `time_allocations`: scheduled allocation present; **non-zero deviation allocation**
  present if the deviation produces one.
- `time_report_events`: one `submitted` event present.
- `time_report_flags`: **one open flag**.
- `time_report_flag_events`: one `flag_opened` event present.
- `time_report_messages`: **none** (no comment).

## TRV4. Checkout C — deviation requiring review, with comment

**Action:** complete one checkout that produces a **deviation requiring review** and
**enter a comment** during checkout.

**Expected telemetry delta (vs. running total):**
- `attempted` **+1**
- `succeeded` **+1**
- `failed` **+0**
- `skippedMissingCompany` **+0**

**Expected table effects:**
- `time_reports`: mirrored report present.
- `time_allocations`: scheduled allocation present; **non-zero deviation allocation**
  present if applicable.
- `time_report_events`: one `submitted` event present.
- `time_report_flags`: **one open flag**.
- `time_report_flag_events`: one `flag_opened` event present.
- `time_report_messages`: **one** sanitized/linked message for the comment.

## TRV5. Retry / idempotency check

**Action:** perform one **safe retry** of a single controlled case — either re-run a
checkout that resolves to the **same deterministic `legacy_id`**, or trigger an
equivalent safe re-mirror of one of the cases above.

**Expected telemetry delta:**
- `attempted` **+1** (the retry is a fresh mirror attempt)
- `succeeded` **+1** (idempotent upsert converges, not a hard failure)
- `failed` **+0**
- `skippedMissingCompany` **+0**

**Expected idempotent table behavior (the key check):**
- `time_reports`: **no duplicate** for the same `legacy_id` — the existing row is
  upserted in place (the unique `legacy_id` key from `0032` enforces this).
- `time_allocations` / `time_report_flags`: **no duplicate** mutable rows beyond the
  single converged row per `legacy_id`.
- `time_report_events` / `time_report_flag_events` / `time_report_messages`:
  append-only tables converge on their deterministic `legacy_id` keys — **no
  duplicate** event/message rows for an identical retry.
- Mirror telemetry shows **no unexpected `failed`** increments.

## TRV6. Pass / fail criteria

The controlled checkout validation **PASSES** when **all** of the following hold
across A → B → C → retry:

- `attempted` incremented **exactly once per checkout** (A,B,C,retry → **+4** total).
- `succeeded` incremented **exactly once per successful mirror** (**+4** total).
- `failed` remained **0** for the entire run.
- `skippedMissingCompany` remained **0** (every checkout had a resolvable company).
- **No PGRST errors** surfaced (no `PGRST205` / schema-cache or RLS errors).
- **Legacy checkout remained successful** in every case — the mirror is fire-and-
  forget and must never break the legacy flow.
- **Parity Runner remained empty/idle** — expected, because
  `TIME_REPORTING_SHADOW_VALIDATE = false` means no parity comparison runs.
- No duplicate `time_reports` / allocations / events / flags / messages beyond the
  documented idempotent convergence.

**FAIL / STOP if any of:** `failed` > 0; `skippedMissingCompany` > 0; any PGRST
error; a legacy checkout failed; any duplicate row for an identical `legacy_id`; or
any flag changed during the run. On failure, **STOP** — do not mark dual-write
validated and do not proceed toward shadow validation.

## TRV7. Operator report template

Fill in and return:

```
TIME_REPORTING_DUAL_WRITE — controlled checkout validation

Baseline telemetry (before any checkout):
  attempted=__  succeeded=__  failed=__  skippedMissingCompany=__

After Checkout A (auto-approved, no deviation):
  attempted=__  succeeded=__  failed=__  skippedMissingCompany=__
  tables: time_reports=__  time_allocations=__  events=__  flags=__  messages=__

After Checkout B (deviation, no comment):
  attempted=__  succeeded=__  failed=__  skippedMissingCompany=__
  tables: report=__  scheduled+deviation alloc=__  events=__  open flags=__  flag_opened=__  messages=__

After Checkout C (deviation, with comment):
  attempted=__  succeeded=__  failed=__  skippedMissingCompany=__
  tables: report=__  scheduled+deviation alloc=__  events=__  open flags=__  flag_opened=__  messages=1

After Retry/idempotency check:
  attempted=__  succeeded=__  failed=__  skippedMissingCompany=__
  duplicates observed? (y/n): __   which table(s): __

Visible errors (console / UI / PGRST): __
Legacy checkout succeeded every time? (y/n): __
Parity Runner empty (SHADOW_VALIDATE=false)? (y/n): __

Optional privileged SQL counts (run in SQL Editor, if available):
  select count(*) from time_reports where legacy_id in (<test ids>);
  select count(*) from time_allocations where time_report_id in (<test report ids>);
  select count(*) from time_report_events where time_report_id in (<test report ids>);
  select count(*) from time_report_flags where time_report_id in (<test report ids>);
  select count(*) from time_report_messages where time_report_id in (<test report ids>);

Final observed result: PASS / FAIL
```

On **PASS**, the next (separate) step is to update **Development Center → System
Timeline** to mark Time Reporting dual-write **validated** — and only after that is a
further, explicitly-approved step considered for enabling
`TIME_REPORTING_SHADOW_VALIDATE`. Both are **out of scope** for this script.
