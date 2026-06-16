# TICKET-003D-R - REQUEST CRM Entitlement + Module Visibility Alignment

## Goal
Re-scope the stopped WAVE-003D so REQUEST CRM visibility follows the existing Services -> Modules architecture instead of bypassing it with route-only or feature-flag-only preview logic.

This is a corrective frontend/architecture-alignment wave. The user has clarified that REQUEST CRM is not primarily a Super Admin operational tool. REQUEST CRM operational handling is primarily for:

- Company Admin
- Customer
- Employee

Super Admin controls platform availability, paid add-ons, company entitlement, templates/system templates, and governance.

## Product clarification from owner
Existing architecture already has two relevant control layers:

### Company Admin Settings -> Modules
The Company Admin settings page already has a Modules area with module availability such as:

- Admin Requests
- Employee & Customer Requests

These currently show as "Not available" in the user's environment.

### Super Admin Services / Catalogue / Companies / History / Billing
Super Admin already has an entitlement/add-on model where services can be globally managed and granted per company as Disabled / Trial / Enabled. The Company Admin still controls whether an entitled feature is switched on in their own settings.

Examples in the existing Super Admin Services model include Notification Center and other billable add-ons. REQUEST CRM must align with this existing pattern.

## Complexity gate
This wave must not create a new module/access/entitlement system.

If alignment cannot be done safely within the existing Services -> Company Modules model, stop and mark BLOCKED with a precise explanation of what is missing.

Do not implement backend, migrations, database writes, live request handling, live notification delivery, live AI, or automation execution.

## Positive scope
Scope: this active wave only.

In scope:

- inspect the existing Super Admin Services entitlement/catalogue/company-access model;
- inspect the existing Company Admin Settings -> Modules model;
- locate the current module keys/configuration for Admin Requests and Employee & Customer Requests;
- determine why Admin Requests and Employee & Customer Requests show as Not available in the user's environment;
- determine whether matching Super Admin service entitlement keys already exist for these request modules;
- align REQUEST CRM frontend visibility with the existing entitlement -> module availability -> company activation model;
- keep this frontend/mock/read-only unless an existing mock/config layer is already used for module availability;
- place Company Admin configuration under Settings routes:
  - `/settings/request`
  - `/settings/crm`
- ensure operational REQUEST surfaces are Company Admin-first, not Super Admin-first;
- document the correct IA/RBAC model and any gaps discovered.

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
Before changing anything, inspect and report the actual existing structures. Search by names/keys, not assumptions.

Required areas to inspect:

- Company Admin Settings / Modules implementation
- module registry/config for:
  - Admin Requests
  - Employee & Customer Requests
- Super Admin Services / Catalogue / Companies / History / Billing implementation
- service catalogue / entitlement registry / company service access model
- Notification Center entitlement pattern, because it is a similar paid add-on controlled by Super Admin and later activated/used by company users
- existing REQUEST CRM pages/components from TICKET-003A/003B
- existing request/crm feature flags and permission helpers
- existing Settings route/nav structure
- existing docs:
  - `web-cleanops/docs/architecture/request-crm/preview-enablement.md`
  - `web-cleanops/docs/architecture/request-crm/20-feature-flags.md`
  - `web-cleanops/docs/architecture/request-crm/25-automation-ai-center-alignment.md`
  - `web-cleanops/docs/architecture/request-crm/26-runtime-safety-performance-alignment.md`

## Required architecture rule
REQUEST CRM visibility must follow this chain:

1. Super Admin grants company access through the existing Services / Catalogue / Companies / Billing entitlement model.
2. Company Admin sees the entitled module as available in Settings -> Modules.
3. Company Admin activates the module in Settings -> Modules.
4. Once active, Company Admin sees the operational request surfaces and related settings.
5. Customer/Employee request surfaces come later and must be gated by their own role-specific module access.

Do not bypass this chain with a separate feature flag, hardcoded nav override, or route-only preview path.

## User-facing IA target
### Company Admin operational surfaces
Company Admin should be the primary operational user for request handling.

Target surfaces may use the existing built pages, but the visibility model must be aligned first:

- request dashboard
- request inbox/list
- request handling preview

The exact operational route may be proposed if the current `/crm/dashboard` naming conflicts with the desired IA. Do not rename routes broadly unless the existing code makes it safe and narrowly scoped.

### Company Admin Settings
Request/CRM configuration must live under Settings:

- `/settings/request`
- `/settings/crm`

`/settings/request` should represent request-handling configuration, such as categories, request types, statuses, priorities, SLA, visibility/access, notifications, and internal tasks.

`/settings/crm` should represent CRM/module governance configuration, such as general module setup, Automation & AI Center references, runtime-safety links, and template linkage where appropriate.

