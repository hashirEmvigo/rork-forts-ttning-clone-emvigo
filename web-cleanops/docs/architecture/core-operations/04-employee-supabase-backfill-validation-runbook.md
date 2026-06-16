# CleanOps — Employee Supabase Backfill + Validation Runbook (EMP-4)

> **Status:** CONTROLLED-ENABLEMENT RUNBOOK. Manual, step-by-step package for
> safely backfilling the Supabase `employees` table from localStorage, validating
> parity, and then enabling the EMP-4 write mirror + shadow validation in a
> controlled **dev/demo** environment.
>
> **Why this is urgent:** the Employees READ path is already Supabase-primary
> (`EMPLOYEES_SUPABASE_READ` resolves ON in real app builds) while employee
> WRITES still only hit localStorage. If Supabase holds a partial/stale employee
> dataset, the directory can reconcile to it and a create/edit/archive/delete can
> appear lost after refresh. This runbook closes that gap by backfilling Supabase,
> proving parity, then turning the write mirror on.
>
> **This is NOT a write-authority cut-over.** localStorage stays the single
> authoritative write target throughout. No `*_SUPABASE_AUTHORITATIVE` employee
> flag is enabled. `EMPLOYEES_SUPABASE_READ` is **not changed** by this runbook.
> No Employee Detail Page, no UI/route changes, no schema migrations, no linked
> login/User/auth changes. No destructive SQL.
>
> **Environment:** shared online dev/demo only. Use disposable test employees —
> never risk real personnel data.
>
> This runbook follows `02-data-authority-and-test-data-policy.md`: Supabase is the
> target authority; local-only data is a migration/readiness defect; cleanup must
> use controlled readiness/soft-delete flows.

---

## 0. Architecture recap (verified)

- **Employees schema** — migration **`0010_employees_table.sql`**. Flat indexed
  columns (`legacy_id` unique, `company_id` UUID FK, `company_legacy_id`, `name`,
  `email`, `title`, `status` ∈ {`active`,`inactive`}, `team_ids text[]`,
  `user_legacy_id`, `postal_city_id`, `language_id`) + lossless `data jsonb` +
  soft-delete `deleted_at` (null = active). RLS is company-scoped; there is **no
  hard-DELETE policy** — removal is a `deleted_at` UPDATE.
- **Backfill / shadow tools** — `migrateEmployees({ companyId?, dryRun? })` and
  `shadowReadEmployees(companyId?)` in `src/lib/data/employeeMigration.ts`.
  Both READ-ONLY against localStorage; the migration upserts on `legacy_id`
  (idempotent, repeatable, chunked at 200). `dryRun` computes the plan + report
  without writing. Company UUID resolution via `loadCompanyUuidMap()`.
- **Write mirror (EMP-4)** — `mirrorEmployeeWrites(prev, next, { shadowValidate })`
  in `src/lib/data/employeeDualWrite.ts`, fired fire-and-forget from
  `persistEmployees` (AppContext) only when `EMPLOYEES_DUAL_WRITE` is on. Upsert
  on `legacy_id`, soft-delete removal propagation, post-write field validation
  (`legacy_id`, `company_legacy_id`, `name`, `email`, `status` — no PII free
  text), optional deep `shadowReadEmployees` pass when `EMPLOYEES_SHADOW_VALIDATE`
  is on. Never throws; localStorage write always completes first.
- **Telemetry** — `getEmployeeDualWriteState()` (write-mirror counters + a
  50-capped recent-mismatch ring) and `getEmployeeCutoverState()` (read-path +
  shadow-drift counters). Both in `src/lib/data/employee{DualWrite,Cutover}.ts`.
- **Flags** — `EXPO_PUBLIC_EMPLOYEES_DUAL_WRITE` and
  `EXPO_PUBLIC_EMPLOYEES_SHADOW_VALIDATE`: plain `EXPO_PUBLIC_*` booleans,
  `envFlag(...) || false`, **DEFAULT OFF** in committed code. Only the literal
  string `"true"` turns them on. `EXPO_PUBLIC_EMPLOYEES_SUPABASE_READ` is
  **untouched** by this runbook.

