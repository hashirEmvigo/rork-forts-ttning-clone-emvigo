# Supabase Super Admin — Setup & Validation (Admin-only)

> ⚠️ **Admin-only.** This document covers setup, validation, and the current
> status of administrative authentication. **As of Phase 2C, admin authentication
> (Super Admin + Company Admin) requires Supabase Auth + an active `profiles`
> row** — there is no longer any localStorage admin login, restore, or recovery
> path. Employee and Customer authentication are intentionally unchanged and still
> use the existing path until their own migration phases. See §9 for the Phase 2C
> status summary.

The target Super Admin account:

| Field        | Value                          |
| ------------ | ------------------------------ |
| `email`      | `sebastian@stadalliansen.se`   |
| `base_role`  | `super_admin`                  |
| `status`     | `active`                       |
| `company_id` | `null`                         |

---

## 1. Create or verify the Supabase Auth user

1. Supabase Dashboard → **Authentication → Users**.
2. Search for `sebastian@stadalliansen.se`.
   - **If it exists:** copy the **User UID** — you'll confirm the profile matches it in step 2.
   - **If it does not exist:** create it (Add user) or let the `admin-create-user`
     Edge Function bootstrap it. Do **not** rely on the invite email if you're
     rate-limited — you'll set the password directly in step 3.

## 2. Ensure a matching row in `public.profiles`

In **SQL Editor**, verify a profile exists and is correct:

```sql
select id, email, base_role, company_id, status
from public.profiles
where email = 'sebastian@stadalliansen.se';
```

It must show:

- `base_role = super_admin`
- `status = active`
- `company_id = null`
- `id` equal to the Auth **User UID** from step 1.

If the row is missing or wrong, repair it (do not delete other test profiles).
The Supabase login gate fails closed unless **all** of these match.

## 3. Set a temporary password (no email, no rate limit)

Because Supabase's built-in email sending is rate-limited, use the admin-only
utility to set a temporary password directly — **no recovery email is sent**.

Get your keys:

- `SUPABASE_URL` = your `EXPO_PUBLIC_SUPABASE_URL` (e.g. `https://<ref>.supabase.co`).
- `SERVICE_ROLE_KEY` = Dashboard → **Settings → API → `service_role` secret**.
  This is highly privileged — paste it only into the terminal command below,
  never into a file, and never commit it.

Run once from the `web-cleanops` folder (Node 18+):

```bash
SUPABASE_URL="https://<PROJECT_REF>.supabase.co" \
SERVICE_ROLE_KEY="<service_role_secret>" \
node scripts/set-temp-password.mjs sebastian@stadalliansen.se "<temporary-password>" --confirm
```

> Use **placeholders only** in any copied/pasted examples. Replace
> `<service_role_secret>`, `<PROJECT_REF>`, and `<temporary-password>` with real
> values **only in your live terminal** — never paste real secrets into a file,
> chat, commit, or shared command history.

Notes:

- The `--confirm` flag is **required** — the tool refuses to change a password
  without it, so it can never overwrite automatically.
- It only updates an **existing** user; it does not create users.
- It marks the email as confirmed and sends **no** email.

## 4. Enable Supabase Auth for validation

Set the public flag and restart the dev server / rebuild:

```
EXPO_PUBLIC_USE_SUPABASE_AUTH=true
```

With the flag on, only `sebastian@stadalliansen.se` is routed through Supabase
Auth (per the allowlist in `src/lib/supabaseLogin.ts`). Every other email keeps
using localStorage login unchanged.

## 5. Roll back instantly

Set the flag back and restart / rebuild:

```
EXPO_PUBLIC_USE_SUPABASE_AUTH=false
```

The Supabase Auth layer goes dormant, the allowlisted email falls back to the
normal localStorage login like everyone else. No other change is needed.

## 6. Configure Custom SMTP with Resend

Custom SMTP removes Supabase's default email rate limit and enables reliable
self-service password recovery. We use **Resend** as the provider. None of these
steps touch the app login flow, and **no secrets are committed** — the SMTP
password (Resend API key) lives only in the Supabase dashboard.

