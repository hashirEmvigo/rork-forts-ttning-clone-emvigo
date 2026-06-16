# Controlled Database Reset — Super-Admin-preserving (Admin-only)

> ⚠️ **Destructive. Admin-only. Testing use.** This wipes all company/test data
> and keeps **only** the Super Admin account(s) plus the platform-global config
> the app needs to boot. There is intentionally **no production data** to
> preserve at this stage.

## What this does

Removes every piece of company/test data while preserving the Super Admin:

- Companies (every tenant)
- Company Admin / Employee / Customer **auth users + profiles**
- Employees, Customers, Teams, Areas, Postal cities, Languages
- Roles & assignments tied to companies
- Work Orders / service rows / occurrence exceptions
- Visit Occurrences (Missions), Booking Queue, Schedule data
- Company services & catalog data, company settings
- Company entitlements / packages, agreements, time bank, payroll export
- Company modules, checklists, protocols, media
- Platform-level activity / audit / entitlement logs (orphans after wipe)

## What it preserves

- `super_admin` **auth users + `public.profiles` rows** (login stays intact).
- Platform-global config (all `company_id IS NULL` / no company link):
  `modules`, `module_categories`, `settings_templates`, global `roles`
  templates, global `services` / `service_categories`, global
  `checklist_templates`, global `service_global_entitlements`,
  `system_settings`. **Development Center depends on these — they are not test
  data.**

## Why it's safe

1. **Single transaction** (SQL path): if anything fails, nothing is applied.
2. **Safety gate**: aborts unless at least one **active** `super_admin` exists.
3. **Never** deletes a super_admin profile or login.
4. **Dependency-safe order**:
   - delete non-super-admin **auth users first** → cascades their `profiles`
     row (`profiles.id → auth.users ON DELETE CASCADE`). This is done before
     deleting companies so the `profiles.company_id → companies ON DELETE SET
     NULL` can never violate `profiles_company_required_check`.
   - delete **all companies** → every company-scoped table references
     `companies(id) ON DELETE CASCADE`, so one delete clears the whole tenant.
   - clear platform-level **logs** that referenced deleted companies.
5. **Verification** step asserts `companies = 0` and `non-super profiles = 0`
   before committing.

## Path A — SQL Editor (recommended, most transparent)

1. Supabase Dashboard → **SQL Editor**.
2. Paste [`scripts/reset-database.sql`](./reset-database.sql) and **Run**.
3. Read the `RESET SUMMARY` notices and the final preserved-accounts table.
4. The script ends with `commit;`. To preview without applying, change the last
   line to `rollback;` instead.

## Path B — Controlled CLI (mirrors the existing admin tooling)

Run from the `web-cleanops` folder (Node 18+). The `service_role` secret is read
from the environment only — never committed.

```bash
# 1) Preview only — no writes:
SUPABASE_URL="https://<PROJECT_REF>.supabase.co" \
SERVICE_ROLE_KEY="<service_role_secret>" \
node scripts/reset-database.mjs --dry-run

# 2) Real reset (preserves ALL super_admins):
SUPABASE_URL="https://<PROJECT_REF>.supabase.co" \
SERVICE_ROLE_KEY="<service_role_secret>" \
node scripts/reset-database.mjs --confirm

# 3) Keep exactly ONE super admin (delete any other super_admins too):
SUPABASE_URL="https://<PROJECT_REF>.supabase.co" \
SERVICE_ROLE_KEY="<service_role_secret>" \
node scripts/reset-database.mjs --confirm --keep-super-admin sebastian@stadalliansen.se
```

- `--dry-run` makes **no writes**; it prints exactly what would be deleted.
- `--confirm` is **required** for any real write.
- The CLI uses the Supabase **Admin API** to delete auth users (cleaner than raw
  SQL on `auth.users`) and PostgREST to delete companies + clear logs.

## Optional: hard-wipe the global master library

By default the platform-global master library (global services/roles/checklists,
settings templates, global entitlements) is **kept**, because the
create-company → admin → employees → customers → work-orders flow does not
require wiping it and Development Center relies on it.

If you want a truly bare platform, uncomment **SECTION 4** in
`reset-database.sql`.

## After the reset — verify, then test the full flow

1. **Super Admin login still works** (`sebastian@stadalliansen.se`).
2. **Development Center remains available** (globals preserved).
3. Confirm in SQL Editor:
   ```sql
   select id, email, base_role, company_id, status from public.profiles order by created_at;
   select count(*) from public.companies;          -- 0
   ```
4. Walk the flow from scratch:
   1. Create company
   2. Create / assign Company Admin (`scripts/create-company-admin.mjs` or the
      in-app create-user flow)
   3. Company Admin login
   4. Add employees
   5. Add customers
   6. Assign roles
   7. Assign area access
   8. Create work orders / AO
   9. Verify Supabase sync + cross-company visibility isolation

## Consistency guarantees

- **Supabase Auth, `profiles`, `app_users`, role assignments** end consistent:
  non-super auth users are removed (profiles cascade), and all company-scoped
  rows (`app_users`, `roles`, assignments) are removed by the company cascade.
- **No orphaned profiles/auth users** remain except the preserved Super Admin —
  orphaned (profile-less) auth users are also removed, while super_admin emails
  are explicitly protected.