> **Execution-surface caveat (read before starting).** The console helpers
> (`migrateEmployees`, `shadowReadEmployees`, `getEmployeeDualWriteState`,
> `getEmployeeCutoverState`, …) are attached to `window.__cleanopsData` **only
> when `import.meta.env.DEV === true`** — i.e. under the Vite dev server
> (`bun run dev`), **not** in a `bun run build` deployed bundle. Run the
> **backfill steps (1–3) from a `bun run dev` session pointed at the same
> dev/demo Supabase project**, then do the env-flag rebuild for steps 4–5.
> SQL preflight (Section 1) runs in the Supabase SQL editor regardless. See
> Section F for the helper-exposure finding.

---

## 1. Preflight inspection (read-only)

Goal: map companies, count both sides, and classify each company as
**in-sync / missing / stale / partial** before writing anything.

### 1a. List companies + map legacy id → Supabase UUID

Supabase SQL editor (read-only):

```sql
-- Company id map (app-facing legacy_id → Supabase UUID).
select legacy_id, id as company_uuid, name
from companies
order by legacy_id;
```

In a `bun run dev` browser console this is also available as the same map the
tools use:

```js
// Resolve the legacy_id → UUID map exactly as the backfill does.
await import("/src/lib/data/customerMigration.ts").then(m => m.loadCompanyUuidMap());
// → Map { "cmp_nordlys" => "…uuid…", … }
```

> Any company present locally but **absent** from this map cannot be backfilled
> (RLS would reject the write). `migrateEmployees` reports those under `skipped`.

### 1b. Count localStorage employees per company

`bun run dev` browser console:

```js
const { getEmployees } = await import("/src/lib/store.ts");
const byCompany = {};
for (const e of getEmployees()) byCompany[e.companyId] = (byCompany[e.companyId] ?? 0) + 1;
console.table(byCompany);
console.log("local total:", getEmployees().length);
```

### 1c. Count Supabase employees per company (active only)

Supabase SQL editor:

```sql
-- Active (non-soft-deleted) Supabase employees per company.
select company_legacy_id, count(*) as supabase_active
from employees
where deleted_at is null
group by company_legacy_id
order by company_legacy_id;
```

```sql
-- Include soft-deleted rows so you can see the full picture.
select company_legacy_id,
       count(*) filter (where deleted_at is null)     as active,
       count(*) filter (where deleted_at is not null)  as soft_deleted,
       count(*)                                        as total
from employees
group by company_legacy_id
order by company_legacy_id;
```

### 1d. Detect missing / extra / partial per company (authoritative diff)

Run the shadow comparator per company — this is the single source of truth for
classification:

```js
const { shadowReadEmployees } = window.__cleanopsData;
const ids = ["cmp_nordlys", "cmp_demo" /* …from step 1a… */];
for (const id of ids) {
  const r = await shadowReadEmployees(id);
  console.log(id, {
    ok: r.ok,
    local: r.localCount,
    supabase: r.supabaseCount,
    missing: r.missingInSupabase.length,   // local-only → NOT yet backfilled
    extra: r.extraInSupabase.length,       // supabase-only → stale/deleted-locally
    notes: r.notes,
  });
}
```

Classification:

| Condition | Meaning | Action |
|---|---|---|
| `ok: true`, `missing: 0`, `extra: 0` | In-sync | No backfill needed |
| `missing > 0` | Local employees not in Supabase | **Backfill** (Section 2) |
| `extra > 0` | Supabase rows with no local match | **Stale** — investigate before mirror (Section 6) |
| `local > supabase`, partial overlap | Partially backfilled company | **Backfill** then re-validate |
| `supabaseCount: 0` while `localCount > 0` | Company never backfilled | **Backfill** |

