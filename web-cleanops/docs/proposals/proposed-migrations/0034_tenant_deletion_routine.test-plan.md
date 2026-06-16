# Test plan — proposed migration `0034_tenant_deletion_routine`

> **Status:** test plan for an UNAPPLIED proposal. Run these only against a
> disposable/staging database **after** the migration is approved and applied
> there — never first against production. Pair every destructive verification
> with a **separate** SELECT-only check (runbook §3 lesson).

## Pre-conditions

- Migration `0034` applied to a staging DB seeded with at least two companies,
  each with profiles, customers, work orders, mission log, and time-reporting
  rows, plus one `super_admin` profile with `company_id = NULL`.

## A. Schema-hardening (FK now RESTRICT)

1. **Naive delete is blocked.** `DELETE FROM companies WHERE id = <company A>`
   while profiles still reference it → must fail with a foreign-key
   `RESTRICT` violation. (Previously SET NULL would have detached them.)
2. **Super_admin unaffected.** Confirm the super_admin profile still has
   `company_id = NULL` and is untouched.

## B. Guard rejection paths (routine refuses, fail-closed)

For each, the call must `RAISE` and change **no** rows:

1. `delete_company_tenant(NULL, 'cmp_x')` → missing company_id.
2. `delete_company_tenant(<A.id>, NULL)` → missing legacy_id.
3. `delete_company_tenant(<A.id>, '')` → blank legacy_id.
4. `delete_company_tenant('00000000-…-0000', 'cmp_x')` → company not found.
5. `delete_company_tenant(<A.id>, '<wrong legacy_id>')` → identifier mismatch.
6. Temporarily scope a `super_admin`/protected-email profile to company A, then
   call with A's ids → must abort with the protected-profile guard. (Clean up.)

## C. Happy path (company A)

1. Capture pre-counts with the runbook Phase A SELECT-only query.
2. Call `select delete_company_tenant('<A.id>', '<A.legacy_id>');`.
3. Assert the returned jsonb `deleted` counts equal the pre-counts per table,
   `companies = 1`, and `verified_zero = true`.
4. **Separate** SELECT-only run (runbook Phase C): every company-A check `= 0`.

## D. Isolation (company B untouched)

1. After C, run Phase A counts for company B → unchanged from baseline.
2. Super_admin profile still present (`= 1`).

## E. auth.users untouched

1. Confirm the `auth.users` rows for company A's deleted profiles still exist
   (routine must not have removed them) and are now true orphans
   (`NOT EXISTS` a matching profile) — i.e. ready for the optional, separate
   runbook Phases D–F.

## F. Permissions

1. As `authenticated` / `anon` role: `select delete_company_tenant(...)` →
   permission denied (execute revoked).
2. As service role: succeeds.

## Pass signature

All of B raises with zero row changes; C/D/E/F behave exactly as above. Any
deviation blocks promotion of the migration beyond staging.
