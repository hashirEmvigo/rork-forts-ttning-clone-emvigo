# TICKET-003B - REQUEST CRM Dashboard + Request List Shell

## Goal
Implement the next controlled REQUEST CRM frontend slice: Dashboard shell + Request List shell.

This wave extends the existing REQUEST CRM shell after TICKET-003A. It must remain frontend/design + mock data only.

## Positive scope
Scope: this active wave only.

In scope:

- REQUEST CRM dashboard shell
- REQUEST CRM request list shell
- read-only filters and summary cards
- mock/demo request data loaded through an in-`src` fixture layer
- admin-only route/nav behavior using the existing permission + feature-flag model
- display-only Automation & AI Center quick-review indicators where relevant
- focused tests for the new shell/list behavior

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

## Required docs to inspect
Before coding, inspect only these relevant current docs/data/contracts:

- `web-cleanops/docs/architecture/request-crm/implementation-plan.md`
- `web-cleanops/docs/architecture/request-crm/27-slice-0-frontend-shell.md`
- `web-cleanops/docs/architecture/request-crm/20-feature-flags.md`
- `web-cleanops/docs/architecture/request-crm/21-test-data-and-mock-data-policy.md` if present; if absent use `web-cleanops/docs/00-project-operating-mode-and-test-data-policy.md`
- `web-cleanops/docs/architecture/request-crm/25-automation-ai-center-alignment.md`
- `web-cleanops/docs/architecture/request-crm/26-runtime-safety-performance-alignment.md`
- `web-cleanops/docs/ui/request-crm/01-request-crm-navigation-and-routes.md`
- `web-cleanops/docs/ui/request-crm/02-filter-sort-spec.md`
- `web-cleanops/mock-data/request-crm/request-dashboard.seed.json`
- `web-cleanops/mock-data/request-crm/request-list.seed.json`
- `web-cleanops/mock-data/request-crm/request-categories.seed.json`
- `web-cleanops/mock-data/request-crm/request-types.seed.json`
- `web-cleanops/mock-data/request-crm/automation-candidates.seed.json`
- `web-cleanops/mock-data/request-crm/runtime-safety-mock.seed.json`
- `web-cleanops/contracts/typescript/request-crm/request-crm-contracts.ts`
- `web-cleanops/docs/architecture/automation-ai-center/00-automation-ai-center-index.md`

If the Automation & AI Center canonical docs are not present at the path above, mark this ticket BLOCKED and write the reason in the outbox. Do not infer from chat history.

## Scope details
Build two admin-only read-only screens:

1. REQUEST CRM Dashboard shell
   - route: `/crm/dashboard`
   - summary/KPI cards from mock dashboard data
   - attention/priority/SLA style cards if present in mock data
   - links/buttons to request list/detail may exist but must remain read-only/mock-safe
   - visible `Mock`, `Read-only`, or `Slice 0` indicators
   - visible Automation & AI Center source-of-truth reference for automation/AI quick-review candidates

2. REQUEST CRM Request List shell
   - route: `/crm/requests`
   - table/list of mock requests
   - read-only filters from the UI filter/sort spec
   - search/filter/sort UI may update local view state only
   - row click may route to a placeholder or existing planned detail path only if safe; if detail shell is not in this wave, show a disabled/coming-soon state instead
   - status, priority, severity, owner, source, linked object, and SLA/attention badges where mock data supports it
   - no live mutations

## Route/nav behavior
Use existing REQUEST CRM route/nav helpers from TICKET-003A where possible.

Allowed route additions:

- `/crm`
- `/crm/dashboard`
- `/crm/requests`

Expected behavior:

- `/crm` redirects to `/crm/dashboard` when the shell is enabled and user is authorized.
- route/nav hidden when REQUEST CRM shell flag is OFF.
- route/nav available only to authorized shared-admin roles.
- no public, employee, or customer exposure.

## Feature flags
Reuse the existing flag model.

Required:

- `ENABLE_REQUEST_CRM_FRONTEND_SHELL`

If a more specific dashboard/list flag is already defined in docs and fits the existing code pattern, RORK may add it, default OFF. Otherwise, keep this sub-slice under the master frontend shell flag.

Do not create runtime flag enforcement. Runtime flags remain central Automation & AI Center concern.

## Permissions
Reuse the existing `requests.*` permission module from TICKET-003A.

Minimum route permission:

- `requests.view`

Do not grant access outside shared admin roles.

## Mock data
Use the REQUEST CRM package mock data as authoring source.

Create or extend typed in-`src` fixtures under:

- `web-cleanops/src/lib/requestCrm/mockData/`

Every fixture must remain visibly test/demo data and preserve or add:

- `isTestData: true`
- `testBatchId` where available

No localStorage authority.
No Supabase writes.
No network mutations.

## Automation & AI Center boundary
Dashboard/list may show display-only quick-review indicators and central source-of-truth references.

REQUEST CRM must not own or implement central automation or AI policy.

Use labels such as:

- `Source of truth: Automation & AI Center`
- `Display only in REQUEST CRM`
- `Managed centrally later`

## Hard non-goals
Do not implement anything outside the positive scope.

Do not implement:

- backend/domain schema
- Supabase migrations
- database writes
- live request creation
- request detail three-column shell
- live notification engine
- live AI provider
- automation runner
- rule builder
- runtime guard enforcement
- kill switch enforcement
- circuit breaker enforcement
- email outbox/inbound email
- customer/employee portal exposure
- irreversible domain mutations

Do not modify unrelated existing flows.

## Tests / verification
Add focused tests where appropriate.

Minimum verification expectations:

- dashboard route hidden when flag OFF and available when flag ON + authorized permission
- request list route hidden when flag OFF and available when flag ON + authorized permission
- dashboard renders mock summary cards and clear mock/read-only indicators
- request list renders mock rows and read-only filters
- filter/search/sort UI does not trigger network or mutation behavior
- unauthorized roles remain blocked/not exposed
- Automation & AI Center indicators are display-only

Run focused tests/checks for changed code and the standard repo check flow if feasible.

If unrelated baseline failures appear, document them briefly without naming unrelated workstreams unless required by a failing file path. Do not fix unrelated baseline failures in this wave.

## Required output in GitHub
When done, update:

- `web-cleanops/docs/ai-handoff/05-ticket-registry.md`
- `web-cleanops/docs/ai-handoff/03-rork-outbox.md`
- `web-cleanops/docs/ai-handoff/06-verification-report.md`

The outbox must include:

- files inspected
- files changed
- flags used/added
- routes added
- nav behavior
- permission behavior
- mock data strategy
- tests/checks run
- any deviations
- risks/open issues

## Conversation reply policy
After completing the wave, RORK must not paste a long report in the RORK conversation.

RORK must follow:

- `web-cleanops/docs/ai-handoff/07-rork-conversation-reply-policy.md`
- `web-cleanops/docs/ai-handoff/08-rork-execution-discipline.md`

In the RORK conversation, only write the short completion or blocked signal.

## Stop conditions
Stop and mark BLOCKED if:

- required REQUEST CRM docs cannot be found,
- required Automation & AI Center canonical docs cannot be found,
- implementing this safely requires backend/product mutations,
- feature flags or permission patterns are unclear enough to risk exposing UI incorrectly,
- or tests/checks show failures that cannot be safely fixed within this narrow ticket.