> Do not delete `extra` rows. Stale Supabase rows are surfaced for investigation,
> not auto-removed (see Rollback §6).

---

## 2. Backfill execution

> **Run from `bun run dev`** (helpers are DEV-only). `EMPLOYEES_DUAL_WRITE` does
> **not** need to be on to backfill — `migrateEmployees` is a standalone tool.

### 2a. Dry-run first (no writes)

```js
const { migrateEmployees } = window.__cleanopsData;
// Per company, dry-run:
await migrateEmployees({ companyId: "cmp_nordlys", dryRun: true });
```

Inspect the report:

```ts
{
  ok, dryRun: true, companyId,
  sourceCount,       // local employees in scope
  plannedCount,      // rows that WOULD be upserted
  writtenCount: 0,   // always 0 on dry-run
  skipped: [],       // employees whose company has no Supabase row → FIX FIRST
  duplicateEmails: [],// per-company dup emails (surfaced, non-blocking)
  error,
}
```

**Proceed only if:** `skipped.length === 0` and `error` is undefined.
**Stop if:** any `skipped` entry (migrate that company in `companies` first) or
`error` is set.

### 2b. Live backfill — company-by-company (recommended)

Run **one company at a time** so each is independently verifiable and any failure
is isolated:

```js
const r = await migrateEmployees({ companyId: "cmp_nordlys" });
console.log(r);
```

Success report:

```ts
{
  ok: true,
  dryRun: false,
  companyId: "cmp_nordlys",
  sourceCount: N,
  plannedCount: N,
  writtenCount: N,   // === plannedCount
  skipped: [],       // empty
  duplicateEmails: [],
  error: undefined,
}
```

**Proof of success:** `ok === true`, `writtenCount === plannedCount`,
`skipped` empty, `error` undefined. Re-running is safe (idempotent upsert on
`legacy_id`) — `writtenCount` stays equal to the source count, no duplicates.

**Stop conditions:**
- `error` is set (e.g. `Upsert failed at chunk …`) — note `writtenCount` (rows
  before the failing chunk), fix the cause, re-run (idempotent, safe to retry).
- `skipped.length > 0` — a company is missing from Supabase; backfill companies
  first, then re-run.
- `duplicateEmails.length > 0` — surfaced, **non-blocking** for the backfill
  (no DB unique constraint), but resolve duplicates locally before trusting
  email-based lookups.

### 2c. All-at-once (only after several clean per-company runs)

```js
await migrateEmployees(); // all companies, no scope
```

Prefer per-company until you have confidence; the all-companies run is a
convenience, not a requirement.

---

## 3. Post-backfill validation

### 3a. Shadow parity per company

```js
const { shadowReadEmployees } = window.__cleanopsData;
const r = await shadowReadEmployees("cmp_nordlys");
console.log(r);
```

**Expected success:**

```ts
{
  ok: true,
  countMatch: true,
  idsMatch: true,
  summaryMatch: true,
  detailMatch: true,
  missingInSupabase: [],   // length 0
  extraInSupabase: [],     // length 0
  notes: [],               // empty
}
```

Run for every company; **all must be `ok: true`** with `missing` and `extra` both
0 before enabling the mirror.

### 3b. Inspect cutover / dual-write telemetry

```js
window.__cleanopsData.getEmployeeCutoverState();
// supabaseRead, readSource, fallbacks, failures, shadowDrift, unsafeEmptyReads, lastMismatch, recentFailures
window.__cleanopsData.getEmployeeDualWriteState();
// runs, created, updated, removed, mismatches, shadowDrift, failures, lastError, recentMismatches
```

Before the mirror is enabled, `getEmployeeDualWriteState()` should still be at
zeros (`runs: 0`) — the mirror has not run yet. `getEmployeeCutoverState()`
reflects the read path; `unsafeEmptyReads`/`fallbacks` should not be climbing
once Supabase is fully backfilled.

### 3c. Verify the directory no longer drops local-only employees

