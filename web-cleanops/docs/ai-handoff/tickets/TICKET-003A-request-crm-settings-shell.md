# TICKET-003A - REQUEST CRM Settings Shell

## Goal
Implement the first controlled REQUEST CRM build slice: a frontend-only, feature-flagged REQUEST CRM Settings Shell.

This is a narrow Slice 0 sub-slice. Build settings first so REQUEST CRM can later use consistent categories, request types, statuses, labels, SLA placeholders, visibility/access defaults, notification labels, internal task labels, AI policy placeholders, and Automation & AI Center links.

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

Do not discuss unrelated paused workstreams such as Calculator V2, TypeScript cleanup, or Auth/Admin Lifecycle unless this ticket explicitly references them. It does not.

## Required docs to inspect
Before coding, inspect the relevant current docs only:

- `web-cleanops/docs/architecture/request-crm/implementation-plan.md`
- `web-cleanops/docs/architecture/request-crm/27-slice-0-frontend-shell.md`
- `web-cleanops/docs/architecture/request-crm/20-feature-flags.md`
- `web-cleanops/docs/architecture/request-crm/21-test-data-and-mock-data-policy.md`
- `web-cleanops/docs/architecture/request-crm/25-automation-ai-center-alignment.md`
- `web-cleanops/docs/architecture/request-crm/26-runtime-safety-performance-alignment.md`
- `web-cleanops/docs/ui/request-crm/01-request-crm-navigation-and-routes.md`
- `web-cleanops/schemas/request-crm/request-settings-shell.schema.json`
- `web-cleanops/mock-data/request-crm/settings-shell.seed.json`
- `web-cleanops/contracts/typescript/request-crm/request-crm-contracts.ts`
- `web-cleanops/docs/architecture/automation-ai-center/00-automation-ai-center-index.md`

If the Automation & AI Center canonical docs are not present at the path above, mark this ticket BLOCKED and write the reason in the outbox. Do not infer from chat history.

## Scope
Implement frontend/design only for the REQUEST CRM Settings Shell.

Target route:

- `/crm/settings`
- optional `/crm/settings/:tab` if it matches existing routing style and is safer for tabs/deep links

This must be shared admin only:

- `super_admin`
- `company_admin`

This must be hidden from:

- `employee`
- `customer`
- public/unauthenticated visitors

Everything must be behind feature flags defaulting OFF.

## Required settings sections
Create a polished settings shell with tabs/cards for:

1. General
2. Categories
3. Request Types
4. Statuses
5. Priority & Severity
6. SLA Defaults
7. Visibility & Access
8. Notifications
9. Internal Posts & Tasks
10. AI & Automation
11. Runtime Safety Links

These sections should render from typed registry/mock data where practical.

## UX/design requirements
Use the existing app design system and conventions:

- existing DashboardLayout / admin route styling
- shadcn/ui primitives already present in the repo
- cards, panels, tabs, badges, empty states, disabled controls
- clear `Mock` / `Read-only` / `Slice 0` badges
- warnings for future AI/automation/runtime-safety behavior
- visible link/reference to Automation & AI Center as source of truth for central automation and AI policy
- no visual rule builder
- no real save/update flows
- all write controls must be disabled or clearly non-functional placeholders

## Implementation requirements
Additive implementation only. Keep changes small and isolated.

Expected allowed code areas:

- `web-cleanops/src/lib/featureFlags.ts`
- `web-cleanops/src/lib/permissions.ts`
- `web-cleanops/src/App.tsx`
- `web-cleanops/src/components/layout/DashboardLayout.tsx`
- `web-cleanops/src/pages/crm/`
- `web-cleanops/src/components/crm/`
- `web-cleanops/src/lib/requestCrm/`
- `web-cleanops/src/lib/requestCrmSettingsTabs.ts` or equivalent registry file
- colocated tests for the new shell/registry/route behavior

If a different file must be modified, explain why in the outbox.

## Feature flags
Use the existing `envFlag()` convention in `src/lib/featureFlags.ts`.

Required flags for this sub-slice:

- `ENABLE_REQUEST_CRM_FRONTEND_SHELL`
- `ENABLE_REQUEST_CRM_SETTINGS_SHELL`
- `ENABLE_REQUEST_CRM_AUTOMATION_QUICK_REVIEW`

Default: OFF.

The settings route/nav must not appear when the relevant flags are OFF.

## Permissions
Use the existing permission module pattern in `src/lib/permissions.ts`.

Add a REQUEST/CRM permission module if it does not already exist.

Minimum permissions:

- `requests.view`
- `requests.manage`
- `requests.settings.view`
- `requests.settings.manage`

Grant initial admin access only to:

- `super_admin`
- `company_admin`

Do not grant to employee/customer in this slice.

## Mock data
Use the REQUEST CRM mock/settings package as the authoring source:

- `web-cleanops/mock-data/request-crm/settings-shell.seed.json`

Because Vite does not normally import from repo-root `mock-data/`, create a typed in-src fixture/adapter layer under:

- `web-cleanops/src/lib/requestCrm/mockData/`

Every mock entity must be visibly test/demo data and must include or preserve:

- `isTestData: true` where available
- `testBatchId` where available

No localStorage authority.
No Supabase writes.
No network mutations.

## Automation & AI Center boundary
REQUEST CRM Settings Shell may show display-only links/status/placeholder rows for Automation & AI Center.

It must not own or implement:

- central automation registry
- AI extension registry
- risk policy
- approval policy
- runtime guard policy
- kill switch state
- circuit breaker state
- execution logs
- incident logs
- performance/resilience gates

The UI should make this boundary visible with labels such as:

- `Source of truth: Automation & AI Center`
- `Display only in REQUEST CRM`
- `Managed centrally later`

## Hard non-goals
Do not implement:

- backend/domain schema
- Supabase migrations
- database writes
- live request creation
- real request categories persistence
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

Do not modify protected domains:

- Booking Queue
- WorkOrders/service rows
- Mission Log
- Time Reporting
- Calculator V2

## Tests / verification
Add focused tests where appropriate.

Minimum verification expectations:

- settings shell registry renders all required sections
- settings route/nav hidden when flags OFF
- settings route/nav available when flags ON for `super_admin` / `company_admin`
- employee/customer/public access remains blocked or not exposed
- mock/read-only controls do not trigger mutations
- Automation & AI Center references are display-only

Run the repository's standard check flow for changed code. At minimum, run the relevant TypeScript/build/test/lint commands available in the repo, or the existing project check helper if that is the established convention.

If any existing unrelated baseline failure appears, document it clearly in the verification report and do not hide it.

## Required output in GitHub
When done, update:

- `web-cleanops/docs/ai-handoff/05-ticket-registry.md`
- `web-cleanops/docs/ai-handoff/03-rork-outbox.md`
- `web-cleanops/docs/ai-handoff/06-verification-report.md`

The outbox must include:

- files inspected
- files changed
- feature flags added/used
- route(s) added
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
- implementing this safely requires migrations/backend/product mutations,
- feature flags or permission patterns are unclear enough to risk exposing UI incorrectly,
- or tests/checks show failures that cannot be safely fixed within this narrow ticket.
