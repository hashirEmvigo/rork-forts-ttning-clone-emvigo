# CleanOps — Tenant Test-Data Reset Runbook (company hard-delete)

> **Status:** OPERATIONAL RUNBOOK. This document describes the validated,
> repeatable procedure for fully removing a single company (tenant) and all of
> its company-scoped data from the live Supabase project. It was derived from the
> real, verified reset of **Städalliansen Sverige AB**.
>
> **Execution channel:** Supabase Dashboard → SQL Editor (privileged role).
> Nothing here is executed by the agent. The operator runs each block manually.
>
> **Scope:** test/demo tenant cleanup. This is a destructive procedure. Treat it
> with the same care as a production deletion.
>
> **⚠️ No staging environment.** We do **not** currently have a separate staging
> environment. The online app is used as a shared development/demo environment
> that runs against the live Supabase project. There is no isolated place to
> rehearse destructive SQL. Every block below is therefore treated as
> production-impacting and run with full care, one execution at a time.

---

## 0. When to use this

Use this runbook when you need to **completely remove one company tenant** and
all data that belongs to it (customers, work orders, mission log, time
reporting, profiles, and the company row itself), optionally followed by the
removal of the now-orphaned `auth.users` rows for that tenant's users.

Do **not** use this for:

- Soft-delete / archival (use the app's archive flow).
- Removing a single user (use the admin delete-user path).
- Deleting platform-wide / super_admin data.

---

## 0.1 Two execution paths (current vs future)

There are two ways tenant deletion is described in this codebase. Only **one** of
them is real today.

### Path 1 — Current / manual production-safe path (the ONLY validated path right now)

This is the procedure in **§4 below**, and it is the only path that is
operational and validated. It is what you must use for any real tenant deletion
today. Characteristics:

- Runs against the live Supabase project via the SQL Editor (privileged role).
- Uses **separate SQL executions** — one phase per run, never pasted together.
- Uses **SELECT-only verification** steps (Phases A, C, D, F).
- **Public-schema deletion first** (Phases A–C), proven before anything else.
- **Separate `auth.users` orphan inspection and cleanup** (Phases D–F),
  optional and only after the public schema is verified.
- **No mixed `BEGIN` / `COMMIT` / `ROLLBACK`** scripts in the Supabase SQL
  Editor (see §3).

### Path 2 — Future / proposed routine path (NOT active yet)

A proposed `delete_company_tenant(...)` routine is drafted but **not available**.
It is documented in
`50-tenant-deletion-schema-hardening-proposal.md` and drafted as an **unapplied**
file at `proposed-migrations/0034_tenant_deletion_routine.sql.proposed`.

This path:

- Would use a single `delete_company_tenant(...)` routine for the ordered
  public-schema deletion.
- Is **not active**, and is **not available until the proposed migration is
  promoted and applied**.
- Must first be validated in **either a real staging environment, or a
  controlled dev/demo (pre-production) validation plan** — we have neither yet.
- Must **not be promoted to an active migration** until we have either a real
  staging environment or a controlled pre-production validation plan.
- Even once active, would still **exclude `auth.users`** entirely.
- Would still require a **separate `auth.users` orphan inspection and optional
  cleanup** (Phases D–F semantics).
- Would still require **protected super_admin verification**.
- Would still require **post-delete SELECT-only verification**.

> The proposed migration remains **unapplied until explicitly approved**.

### ⚠️ Explicit warning

**We do not currently have staging.** Therefore:

- Do **not** move `0034_tenant_deletion_routine.sql.proposed` into
  `supabase/migrations/`.
- Do **not** apply it.
- Do **not** treat the routine path (Path 2) as operational yet.

Until a real staging environment or a controlled pre-production validation plan
exists, **Path 1 (§4) is the only path you may use.**

---

## 1. Inputs (the only two parameters)

Every step is parameterised by exactly two hard-coded values. Capture them once,
up front, and reuse them verbatim in every block.

| Input | Example | Where it comes from |
| --- | --- | --- |
| `company_id` (uuid) | `26bd8f84-c057-428f-b41e-8ee0de4c8455` | `public.companies.id` |
| `company_legacy_id` (text) | `cmp_9ovsofaxha` | `public.companies.legacy_id` |

**Protected super_admin** must also be identified and recorded before anything
runs:

| Protected account | Example |
| --- | --- |
| email | `sebastian@stadalliansen.se` |
| has `company_id = NULL` | yes (super_admin) |

> The protected super_admin must **never** appear in any company-scoped DELETE
> (super_admin has `company_id = NULL`, so a `company_id = <target>` filter can
> never match him) and must **never** appear in the auth allowlist.

---

## 2. Schema facts that drive the ordering (read once)

These facts are why the procedure is ordered the way it is. They are grounded in
the migrations, not assumptions.

- **Most company-scoped tables are `ON DELETE CASCADE`** from `companies(id)`
  (`customers` → migration `0007`; `mission_log_*` → `0031`; time reporting
  tables → `0032`; etc.). Deleting the company row *would* cascade these.
- **`profiles.company_id` is `ON DELETE SET NULL`**, not `CASCADE`
  (`0003`, line 34). Deleting the company row does **not** delete its profiles —
  it tries to NULL their `company_id`.
- **`profiles_company_required_check`** (`0003`) forces every non-super_admin to
  have a non-null `company_id`. So a bare "delete the company and let FKs sort it
  out" approach will either (a) leave detached profiles, or (b) abort on the
  CHECK. **Therefore profiles must be deleted explicitly, before the company
  row.**
- **`profiles.id references auth.users(id) ON DELETE CASCADE`** (`0003`). Deleting
  an `auth.users` row removes its profile. The reverse is not true — deleting a
  profile does not touch `auth.users`. This is why orphaned `auth.users` rows
  remain after a public-schema reset and need a separate, optional cleanup.
- **`trg_on_auth_user_created` is `AFTER INSERT` only** (`0004`). It never fires
  on delete, so deletions cannot re-provision rows.

### Explicit deletion order (do not reorder)

Because `profiles` does not cascade and is CHECK-guarded, delete children before
parents in this exact order:

1. `mission_log_entries`
2. `work_order_service_rows`
3. `work_orders`
4. `customers`
5. other company-scoped tables (`employees`, `time_reports`,
   `time_allocations`, `customer_agreements`, `time_bank_wallets`,
   `payroll_export_profiles`, and any newer company-scoped tables)
6. `profiles` (scoped by `company_id` **only** — there is no
   `profiles.company_legacy_id` column)
7. `companies`

> Although most child tables cascade from `companies`, deleting them explicitly
> first keeps the row counts auditable at each phase and avoids relying on
> cascade behaviour that may differ per table.

---

## 3. The operator lesson that almost cost us the reset

**Do not mix `BEGIN` / `COMMIT` / `ROLLBACK` in the same Supabase SQL Editor
script — not even one of them commented out.**

What happened during the Städalliansen reset: a destructive script wrapped in an
explicit transaction reported `POST = 0` for every target table — but the change
**did not persist**. A later SELECT-only check found the company row, 43
customers, 11 work orders, and all 8 profiles still present. The in-transaction
counts were real, but the editor's interaction with explicit transaction control
meant the work was effectively rolled back.

**Rules that prevent this class of error:**

1. Each destructive script is **a single statement sequence with no explicit
   transaction keywords**. Let the SQL Editor auto-commit the run.
2. **Never** put both `COMMIT;` and `ROLLBACK;` in the same script, even
   commented. Ambiguity here is operator risk.
3. **Verification is always a separate SELECT-only script**, run *after* the
   destructive script, in its own execution. Never trust in-transaction POST
   counts as proof of persistence.
4. Dry-run by **reading counts first** (Phase A), not by wrapping a destructive
   script in `ROLLBACK`.

---

## 4. Procedure (Path 1 — current / manual production-safe path)

This is the **only validated, operational path**. Run the phases strictly in
order. Each phase is its own SQL Editor execution. Do not paste two phases
together. (The future routine path — Path 2 — is not available; see §0.1.)

### Phase A — SELECT-only dry-run (pre-counts)

Confirm the target exists and capture what *should* go to zero. No writes.

```sql
-- Phase A: SELECT-only dry-run. Substitute the two inputs.
-- Confirms target existence and pre-delete counts. NO writes.
with target as (
  select
    '26bd8f84-c057-428f-b41e-8ee0de4c8455'::uuid as company_id,
    'cmp_9ovsofaxha'::text                        as company_legacy_id
)
select '0_company_by_id'        as check_name, count(*) as result
  from public.companies c, target t where c.id = t.company_id
union all
select '0_company_by_legacy_id', count(*)
  from public.companies c, target t where c.legacy_id = t.company_legacy_id
union all
select '1_mission_log_entries',  count(*)
  from public.mission_log_entries x, target t where x.company_id = t.company_id
union all
select '2_work_order_service_rows', count(*)
  from public.work_order_service_rows x, target t where x.company_id = t.company_id
union all
select '3_work_orders',          count(*)
  from public.work_orders x, target t where x.company_id = t.company_id
union all
select '4_customers',            count(*)
  from public.customers x, target t where x.company_id = t.company_id
union all
select '5_employees',            count(*)
  from public.employees x, target t where x.company_id = t.company_id
union all
select '6_time_reports',         count(*)
  from public.time_reports x, target t where x.company_id = t.company_id
union all
select '7_time_allocations',     count(*)
  from public.time_allocations x, target t where x.company_id = t.company_id
union all
select '8_customer_agreements',  count(*)
  from public.customer_agreements x, target t where x.company_id = t.company_id
union all
select '9_time_bank_wallets',    count(*)
  from public.time_bank_wallets x, target t where x.company_id = t.company_id
union all
select '10_payroll_export_profiles', count(*)
  from public.payroll_export_profiles x, target t where x.company_id = t.company_id
union all
select '11_profiles',            count(*)
  from public.profiles x, target t where x.company_id = t.company_id
order by check_name;
```

**Proceed only if** `0_company_by_id = 1` and `0_company_by_legacy_id = 1` (you
are targeting a real, single company). Record the other counts; they are your
expected "before" baseline.

> If a newer company-scoped table has been added since this runbook was written,
> add it to Phase A, the delete script (Phase B, step 5), and Phase C. Keep all
> three in sync.

### Phase B — Public-schema hard delete (COMMIT-only, no transaction keywords)

One script, no `BEGIN`/`COMMIT`/`ROLLBACK`. Deletes in the mandatory order.

```sql
-- Phase B: PUBLIC-SCHEMA HARD DELETE. Destructive. No transaction keywords.
-- Substitute the two inputs. Ordering is mandatory (children → parents).

-- 1. mission_log_entries
delete from public.mission_log_entries
  where company_id = '26bd8f84-c057-428f-b41e-8ee0de4c8455';

-- 2. work_order_service_rows
delete from public.work_order_service_rows
  where company_id = '26bd8f84-c057-428f-b41e-8ee0de4c8455';

-- 3. work_orders
delete from public.work_orders
  where company_id = '26bd8f84-c057-428f-b41e-8ee0de4c8455';

-- 4. customers
delete from public.customers
  where company_id = '26bd8f84-c057-428f-b41e-8ee0de4c8455';

-- 5. other company-scoped tables
delete from public.employees
  where company_id = '26bd8f84-c057-428f-b41e-8ee0de4c8455';
delete from public.time_reports
  where company_id = '26bd8f84-c057-428f-b41e-8ee0de4c8455';
delete from public.time_allocations
  where company_id = '26bd8f84-c057-428f-b41e-8ee0de4c8455';
delete from public.customer_agreements
  where company_id = '26bd8f84-c057-428f-b41e-8ee0de4c8455';
delete from public.time_bank_wallets
  where company_id = '26bd8f84-c057-428f-b41e-8ee0de4c8455';
delete from public.payroll_export_profiles
  where company_id = '26bd8f84-c057-428f-b41e-8ee0de4c8455';

-- 6. profiles — scoped by company_id ONLY (no profiles.company_legacy_id column).
--    Must run BEFORE deleting the company row, because profiles.company_id is
--    ON DELETE SET NULL + profiles_company_required_check would otherwise leave
--    detached profiles or abort the company delete.
--    The protected super_admin has company_id = NULL and can never match here.
delete from public.profiles
  where company_id = '26bd8f84-c057-428f-b41e-8ee0de4c8455';

-- 7. companies — the parent row, by BOTH id and legacy_id for precision.
delete from public.companies
  where id = '26bd8f84-c057-428f-b41e-8ee0de4c8455'
    and legacy_id = 'cmp_9ovsofaxha';
```

After running, do **not** read the result of this run as proof. Move to Phase C.

### Phase C — SELECT-only post-verification (separate execution)

This is the proof of persistence. Run it as its own script.

```sql
-- Phase C: SELECT-only post-verification. Run AFTER Phase B, separately.
with target as (
  select
    '26bd8f84-c057-428f-b41e-8ee0de4c8455'::uuid as company_id,
    'cmp_9ovsofaxha'::text                        as company_legacy_id,
    'sebastian@stadalliansen.se'::text            as protected_email
)
select '1_company_by_id'        as check_name, count(*) as result
  from public.companies c, target t where c.id = t.company_id            -- expect 0
union all
select '2_company_by_legacy_id', count(*)
  from public.companies c, target t where c.legacy_id = t.company_legacy_id -- expect 0
union all
select '3_profiles_pointing_at_company', count(*)
  from public.profiles p, target t where p.company_id = t.company_id     -- expect 0
union all
select '4_customers', count(*)
  from public.customers x, target t where x.company_id = t.company_id    -- expect 0
union all
select '5_work_orders', count(*)
  from public.work_orders x, target t where x.company_id = t.company_id  -- expect 0
union all
select '6_work_order_service_rows', count(*)
  from public.work_order_service_rows x, target t where x.company_id = t.company_id -- expect 0
union all
select '7_mission_log_entries', count(*)
  from public.mission_log_entries x, target t where x.company_id = t.company_id -- expect 0
union all
select '8_employees', count(*)
  from public.employees x, target t where x.company_id = t.company_id    -- expect 0
union all
select '9_time_reports', count(*)
  from public.time_reports x, target t where x.company_id = t.company_id -- expect 0
union all
select '10_time_allocations', count(*)
  from public.time_allocations x, target t where x.company_id = t.company_id -- expect 0
union all
select '11_customer_agreements', count(*)
  from public.customer_agreements x, target t where x.company_id = t.company_id -- expect 0
union all
select '12_time_bank_wallets', count(*)
  from public.time_bank_wallets x, target t where x.company_id = t.company_id -- expect 0
union all
select '13_payroll_export_profiles', count(*)
  from public.payroll_export_profiles x, target t where x.company_id = t.company_id -- expect 0
union all
select '14_protected_super_admin', count(*)
  from public.profiles p, target t where p.email = t.protected_email     -- expect 1
order by check_name;
```

**Pass signature:** every company-scoped check `= 0`, both company lookups
`= 0`, `14_protected_super_admin = 1`.

> If `1_company_by_id` or any data table is **non-zero**, the destructive run did
> not persist (the transaction-keyword trap from §3). Re-run Phase B as a clean
> no-transaction script, then Phase C again. Do **not** proceed to auth cleanup
> until Phase C passes.

### Phase D — SELECT-only auth orphan inspection (optional path begins)

Only after Phase C passes. Identify the `auth.users` rows whose profiles are now
gone. This builds the allowlist for Phase E — it does **not** delete anything.

```sql
-- Phase D: SELECT-only. Confirm the tenant's auth.users rows are now true
-- orphans (their profiles are gone) before any deletion. Hard-coded id list.
with candidate_ids as (
  select unnest(array[
    -- the tenant's auth.users ids (NOT the protected super_admin)
    '30bf0363-b6f3-44a3-807d-c4f245f908ae',
    'c9b6699b-8ae9-4b1d-ae1c-7db0eabbc528',
    'a4ad0c1a-ac06-4886-a30b-64fd4a943a66',
    'd11b8a79-a319-445f-9f5b-6461d0c367de',
    '7a025820-3f92-4dba-a62b-1f39b50f12a0',
    '098da0ef-8bfc-4dab-ab54-5203ff88a570',
    'df566b96-2687-4c51-9da7-f0f37873794a',
    'f2aaa80a-1a5b-4f40-82ef-32b16cea35c7'
  ]::uuid[]) as id
)
select
  u.id,
  u.email,
  u.created_at,
  u.last_sign_in_at,
  not exists (select 1 from public.profiles p where p.id = u.id) as profile_is_deleted,
  (u.email = 'sebastian@stadalliansen.se')                       as is_protected_super_admin
from auth.users u
join candidate_ids c on c.id = u.id
order by u.created_at;
```

**Pass criteria (all must hold) before Phase E:**

- Row count ≤ number of ids in the allowlist.
- `profile_is_deleted = true` for **every** row.
- `is_protected_super_admin = false` for **every** row.
- The protected super_admin email is **absent** from the result entirely.

If any row fails, **stop** and investigate. Do not edit the allowlist to force a
pass.

### Phase E — Auth orphan cleanup (optional, COMMIT-only, no transaction keywords)

Only run if Phase D passed all criteria. Hard-coded allowlist, `NOT EXISTS`
guard against `public.profiles`, explicit super_admin exclusion. No email-pattern
deletion. No transaction keywords.

```sql
-- Phase E: AUTH ORPHAN CLEANUP. Destructive. No transaction keywords.
-- Deletes ONLY ids in the explicit allowlist, ONLY if they have no profile,
-- and NEVER the protected super_admin.
delete from auth.users u
where u.id in (
    '30bf0363-b6f3-44a3-807d-c4f245f908ae',
    'c9b6699b-8ae9-4b1d-ae1c-7db0eabbc528',
    'a4ad0c1a-ac06-4886-a30b-64fd4a943a66',
    'd11b8a79-a319-445f-9f5b-6461d0c367de',
    '7a025820-3f92-4dba-a62b-1f39b50f12a0',
    '098da0ef-8bfc-4dab-ab54-5203ff88a570',
    'df566b96-2687-4c51-9da7-f0f37873794a',
    'f2aaa80a-1a5b-4f40-82ef-32b16cea35c7'
  )
  and not exists (select 1 from public.profiles p where p.id = u.id)
  and u.email <> 'sebastian@stadalliansen.se';
```

### Phase F — SELECT-only auth post-verification (separate execution)

```sql
-- Phase F: SELECT-only auth post-verification. Run AFTER Phase E, separately.
select '1_target_auth_users_remaining' as check_name, count(*) as result, 'expect 0' as note
  from auth.users u
  where u.id in (
    '30bf0363-b6f3-44a3-807d-c4f245f908ae',
    'c9b6699b-8ae9-4b1d-ae1c-7db0eabbc528',
    'a4ad0c1a-ac06-4886-a30b-64fd4a943a66',
    'd11b8a79-a319-445f-9f5b-6461d0c367de',
    '7a025820-3f92-4dba-a62b-1f39b50f12a0',
    '098da0ef-8bfc-4dab-ab54-5203ff88a570',
    'df566b96-2687-4c51-9da7-f0f37873794a',
    'f2aaa80a-1a5b-4f40-82ef-32b16cea35c7'
  )
union all
select '2_target_profiles_remaining', count(*), 'expect 0'
  from public.profiles p
  where p.company_id = '26bd8f84-c057-428f-b41e-8ee0de4c8455'
union all
select '3_protected_super_admin_auth_row', count(*), 'expect 1'
  from auth.users u where u.email = 'sebastian@stadalliansen.se'
union all
select '4_protected_super_admin_profile', count(*), 'expect 1'
  from public.profiles p
  where p.id = (select id from auth.users where email = 'sebastian@stadalliansen.se')
order by check_name;
```

**Pass signature:** `1 = 0`, `2 = 0`, `3 = 1`, `4 = 1`.

---

## 5. Hard rules (summary)

- Two inputs only: `company_id`, `company_legacy_id`. Hard-code them everywhere.
- SELECT-only dry-run (Phase A) **before** any delete.
- Delete in the mandatory order: mission log → service rows → work orders →
  customers → other company-scoped tables → profiles → companies.
- `profiles` is scoped by `company_id` only (no `company_legacy_id` column) and
  must be deleted **before** the company row.
- Destructive scripts contain **no** `BEGIN` / `COMMIT` / `ROLLBACK` — let the
  editor auto-commit; never mix commit and rollback in one script.
- Verification is always a **separate** SELECT-only execution. Never trust
  in-transaction POST counts.
- Auth cleanup is **optional** and only after public-schema Phase C passes.
- Auth cleanup uses a **hard-coded id allowlist** + `NOT EXISTS` against
  `public.profiles` + explicit super_admin email exclusion. **Never** delete
  `auth.users` by email pattern.
- The protected super_admin must be checked in every verification phase and must
  never appear in any company-scoped delete or auth allowlist.
- If a new company-scoped table is added later, update Phases A, B(step 5), and C
  together.
- **No staging exists.** Use only Path 1 (§4). Do not promote, move, or apply
  `0034_tenant_deletion_routine.sql.proposed`; the routine path (Path 2) is not
  operational until a real staging environment or a controlled pre-production
  validation plan exists and the migration is explicitly approved.

---

## 6. Validated reference run — Städalliansen Sverige AB

- `company_id = 26bd8f84-c057-428f-b41e-8ee0de4c8455`,
  `company_legacy_id = cmp_9ovsofaxha`.
- Public-schema reset: company row, legacy id, and all company-scoped data
  (customers, work orders, service rows, mission log, profiles) removed and
  verified by Phase C (all `0`, super_admin `1`).
- Auth: 8 orphaned test `auth.users` rows removed via Phase E; Phase F confirmed
  `1=0, 2=0, 3=1, 4=1`.
- Protected super_admin `sebastian@stadalliansen.se` intact in both `auth.users`
  and `public.profiles`.
- Root cause of the earlier "non-persisted commit": explicit transaction
  keywords in the SQL Editor (see §3). The fix that made this repeatable was
  splitting destructive and verification work into separate, keyword-free
  executions.