1. In the dev/demo app, open the Employee directory for a backfilled company.
2. Confirm every local employee now appears (no shrink vs the local count from
   step 1b).
3. `getEmployeeCutoverState().unsafeEmptyReads` and `.fallbacks` are not
   incrementing on refresh (Supabase now has the full set, so no unsafe-empty /
   fallback events).

---

## 4. Dual-write enablement plan

**Only after every company passes Section 3 (`ok: true`, missing 0, extra 0).**

1. Set the env var in the dev/demo environment:

   ```
   EXPO_PUBLIC_EMPLOYEES_DUAL_WRITE=true
   ```

2. **Rebuild / redeploy** the dev/demo build — Vite inlines `import.meta.env.*`
   at **build time**, so a running server will not pick it up:

   ```
   bun run build   # then redeploy the dev/demo bundle
   ```

3. Confirm the flag baked in and the others stayed OFF:
   - `EXPO_PUBLIC_EMPLOYEES_DUAL_WRITE` → present/`true`
   - `EXPO_PUBLIC_EMPLOYEES_SHADOW_VALIDATE` → **absent/OFF**
   - `EXPO_PUBLIC_EMPLOYEES_SUPABASE_READ` → **unchanged**
   - no `*_SUPABASE_AUTHORITATIVE` employee flag set

4. Exercise the write flows against a disposable test employee:
   - **Create** employee → row appears in `employees` (`deleted_at` null).
   - **Edit** optional fields (title, postalCityId, languageId, teamIds) →
     mirrored; empty strings normalized to `null` columns.
   - **Archive** → `status = 'inactive'` + `archivedAt` in `data` jsonb; row is
     **not** soft-deleted.
   - **Delete** → row soft-deleted (`deleted_at` set), not hard-removed.
   - **Retry / repeat save** → no duplicate rows (idempotent on `legacy_id`).

5. Check telemetry:

   ```js
   const s = window.__cleanopsData.getEmployeeDualWriteState();
   // EXPECT: failures === 0, mismatches === 0, lastError === null,
   //         created/updated/removed reflecting the actions, recentMismatches: []
   ```

   > Note: from a `bun run build` deploy the console handle is not attached
   > (DEV-only). To read live telemetry during this step, either run the same
   > flow under `bun run dev` with the flag set, or temporarily surface the
   > state (see Section F finding). SQL verification in `employees` works either
   > way.

   SQL spot-check (read-only):

   ```sql
   select legacy_id, name, status, deleted_at, updated_at
   from employees
   where company_legacy_id = 'cmp_nordlys'
   order by updated_at desc
   limit 20;
   ```

**Proceed to Section 5 only if:** 0 failures, 0 mismatches, no duplicate rows,
soft-delete/archive behaving as specified.

---

## 5. Shadow validation enablement plan

**Only after dual-write looks clean (Section 4).**

1. Set:

   ```
   EXPO_PUBLIC_EMPLOYEES_SHADOW_VALIDATE=true
   ```
   (Keep `EXPO_PUBLIC_EMPLOYEES_DUAL_WRITE=true`.)

2. Rebuild / redeploy (`bun run build` — same reason as Section 4.2).

3. Exercise create/edit/archive/delete again; each mirror now runs the deeper
   company-scoped `shadowReadEmployees` parity pass.

4. Watch drift stay at zero:

   ```js
   window.__cleanopsData.getEmployeeCutoverState().shadowDrift;   // EXPECT 0
   window.__cleanopsData.getEmployeeDualWriteState().mismatches;  // EXPECT 0
   window.__cleanopsData.getEmployeeDualWriteState().shadowDrift; // EXPECT 0
   ```

**Success criteria:** `shadowDrift === 0`, `mismatches === 0`, `failures === 0`,
`lastMismatch === null`, `recentMismatches` empty.

> Do **not** make any further cut-over decision (no authoritative-write flag,
> no read-flag change) from this runbook. EMP-4 ends at "mirror + shadow clean".