### 6.1 Verify the sender domain in Resend

1. Resend Dashboard → **Domains → Add Domain**.
2. Enter the root domain: `stadalliansen.se` (add the domain itself, not the
   `noreply@` address).
3. Resend shows DNS records to add at your domain registrar / DNS host:
   - **MX** + **TXT (SPF)** record for the `send` subdomain.
   - **TXT (DKIM)** record (`resend._domainkey`).
   - Optional but recommended **DMARC** TXT record at `_dmarc`.
4. Add each record exactly as shown, then click **Verify** in Resend. Propagation
   is usually minutes but can take up to ~24–48h. The domain status must read
   **Verified** before sending.

### 6.2 Create the SMTP / API credential

Resend exposes SMTP using an API key as the password.

1. Resend Dashboard → **API Keys → Create API Key**.
2. Name it e.g. `supabase-smtp`, permission **Sending access**, scoped to the
   `stadalliansen.se` domain.
3. Copy the key (`re_...`) **once** — you paste it straight into Supabase in the
   next step. Do **not** save it to a file, commit it, or paste it into chat.

Resend SMTP connection values:

| Setting        | Value                |
| -------------- | -------------------- |
| Host           | `smtp.resend.com`    |
| Port           | `465` (SSL) or `587` (STARTTLS) |
| Username       | `resend`             |
| Password       | your Resend API key (`re_...`) |

### 6.3 Add the SMTP values in Supabase

Supabase Dashboard → **Authentication → Emails → SMTP Settings** →
enable **Custom SMTP**:

| Field            | Value                          |
| ---------------- | ------------------------------ |
| Sender email     | `noreply@stadalliansen.se`     |
| Sender name      | `Städalliansen` (or your app name) |
| Host             | `smtp.resend.com`              |
| Port             | `465`                          |
| Username         | `resend`                       |
| Password         | Resend API key (`re_...`)      |

The **sender email domain must match the verified Resend domain** — use
`noreply@stadalliansen.se` (not a `gmail.com`/other address), or Resend rejects
the send. Save.

While here, also raise **Authentication → Rate Limits → "Emails per hour"** from
the tiny default to a sane value (e.g. 30–100), since the default cap exists only
because of Supabase's built-in sender.

### 6.4 Test password recovery

1. In the app login screen, trigger **Forgot password** for
   `sebastian@stadalliansen.se` (or call
   `supabase.auth.resetPasswordForEmail('sebastian@stadalliansen.se')`).
2. A recovery email should arrive within seconds from `noreply@stadalliansen.se`.
3. Follow the link, set a new password, and confirm login works with it.

### 6.5 Check the logs

- **Supabase:** Dashboard → **Logs → Auth Logs** → confirm the recovery request
  succeeded with no SMTP error.
- **Resend:** Dashboard → **Emails / Logs** → confirm the message shows
  `Delivered` (watch for `Bounced`/`Complained`, which point to DNS/SPF issues).

> **Status (current):** Once Resend Custom SMTP is verified and saved, password
> recovery is **enabled** and no longer bound by Supabase's default email limits.
> The admin SQL/utility flow above remains available as an emergency fallback.
> Secrets (Resend API key, `service_role`) are never stored in this repo — only
> in the Resend and Supabase dashboards.

---

## 7. Phase 2B.6 — User Creation Flow (status)

Super Admin can now create users (company_admin / employee) through the app, with
creation routed onto the Supabase architecture behind a feature flag.

### 7.1 Path consolidation (implemented)

- **Single canonical create-user path.** `UserDialog` → `createUser` now routes
  through the Supabase user-creation path (the `admin-create-user` Edge Function)
  whenever `EXPO_PUBLIC_ENABLE_USER_CREATION=true`.
- The Edge Function creates the **Auth user** and the matching **`profiles`** row
  (correct `company_id`, `base_role`, default `status = active`) in one server-side
  operation, with rollback so no orphaned records are left behind.
- **localStorage fallback remains** when `EXPO_PUBLIC_ENABLE_USER_CREATION` is off
  (or unset) — legacy behavior is unchanged. The old path is **not** removed yet;
  it stays until verification is complete.