### Super Admin
Super Admin is not the primary operational request-handler user.

Super Admin controls:

- global service availability;
- company entitlement/access;
- disabled/trial/enabled status;
- paid add-on packaging/billing;
- global templates and system templates;
- what Company Admin can copy/edit locally;
- governance/history/audit.

Do not mix Super Admin module-control work into the Company Admin operational request center in this wave.

## Acceptable outcomes
This wave may end in one of two acceptable states:

### Option A - Frontend alignment implemented
If the existing Services -> Modules structures are clear and can be aligned safely without backend or broad rewrites, implement the smallest frontend/mock/read-only correction that:

- makes Admin Requests / Employee & Customer Requests available only when the existing entitlement model says they are available;
- makes Company Admin operational request surfaces visible only after the relevant module is active;
- adds or corrects `/settings/request` and `/settings/crm` routes/nav;
- keeps Super Admin out of the primary operational request flow;
- preserves all authorization and mock/read-only behavior.

### Option B - Blocked with exact gap report
If the required entitlement keys, module keys, or existing linkage are missing or unclear, stop and mark BLOCKED with:

- exact files inspected;
- what exists today;
- what is missing;
- which keys/entities should be introduced in a later architecture/implementation wave;
- the smallest safe next ticket.

Do not guess or invent a parallel model.

## Hard non-goals
Do not implement:

- backend/domain schema
- Supabase migrations
- database writes
- new entitlement database model
- new module registry separate from the existing one
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
- public/customer/employee request portal surfaces
- irreversible domain mutations

Do not weaken authorization.
Do not modify unrelated existing flows.

## Permissions / RBAC
Respect the intended roles:

- Super Admin: platform owner, entitlement/template/governance control, optional preview only.
- Company Admin: primary operational request handler and local settings owner.
- Employee: future employee-facing request/task/notification surfaces.
- Customer: future customer-facing request/notification surfaces.

Do not expose Company Admin request settings to Employee/Customer.
Do not expose operational request handling to Super Admin as if Super Admin were the primary company operator.

## Notification Center note
Notification Center follows the same strategic pattern:

- Super Admin controls global/company entitlement and paid add-on availability.
- Company Admin controls local activation/settings once available.
- Employee/Customer/Admin receive role-appropriate notifications later.

Do not build Notification Center in this wave, but note any reusable entitlement/module pattern discovered.

## Templates / system templates note
Super Admin must eventually be able to create global templates/system templates that Company Admin can copy/edit locally where allowed.

Do not build templates in this wave. Only document how this should relate to REQUEST CRM if the inspected architecture already has a template pattern.

## Tests / verification
If code changes are made, add focused tests for changed behavior.

Minimum expectations if implemented:

- when company entitlement is unavailable, Admin Requests / Employee & Customer Requests remain Not available;
- when company entitlement is available, Company Admin can see the module as available in Settings -> Modules;
- when module is active, Company Admin can access the operational request preview;
- `/settings/request` and `/settings/crm` render for authorized Company Admin only;
- Super Admin entitlement/control paths remain separate from Company Admin operational request handling;
- Employee/Customer remain blocked from admin settings;
- no backend/network mutations are introduced;
- mock/read-only indicators remain visible.

If no code is changed, verification must be by inspection and the outbox must explain why implementation was not safe yet.

## Required output in GitHub
When done, update:

- `web-cleanops/docs/ai-handoff/05-ticket-registry.md`
- `web-cleanops/docs/ai-handoff/03-rork-outbox.md`
- `web-cleanops/docs/ai-handoff/06-verification-report.md`

Also update or create an architecture note if needed:

- `web-cleanops/docs/architecture/request-crm/entitlement-module-visibility-alignment.md`

The outbox must include:

- actual existing Services entitlement structure found;
- actual existing Company Admin Modules structure found;
- current state of Admin Requests and Employee & Customer Requests;
- whether matching Super Admin service keys exist;
- whether implementation was performed or BLOCKED;
- files inspected;
- files changed;
- tests/checks run;
- exact recommended next ticket.

## Conversation reply policy
After completing the wave, RORK must not paste a long report in the RORK conversation.

RORK must follow:

- `web-cleanops/docs/ai-handoff/07-rork-conversation-reply-policy.md`
- `web-cleanops/docs/ai-handoff/08-rork-execution-discipline.md`

In the RORK conversation, only write the short completion or blocked signal.

## Stop conditions
Stop and mark BLOCKED if:

- alignment would require a new backend entitlement/module model;
- existing service/module keys cannot be found or confidently linked;
- implementation would bypass Services -> Modules architecture;
- authorization would be weakened;
- customer/employee/public surfaces would be exposed prematurely;
- or implementation would require touching unrelated domains.