---

## 6. Rollback plan

The whole sequence is reversible by env flip — localStorage is always
authoritative, so no data migration is needed to roll back.

| Situation | Action |
|---|---|
| **Backfill reports `skipped`** | Company missing in Supabase. Do nothing destructive; migrate `companies` first, then re-run `migrateEmployees` for that company. |
| **Backfill `error` mid-run** | Idempotent — fix the cause and re-run; the upsert reconciles. No rows are deleted. |
| **Shadow shows `missing > 0`** | Re-run `migrateEmployees({ companyId })` for that company, then re-validate. |
| **Shadow shows `extra > 0` (stale)** | Investigate the stale Supabase rows manually. **Do not auto-delete.** These are employees removed locally but not yet soft-deleted in Supabase; resolve case-by-case (a local delete with the mirror ON will soft-delete via `deleted_at`). |
| **Dual-write failing** (`failures > 0` / `mismatches > 0`) | Set `EXPO_PUBLIC_EMPLOYEES_DUAL_WRITE=false`, rebuild/redeploy. Mirror stops; localStorage writes are unaffected. Diagnose with `recentMismatches` / `lastError`. |
| **Shadow validation noisy** (`shadowDrift > 0`) | Set `EXPO_PUBLIC_EMPLOYEES_SHADOW_VALIDATE=false`, rebuild. Mirror keeps running (if still desired); only the deep parity pass stops. |
| **Directory still shows stale/partial Supabase data** | This is a READ-path symptom. EMP-4 does not change the read flag. If unacceptable, the read flag (`EXPO_PUBLIC_EMPLOYEES_SUPABASE_READ`) is owned by EMP-2 and out of scope here — escalate rather than flipping it inside this runbook. |

**Flags safe to turn off at any time:** `EXPO_PUBLIC_EMPLOYEES_DUAL_WRITE`,
`EXPO_PUBLIC_EMPLOYEES_SHADOW_VALIDATE` (each = single env flip to `false` +
rebuild).

**Must NOT be manually deleted / changed:** Supabase `employees` rows (use the
mirror's soft-delete path), the `EMPLOYEES_SUPABASE_READ` flag, any
`companies`/`profiles` rows, and no `*_SUPABASE_AUTHORITATIVE` flag may be set.

---

## 7. Stop conditions (quick reference)

Halt the sequence immediately if any of these appear:

- Backfill `skipped.length > 0` or `error` set.
- Shadow `missing > 0`, `extra > 0`, or any `ok: false` after backfill.
- Dual-write `failures > 0`, `mismatches > 0`, or `lastError !== null`.
- Duplicate `employees` rows for one `legacy_id` (should be impossible — unique).
- Wrong `company_legacy_id` on a mirrored row (cross-company leakage).
- Archive producing a `deleted_at` (archive must be status-only), or delete NOT
  producing `deleted_at`.
- `shadowDrift > 0` once `EMPLOYEES_SHADOW_VALIDATE` is on.
- Any telemetry surfacing PII free text (phone/address) — the mirror compares
  only `legacy_id`/`company_legacy_id`/`name`/`email`/`status`; anything else is
  a defect.

---

## 8. Recommended end-to-end sequence

1. **Preflight** (Section 1) — map companies, count both sides, classify.
2. **Dry-run** backfill per company (2a) — confirm `skipped: []`.
3. **Backfill** per company (2b) — confirm `writtenCount === plannedCount`.
4. **Validate** (Section 3) — every company `ok: true`, missing 0, extra 0;
   directory no longer drops local-only employees.
5. Enable `EXPO_PUBLIC_EMPLOYEES_DUAL_WRITE=true`, rebuild, exercise writes
   (Section 4) — 0 failures, 0 mismatches.
6. Enable `EXPO_PUBLIC_EMPLOYEES_SHADOW_VALIDATE=true`, rebuild, watch drift = 0
   (Section 5).
7. **Stop.** No further cut-over decision from this runbook.