```
EXPO_PUBLIC_ENABLE_USER_CREATION=true   # route through Supabase
EXPO_PUBLIC_ENABLE_USER_CREATION=false  # legacy localStorage fallback
```

### 7.2 Temporary password mode (implemented)

- The create-user dialog exposes an **optional, admin-controlled temporary
  password** field.
- When provided, the Edge Function creates the user with that password and marks
  the email confirmed, so the **new user can log in immediately** — used only for
  verification/support while Custom SMTP propagation is still pending.
- **Invite-email remains the default and long-term path**; temp password is the
  interim option, not the standard flow.
- The **`service_role` key stays server-side only** (inside the Edge Function).
  It is never exposed to the client or committed.

### 7.2a Single canonical user-creation flow (implemented)

- The standalone **`/create-user`** page has been **consolidated** onto the same
  canonical **`AppContext.createUser`** flow used by **Admin → Users → Add user**
  (`UserDialog`). There is now **one** user-creation implementation.
- **`/create-user` is no longer invite-only** — it supports the optional
  **temporary password** mode there as well when
  `EXPO_PUBLIC_ENABLE_USER_CREATION=true`.
- **Invite email remains the default**; temporary password stays opt-in for
  verification/support only.

### 7.2b Duplicate-email fix (temp-password mode) — redeploy required ⛔

A duplicate-email edge case was found in **temporary-password mode**: Supabase
`admin.createUser` could **return the existing user without raising an error**
(unlike `inviteUserByEmail`, which returns `email_exists`). The read-back then
found the existing profile, so the create attempt was incorrectly reported as a
**success**.

- **Fix:** a **pre-existence check against `profiles.email`** has now been added
  before user creation, so duplicates are detected up front.
- **Duplicate email now returns `HTTP 409` / `email_exists`** with a clear error.
- The **existing Auth user is not deleted**.
- The **existing `profiles` row is not overwritten**.

> ⚠️ **This fix only takes effect after redeploying the Edge Function.** Until the
> redeploy is run against the latest code, the deployed function still has the old
> behavior (duplicate reported as success):
>
> ```bash
> supabase functions deploy admin-create-user
> ```
>
> As with §7.4, **Rork cannot perform this deployment** — it requires your own
> Supabase credentials / CLI access. Never commit secrets or paste them into chat.

### 7.3 Required deploy step

The updated Edge Function **must be redeployed before testing** — temp-password
mode will not work against an older deployed version:

```bash
supabase functions deploy admin-create-user
```

### 7.4 Pre-verification gate — confirm the deployed Edge Function is current ⛔

**Do not start the Phase 2B.6 checklist (§7.5) until this gate passes.**

- The deployed Edge Function **may be stale**. The latest code changes (the
  rollback/data-loss fix + temporary-password support) only take effect after
  `supabase functions deploy admin-create-user` has been run **against the most
  recent code**. There is no auto-deploy — if the deploy command has not been run
  since those changes, the deployed version is out of date.
- **Check the deployment timestamp:** Supabase Dashboard →
  **Edge Functions → `admin-create-user` → Details → "Last deployed"**.
- **Gate condition:** the **"Last deployed" timestamp must be newer** than the
  rollback-fix + temp-password implementation. If it is older (or you have not
  personally run the deploy since those changes), redeploy first:

  ```bash
  supabase functions deploy admin-create-user
  ```

- **Rork cannot perform this deployment** — it requires your own Supabase
  credentials / CLI access (the function lives in your Supabase project, which
  Rork has no access to). It must be run by you locally.
- **Never** commit secrets or paste them into chat (Supabase access token,
  `service_role` key, etc.) — authenticate the CLI in your own terminal only.

Only once the deployed timestamp is confirmed newer than the latest code changes
should you proceed to §7.5.

### 7.4a UI-based stale detection (when the Supabase CLI is not available)

