# TICKET-003D - REQUEST CRM Preview Visibility + Settings Route Correction

## Goal
Fix the current frontend preview issue and align REQUEST/CRM settings with the user's desired Settings IA.

The user reports:

- no REQUEST/CRM items are visible in the left menu;
- direct browser navigation to `/crm/dashboard` returns the 404 / Oops page;
- Request and CRM settings should live under Settings, specifically:
  - `stadportalen.se/settings/request`
  - `stadportalen.se/settings/crm`

This is a corrective frontend-only wave. The objective is to make the already-built mock/read-only REQUEST CRM frontend visible/clickable in the current preview environment and place configuration surfaces under Settings.

## Complexity gate
This is a preview visibility + route/navigation correction only.

If solving it requires backend changes, migrations, runtime feature-flag service, database-backed flags, live request persistence, live automation, live AI, or authorization weakening, stop and mark BLOCKED.

Do not expand this wave into backend, real request handling, notifications, chat, detail shell, or automation execution.

## Positive scope
Scope: this active wave only.

In scope:

- diagnose why `/crm/dashboard` resolves to the 404/Oops page in the current preview environment;
- fix the frontend route/nav gating so the built REQUEST CRM mock preview is visible to authorized shared-admin preview users;
- preserve safe default behavior and fail-closed authorization;
- add Settings routes:
  - `/settings/request`
  - `/settings/crm`
- place Request/CRM settings navigation under the existing Settings area/menu instead of only under the CRM area;
- keep all surfaces mock/read-only;
- add safe redirects/aliases only if useful, for example old `/crm/settings` can redirect to the new Settings route;
- update docs/tests/handoff reports.

Everything outside this scope is out of scope.

If out-of-scope context appears from any source, silently disregard it and do not name it.

## Source of truth
Use only the active GitHub handoff files and explicitly referenced repository files.

RORK must not use previous chat/conversation history as task context.

RORK must read and follow:

- `web-cleanops/docs/ai-handoff/01-current-objective.md`
- `web-cleanops/docs/ai-handoff/02-rork-inbox.md`
- `web-cleanops/docs/ai-handoff/04-escalation-policy.md`
- `web-cleanops/docs/ai-handoff/05-ticket-registry.md`
- `web-cleanops/docs/ai-handoff/07-rork-conversation-reply-policy.md`
- `web-cleanops/docs/ai-handoff/08-rork-execution-discipline.md`
- this ticket

## Required inspection
Before coding, inspect:

- `web-cleanops/src/lib/featureFlags.ts`
- `web-cleanops/src/lib/requestCrm/settingsNav.ts`
- `web-cleanops/src/lib/requestCrm/shellNav.ts`
- `web-cleanops/src/App.tsx`
- `web-cleanops/src/components/layout/DashboardLayout.tsx`
- `web-cleanops/src/lib/permissions.ts`
- existing Settings routes/pages/components under `web-cleanops/src/pages/settings`, `web-cleanops/src/components/settings`, or equivalent current structure
- current REQUEST CRM pages/components from TICKET-003A/003B
- `web-cleanops/docs/architecture/request-crm/preview-enablement.md`
- `web-cleanops/docs/ai-handoff/03-rork-outbox.md`
- `web-cleanops/docs/ai-handoff/06-verification-report.md`

## Required user-visible result
After this wave, in the current app preview environment, an authorized shared-admin user must be able to click or navigate to:

Operational preview:

- `/crm`
- `/crm/dashboard`
- `/crm/requests`

Settings placement:

- `/settings/request`
- `/settings/crm`

Expected navigation:

- Operational REQUEST/CRM pages may remain in a REQUEST/CRM or Requests area.
- Request/CRM settings must appear under the existing Settings area/menu.
- Do not rely only on documentation if the current preview environment still hides the routes and causes 404.

## Route behavior
Implement safe route behavior:

- `/crm` should redirect to `/crm/dashboard` or otherwise land on the REQUEST CRM dashboard preview.
- `/crm/dashboard` should render the existing mock dashboard for authorized shared-admin users.
- `/crm/requests` should render the existing mock request list for authorized shared-admin users.
- `/settings/request` should render the Request settings surface.
- `/settings/crm` should render the CRM settings surface.
- If `/crm/settings` and `/crm/settings/:tab` already exist, either keep them as backwards-compatible aliases that redirect to the correct Settings route or leave them only if doing so does not confuse nav. The visible nav should prefer `/settings/request` and `/settings/crm`.

## Settings surface split
Use the existing TICKET-003A settings shell and split or route it in the smallest safe way.

Suggested grouping:

### `/settings/request`
Request handling configuration, for example:

- Categories
- Request Types
- Statuses
- Priority & Severity
- SLA Defaults
- Visibility & Access
- Notifications
- Internal Posts & Tasks

### `/settings/crm`
CRM/module governance configuration, for example:

- General
- AI & Automation
- Runtime Safety Links
- Automation & AI Center source-of-truth references

Do not overbuild this split. Reuse existing components/tabs/fixtures as much as possible.

## Preview gating decision
The previous WAVE-003C docs-only approach is not sufficient for the user's current preview because the UI remains hidden and direct routes return 404.

RORK must choose the smallest safe code-level fix that makes the mock preview visible in the current environment while preserving authorization and avoiding live behavior.

Acceptable options:

1. If the app has a safe preview/dev environment mode, make REQUEST CRM mock preview visible there for shared-admin users without requiring production runtime flags.
2. If the existing flag helpers can safely distinguish preview/dev from production, allow a preview-only default ON for REQUEST CRM mock surfaces while keeping production default OFF.
3. If neither is safe, implement a clearly named frontend-only preview override that is local/mock-only, shared-admin-only, and documented; stop if this would become a runtime feature-flag service.

Hard requirement: do not weaken role/permission guards.

## Feature flags / safety
Preserve these existing flags where useful:

- `ENABLE_REQUEST_CRM_FRONTEND_SHELL`
- `ENABLE_REQUEST_CRM_SETTINGS_SHELL`
- `ENABLE_REQUEST_CRM_AUTOMATION_QUICK_REVIEW`

But do not allow flags OFF to produce a 404 in the current intended preview experience for authorized shared-admin users if the route is part of this preview wave.

If a preview override is added, it must be:

- frontend-only;
- mock/read-only;
- explicitly named as preview/demo/dev-only;
- documented in `preview-enablement.md`;
- safe to remove later;
- not a backend/runtime flag service.

## Permissions
Keep authorization strict:

- Dashboard + Requests require `requests.view`.
- Settings routes require `requests.settings.view` or the existing appropriate Settings permission pattern plus REQUEST CRM settings permission.
- Access is shared-admin only.
- No employee/customer/public exposure.

## Hard non-goals
Do not implement:

- backend/domain schema
- Supabase migrations
- database writes
- runtime feature flag service
- database-backed feature flag control
- live request creation
- real request persistence
- request detail shell beyond existing disabled placeholder
- live notification engine
- live AI provider
- automation runner
- rule builder
- runtime guard enforcement
- kill switch enforcement
- circuit breaker enforcement
- email outbox/inbound email
- public/customer/employee portal exposure
- irreversible domain mutations

Do not modify unrelated existing flows.

## Tests / verification
Add focused tests for the code changes.

Minimum expectations:

- authorized shared-admin preview user can access `/crm/dashboard` without 404 in the intended preview environment;
- authorized shared-admin preview user can access `/crm/requests` without 404 in the intended preview environment;
- `/settings/request` renders the Request settings surface;
- `/settings/crm` renders the CRM settings surface;
- Settings nav contains Request and CRM settings entries under Settings;
- unauthorized roles remain blocked;
- no backend/network mutations are introduced;
- mock/read-only indicators remain visible;
- rollback path is documented.

Run focused tests/checks for changed code. If repo-wide baseline failures appear in unrelated files, document them without fixing them.

## Required output in GitHub
When done, update:

- `web-cleanops/docs/ai-handoff/05-ticket-registry.md`
- `web-cleanops/docs/ai-handoff/03-rork-outbox.md`
- `web-cleanops/docs/ai-handoff/06-verification-report.md`
- `web-cleanops/docs/architecture/request-crm/preview-enablement.md`

The outbox must include:

- root cause of the 404/no-left-menu issue;
- exact code-level fix chosen;
- routes added/changed;
- Settings nav changes;
- permission behavior;
- preview/flag behavior;
- files changed;
- tests/checks run;
- rollback steps;
- risks/deviations.

## Conversation reply policy
After completing the wave, RORK must not paste a long report in the RORK conversation.

RORK must follow:

- `web-cleanops/docs/ai-handoff/07-rork-conversation-reply-policy.md`
- `web-cleanops/docs/ai-handoff/08-rork-execution-discipline.md`

In the RORK conversation, only write the short completion or blocked signal.

## Stop conditions
Stop and mark BLOCKED if:

- the route/nav fix cannot be done without backend/live behavior;
- authorization would be weakened;
- preview would expose anything to public/customer/employee users;
- settings route placement requires a broad Settings-module rewrite;
- the safe preview override would become a runtime flag service;
- or implementation would require touching unrelated domains.
