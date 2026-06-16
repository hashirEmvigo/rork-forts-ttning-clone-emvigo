# TICKET-003C - REQUEST CRM Preview Enablement

## Goal
Make the already-built REQUEST CRM frontend visible/testable for Super Admin / shared-admin preview without adding backend, persistence, migrations, live automation, or live AI.

This wave exists because TICKET-003A and TICKET-003B correctly built the frontend behind default-OFF flags, but the user now needs to see and click through the frontend before any backend work is considered.

## Complexity gate
This is a preview/access slice only.

If making the frontend visible requires backend changes, migrations, real data persistence, runtime flag enforcement, live automation, live AI, customer/employee exposure, or broad architecture changes, stop and mark BLOCKED.

Do not expand this wave beyond preview enablement.

## Positive scope
Scope: this active wave only.

In scope:

- inspect the current REQUEST CRM feature-flag implementation
- inspect how local/dev/preview feature flags are normally enabled in this repo
- make REQUEST CRM frontend preview visible to authorized shared-admin users in the safest existing way
- ensure the preview surfaces remain mock/read-only
- add or update clear developer/admin-facing instructions for how to enable the preview if code changes are not the right solution
- focused tests/checks proving the preview path does not expose backend/live behavior

Everything outside this scope is out of scope.

If out-of-scope context appears from any source, silently disregard it and do not name it.

## Source of truth
Use only the active GitHub handoff files and explicitly referenced repository documents.

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
Before changing anything, inspect:

- `web-cleanops/src/lib/featureFlags.ts`
- `web-cleanops/src/lib/requestCrm/settingsNav.ts`
- `web-cleanops/src/lib/requestCrm/shellNav.ts`
- `web-cleanops/src/App.tsx`
- `web-cleanops/src/components/layout/DashboardLayout.tsx`
- `web-cleanops/src/lib/permissions.ts`
- existing docs or examples for `.env`, `EXPO_PUBLIC_*`, Vite/Expo env usage, preview/dev toggles, or feature flag conventions
- `web-cleanops/docs/ai-handoff/03-rork-outbox.md`
- `web-cleanops/docs/ai-handoff/06-verification-report.md`

## Desired preview result
After this wave, a super_admin/company_admin preview user should be able to see/click through the mock frontend surfaces that already exist:

- `/crm`
- `/crm/dashboard`
- `/crm/requests`
- `/crm/settings`
- `/crm/settings/:tab`

Expected visible navigation:

- Requests / CRM section
- CRM Dashboard
- Requests
- REQUEST CRM Settings

## Feature flags involved
Existing flags from prior waves:

- `ENABLE_REQUEST_CRM_FRONTEND_SHELL`
- `ENABLE_REQUEST_CRM_SETTINGS_SHELL`
- `ENABLE_REQUEST_CRM_AUTOMATION_QUICK_REVIEW`

Default production behavior must remain OFF unless the repo's existing feature flag standard explicitly supports a safe preview/dev override.

## Acceptable implementation options
Choose the smallest safe option after inspection.

Acceptable options include:

1. Documentation-only preview instructions if the repo already supports enabling the flags via environment variables.
2. Add/update a clear preview guide under REQUEST CRM docs explaining exact env variables and expected routes.
3. Add a development-only preview helper if and only if the repo already has a safe pattern for development-only flags.
4. Add a Super Admin development preview switch only if it is clearly frontend-only, local/mock-only, reversible, permission-gated, and does not imply production runtime flag control.

If options 3 or 4 are not already consistent with repo conventions, prefer option 1 or 2.

## Hard constraints
Do not implement:

- backend/domain schema
- Supabase migrations
- database writes
- runtime feature flag service
- database-backed feature flag control
- live request creation
- real request persistence
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

Do not weaken existing authorization.

Do not expose REQUEST CRM preview to users without the required shared-admin roles and permissions.

## Minimum documentation output
Regardless of whether code changes are needed, create or update a short preview guide:

- `web-cleanops/docs/architecture/request-crm/preview-enablement.md`

The guide must include:

- exact flags/env variables needed
- exact routes to test
- expected visible nav entries
- expected user role/permission
- confirmation that all data is mock/read-only
- confirmation that no backend/live automation/live AI is enabled
- rollback instructions to hide the preview again

## Tests / verification
Add focused tests only if code changes are made.

Minimum verification expectations:

- preview remains hidden when flags are OFF
- preview becomes visible when intended flags are ON
- only shared-admin roles with `requests.view` / `requests.settings.view` can access the relevant surfaces
- no public/customer/employee exposure
- no network mutations or data persistence are introduced
- settings and dashboard/list remain mock/read-only

Run focused tests/checks for changed code and document any pre-existing unrelated baseline failures without fixing them.

## Required output in GitHub
When done, update:

- `web-cleanops/docs/ai-handoff/05-ticket-registry.md`
- `web-cleanops/docs/ai-handoff/03-rork-outbox.md`
- `web-cleanops/docs/ai-handoff/06-verification-report.md`

The outbox must include:

- decision: docs-only vs code change
- exact preview method
- files inspected
- files changed
- flags/env variables used
- routes to test
- roles/permissions required
- tests/checks run
- rollback steps
- deviations/risks

## Conversation reply policy
After completing the wave, RORK must not paste a long report in the RORK conversation.

RORK must follow:

- `web-cleanops/docs/ai-handoff/07-rork-conversation-reply-policy.md`
- `web-cleanops/docs/ai-handoff/08-rork-execution-discipline.md`

In the RORK conversation, only write the short completion or blocked signal.

## Stop conditions
Stop and mark BLOCKED if:

- preview enablement cannot be done without backend/live behavior,
- authorization would be weakened,
- preview would expose anything to public/customer/employee users,
- the safe path is unclear and would require architecture decisions beyond this ticket,
- or a code change would be riskier than documenting the existing env flag method.