**Purpose:** when you cannot check the "Last deployed" timestamp via the CLI/dashboard
(§7.4), use this app-driven procedure to determine whether the deployed
`admin-create-user` Edge Function already supports the latest **rollback/data-loss
fix** and **temporary-password mode**. This is an *alternative* pre-verification
method — it answers the same gate question ("is the deployed function current?")
using only the app UI.

Run with `EXPO_PUBLIC_ENABLE_USER_CREATION=true`.

**Test 1 — Create a fresh `company_admin` with a temporary password.**
- In `UserDialog`, create a brand-new `company_admin` (use a unique, never-used
  email) and set an **optional temporary password**.
- **Expected current behavior:** the result reports **"User created"** and the new
  user **can sign in now** with that temporary password.
- **Stale behavior:** the result reports **"User invited"** (invite-email path) or
  **immediate login fails** — the deployed function is ignoring `temp_password`,
  which means it predates the temp-password work.

**Test 2 — Verify the Auth user exists and is confirmed.**
- Supabase Dashboard → **Authentication → Users** → find the new email.
- Confirm the user **exists** and the email is **confirmed** (temp-password mode
  marks the email confirmed so immediate login works).

**Test 3 — Verify the `profiles` row.**
- SQL Editor / Table editor → confirm a matching **`public.profiles`** row exists
  with the correct **`company_id`**, correct **`base_role`** (`company_admin`), and
  **`status = active`**.

**Test 4 — Duplicate-email handling (data-loss safety).**
- Attempt to create another user with the **same email** as an existing user.
- **Expected current behavior:** a **clear duplicate-email error** is returned, and
  the **original user is NOT deleted** (verify the original Auth user + profile row
  still exist afterward).
- **Stale behavior:** the original user is deleted / disappears — the deployed
  function still has the old find-by-email-and-delete rollback bug.

**Decision rule:**
- ✅ **If** temp-password login works (Test 1) **and** duplicate email returns a
  clear error without deleting the original user (Test 4) → the deployed function
  is current enough; **continue** with the Phase 2B.6 verification (§7.5).
- ⛔ **If** either fails (invite-only/login fails, or the original user is deleted)
  → **stop** and **redeploy** the Edge Function (`supabase functions deploy
  admin-create-user`) before continuing.

### 7.5 Verification checklist (Phase 2B.6)

> ⛔ **BLOCKED — Phase 2B.6 verification cannot start until the updated Edge
> Function (with the §7.2b duplicate-email fix) is deployed.** Run
> `supabase functions deploy admin-create-user` against the latest code first,
> then confirm the §7.4 deploy gate before proceeding.

Run with `EXPO_PUBLIC_ENABLE_USER_CREATION=true` and the Edge Function redeployed
(pre-verification gate §7.4 passed):

- [ ] Create a **company_admin** with a temporary password.
- [ ] Create an **employee** with a temporary password.
- [ ] Confirm the **Auth user** exists (Authentication → Users).
- [ ] Confirm the matching **`profiles`** row exists.
- [ ] Confirm the correct **`company_id`** is assigned.
- [ ] Confirm the correct **`base_role`** is assigned.
- [ ] Confirm the created user **can log in** with the temporary password.
- [ ] Confirm a **duplicate email** returns a clear error.
- [ ] Confirm a **duplicate email does not delete** the original user.
- [ ] Confirm **flag-off** still uses the legacy localStorage behavior.

> **Scope guard:** employee migration and work-order migration are **not** started
> in this phase, and the localStorage fallback is **not** removed.

---

## 8. Provision real Company Admins (`create-company-admin.mjs`)

> ⚠️ **Admin-only / trusted machine.** Admin login now requires a real Supabase
> Auth identity (legacy/localStorage admin accounts are no longer valid). Use
> this script once per Company Admin to create — or repair — their account in
> **both** sources of truth: `auth.users` **and** `public.profiles`. It only
> provisions `base_role = company_admin`; it **refuses** to create super_admins.

### 8.1 When to use it

- A new Company Admin needs access and does not yet exist in Supabase Auth.
- An existing localStorage-only "Company Admin" must be migrated to Supabase Auth
  so protected Edge Functions (e.g. `admin-create-user`) receive a real session
  token instead of the anon key.
