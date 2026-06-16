# REQUEST CRM — Preview Enablement Guide

## Purpose
The REQUEST CRM frontend shell (Dashboard, Request List, Settings) is already
built behind default-OFF feature flags. This guide explains the safest existing
way to make those mock/read-only surfaces visible to an authorized shared-admin
preview user so the frontend can be clicked through **before any backend work is
considered**.

No code change is required to enable the preview. The repo already supports a
safe, reversible env-flag preview path; this is the smallest safe option.

## How the flags work in this repo
REQUEST CRM visibility is controlled entirely by three build-time public env
flags defined in `web-cleanops/src/lib/featureFlags.ts` using the existing
`envFlag()` convention:

- A flag is ON **only** when its env var is exactly the string `"true"`.
- Any other value (unset, `"false"`, `"1"`, etc.) keeps it **OFF**.
- Vite exposes both `VITE_*` and `EXPO_PUBLIC_*` prefixes
  (`envPrefix` in `web-cleanops/vite.config.ts`).
- Flags are read via `import.meta.env` and inlined **at build time**, so a
  **rebuild is required** after changing them. There is no runtime toggle — by
  design. Runtime flag enforcement / kill switches remain owned centrally by the
  Automation & AI Center and are explicitly out of scope for this preview.

## Exact flags / env variables needed

| Env variable | Default | Effect when set to `true` |
|---|---|---|
| `EXPO_PUBLIC_ENABLE_REQUEST_CRM_FRONTEND_SHELL` | OFF | Master flag. Registers `/crm`, `/crm/dashboard`, `/crm/requests` and shows the **CRM Dashboard** + **Requests** nav entries. Required for any REQUEST CRM preview. |
| `EXPO_PUBLIC_ENABLE_REQUEST_CRM_SETTINGS_SHELL` | OFF | Settings sub-shell. **Requires the master flag too.** Registers `/crm/settings` and `/crm/settings/:tab` and shows the **REQUEST CRM Settings** nav entry. |
| `EXPO_PUBLIC_ENABLE_REQUEST_CRM_AUTOMATION_QUICK_REVIEW` | OFF | Optional. Reveals the dashboard's **display-only** automation-candidate detail block. Not required for the core preview. |

### Minimum preview (Dashboard + Requests)
```
EXPO_PUBLIC_ENABLE_REQUEST_CRM_FRONTEND_SHELL=true
```

### Full preview (Dashboard + Requests + Settings)
```
EXPO_PUBLIC_ENABLE_REQUEST_CRM_FRONTEND_SHELL=true
EXPO_PUBLIC_ENABLE_REQUEST_CRM_SETTINGS_SHELL=true
```

### Optional automation detail block on the dashboard
```
EXPO_PUBLIC_ENABLE_REQUEST_CRM_AUTOMATION_QUICK_REVIEW=true
```

After setting the variable(s), rebuild/redeploy the web app (e.g. `vite build`
/ the normal preview build) so the new values are inlined.

## Exact routes to test
With the master flag ON (and signed in as an authorized shared-admin user):

- `/crm` → redirects to `/crm/dashboard`
- `/crm/dashboard`
- `/crm/requests`

With the settings sub-shell flag **also** ON:

- `/crm/settings` (opens the default settings tab)
- `/crm/settings/:tab` (e.g. the individual settings sections)

## Expected visible navigation
A **"Requests / CRM"** sidebar section appears with:

- **CRM Dashboard** → `/crm/dashboard` (master flag)
- **Requests** → `/crm/requests` (master flag)
- **REQUEST CRM Settings** → `/crm/settings` (only when the settings sub-shell
  flag is also ON)

The section is hidden entirely when nothing qualifies.

## Expected user role / permission
Preview is **shared admin only**. Access requires both the right role and the
right permission (enforced by the route guard
`<ProtectedRoute allow={["super_admin","company_admin"]} …>` and by each page
failing closed with `AccessDenied`):

- Dashboard + Requests: role `super_admin` **or** `company_admin` holding
  `requests.view`.
- Settings: role `super_admin` **or** `company_admin` holding
  `requests.settings.view`.

These permissions are granted **by default only** to `super_admin` and
`company_admin` in `DEFAULT_ROLE_PERMISSIONS` (`web-cleanops/src/lib/permissions.ts`).
`employee` and `customer` roles hold neither and cannot reach any REQUEST CRM
surface. No authorization is weakened by enabling the preview — the flags only
control whether the already-gated routes exist.

## Data is mock / read-only
All REQUEST CRM preview surfaces render typed, in-`src` mock fixtures
(`web-cleanops/src/lib/requestCrm/mockData/*`), every entity marked
`isTestData: true`:

- Filters, search and sort change **local React state only**.
- No localStorage authority, no Supabase reads/writes, no network mutations.
- The per-row request "Open" detail action is a disabled "coming soon"
  placeholder (the detail surface is a later slice).
- The settings shell is read-only; no settings are persisted.

## No backend / live automation / live AI is enabled
Enabling these flags does **not** turn on any live behavior. The preview has:

- no backend/domain schema, no Supabase migrations, no database writes;
- no live request creation or persistence;
- no live notification engine, no live AI provider, no automation runner, no
  rule builder;
- no runtime flag / kill-switch / circuit-breaker enforcement;
- no email outbox/inbound email;
- no public/customer/employee portal exposure.

Automation & AI Center indicators shown on the dashboard/list are **display-only,
static** references — they do not execute or call anything.

## Rollback (hide the preview again)
Rollback is instant and data-free — no migrations, no cleanup:

1. Remove (or set to `false`) these env vars:
   - `EXPO_PUBLIC_ENABLE_REQUEST_CRM_FRONTEND_SHELL`
   - `EXPO_PUBLIC_ENABLE_REQUEST_CRM_SETTINGS_SHELL`
   - `EXPO_PUBLIC_ENABLE_REQUEST_CRM_AUTOMATION_QUICK_REVIEW`
2. Rebuild/redeploy the web app.

With the master flag OFF the `/crm*` routes are no longer registered and the
"Requests / CRM" nav entries disappear — the app returns to its current default
state with zero REQUEST CRM surface. Because the master flag gates the settings
sub-shell too, turning the master flag OFF hides everything regardless of the
other two flags.

## Notes
- Tip: the master flag alone gives the Dashboard + Requests preview; add the
  settings flag to also preview Settings.
- Production/default behavior stays safe: with no env overrides, every REQUEST
  CRM flag resolves OFF.