- You need to reset a Company Admin's temporary password and re-confirm their
  profile in one idempotent step.

### 8.2 Required environment variables

- `SUPABASE_URL` = your `EXPO_PUBLIC_SUPABASE_URL` (e.g. `https://<ref>.supabase.co`).
- `SERVICE_ROLE_KEY` = Dashboard → **Settings → API → `service_role` secret**.
  Highly privileged — paste it only into the live terminal command, never into a
  file, commit, or chat.

### 8.3 Inputs

| Flag         | Required | Meaning                                                        |
| ------------ | -------- | -------------------------------------------------------------- |
| `--email`    | yes      | The Company Admin's login email.                               |
| `--password` | yes      | Temporary password (min 8 chars); email is auto-confirmed.     |
| `--company`  | yes      | Supabase company **UUID** *or* legacy id (e.g. `cmp_nordlys`). |
| `--name`     | no       | Optional full name for the profile.                            |
| `--confirm`  | yes\*    | Explicit safety flag; the script refuses to write without it.  |
| `--dry-run`  | no       | Preview only. Validates and reports intended actions; makes **no writes** and does **not** require `--confirm`. |

\* `--confirm` is required for real writes, but not when using `--dry-run`.

### 8.4 Preview first with `--dry-run`

Before the real run, verify company lookup and intended behavior **without writing
anything** to Supabase:

```bash
SUPABASE_URL="https://<PROJECT_REF>.supabase.co" \
SERVICE_ROLE_KEY="<service_role_secret>" \
node scripts/create-company-admin.mjs \
  --email admin@nordlys.example \
  --password "<temporary-password>" \
  --company cmp_nordlys \
  --dry-run
```

Dry-run resolves and validates the company (exists + `active`), checks whether the
Auth user and matching profile already exist, and prints exactly what it *would*
do — create vs update for both the Auth user and the profile. It performs **no
writes**: no Auth user creation, no password change, no profile insert/update. Once
the summary looks right, re-run with `--confirm` (and drop `--dry-run`).

### 8.5 Example command (real write)

Run once from the `web-cleanops` folder (Node 18+):

```bash
SUPABASE_URL="https://<PROJECT_REF>.supabase.co" \
SERVICE_ROLE_KEY="<service_role_secret>" \
node scripts/create-company-admin.mjs \
  --email admin@nordlys.example \
  --password "<temporary-password>" \
  --company cmp_nordlys \
  --confirm
```

> Use **placeholders only** in any copied examples. Replace `<service_role_secret>`,
> `<PROJECT_REF>`, and `<temporary-password>` with real values **only in your live
> terminal** — never paste real secrets into a file, commit, or chat.

### 8.6 How company lookup works

- If `--company` is a UUID, it is matched against `companies.id`.
- Otherwise it is matched against `companies.legacy_id` (e.g. `cmp_nordlys`).
- The company is resolved **first**. If it is missing — or not `active` — the
  script aborts **before** creating any Auth user or profile. It never invents a
  `company_id`.

### 8.7 Idempotency & safety

- **No duplicate Auth users:** an existing user with the same email is reused; the
  script only resets their temporary password and confirms the email.
- **No duplicate profiles:** the profile is keyed on `id` (== Auth user id) and is
  inserted when missing or updated otherwise.
- **Company Admin only:** sets `base_role = company_admin`, `status = active`. It
  refuses to run if the existing profile is a `super_admin` (no downgrade).
- **Secrets never logged:** the `service_role` key is read from the environment
  and is never printed or written to disk.
- **No `--confirm`, no write:** the script exits without touching anything.
- **Dry-run is read-only:** `--dry-run` only reads (company, Auth user, profile)
  and reports intended actions; it never writes.

### 8.8 Expected result

On success you'll see the resolved company, the Auth UID (created or reused), and
the profile action (`created`/`updated`) with the final
`base_role` / `status` / `company_id`.

### 8.9 Verify in Supabase

- **Authentication → Users:** find the email; confirm the user exists and the
  email is **confirmed**.
- **`profiles` (SQL Editor):**

  ```sql
  select id, email, base_role, company_id, status
  from public.profiles
  where email = 'admin@nordlys.example';
  ```

  It must show `base_role = company_admin`, `status = active`, a non-null
  `company_id` matching the company, and `id` equal to the Auth **User UID**.

### 8.10 Test login afterward (end-to-end)

With `EXPO_PUBLIC_USE_SUPABASE_AUTH=true` and `EXPO_PUBLIC_ENABLE_USER_CREATION=true`:

1. Log in as the new Company Admin with the temporary password.
2. Confirm a Supabase session is established (`getSession()` returns a real session;
   it persists across reload).
3. Go to **Admin → Users** and create a user.
4. Confirm the create-user request runs with `authMode=session` (a real access
   token, **not** the anon key) and returns `functionVersion: 2024-companyadmin-1`.
5. Link the created login to an **Employee**.
6. Assign **Role & Permissions**.

---

## 9. Phase 2C — Legacy admin cleanup (COMPLETE ✅)

The legacy/demo admin authentication layer has been fully removed. Admin identity
is now single-source-of-truth: **Supabase Auth + an active `public.profiles` row.**

### 9.1 What changed

- **All seeded demo admin users removed from `src/lib/store.ts`:**
  - `usr_root` — `super@cleanops.io` (`super_admin`)
  - `usr_admin1` — `admin@nordlys.io` (`company_admin`)
  - `usr_admin2` — `admin@fjord.io` (`company_admin`)
  No `super_admin` or `company_admin` seeds remain.
- **No localStorage admin login path remains.** `authenticate()` fails closed for
  admin roles, and the AppContext login fallback no longer signs admins in via
  localStorage.
- **No localStorage admin reset/recovery path remains.** `createResetToken()` and
  `consumeResetToken()` both fail closed for admin roles, and stale localStorage
  admin sessions are dropped on app load (not restored).
- **Employee and Customer demo users are untouched** — `usr_emp1`, `usr_emp2`,
  `usr_emp3`, `usr_cust1`, `usr_cust2` and their existing auth path remain as-is.

### 9.2 Admin authentication requirements (enforced)

A valid administrative login must have **all** of:

- a matching `auth.users` row,
- a matching `public.profiles` row,
- `status = active`,
- `base_role = super_admin` or `company_admin`,
- `company_id` (required for `company_admin`).

If no valid Supabase Auth identity exists, admin login fails with a clear message
— it does **not** silently fall back to localStorage.

### 9.3 Remaining production steps

1. **Set `BOOTSTRAP_SUPER_ADMIN_EMAIL`** (server-side) so the initial Super Admin
   can be provisioned in Supabase Auth.
2. **Confirm `EXPO_PUBLIC_USE_SUPABASE_AUTH=true`** in the running app so admin
   login is routed through Supabase Auth.
3. **Provision real Company Admins** via `scripts/create-company-admin.mjs` (see
   §8) so each has both an `auth.users` row and an active `profiles` row.

### 9.4 Remaining legacy dependencies (future phases, not blockers)

- Employee and Customer login still use the legacy/localStorage path; their
  migration is a separate, later phase.

**Phase 2C status: COMPLETE.** No blockers found.

---

## Verification checklist

Verified with `EXPO_PUBLIC_USE_SUPABASE_AUTH=true` — **Auth verification PASSED ✅**

- [x] Login succeeds with `sebastian@stadalliansen.se` + the temporary password.
- [x] A Supabase session is created (persists across reload).
- [x] Profile loads correctly from `public.profiles`.
- [x] The `super_admin` + `active` gate passes (login is rejected if either is changed).
- [x] A non-allowlisted email still logs in via localStorage (unchanged).
- [x] Protected routes work when authenticated; redirect when signed out.
- [x] RLS / helper functions still behave correctly (company isolation intact).
- [x] **No** password recovery / invite email was sent during the whole process.
- [ ] Rollback verified: with the flag `false`, the allowlisted email logs in via localStorage again. *(flag kept `true` for now — see note above)*
```
