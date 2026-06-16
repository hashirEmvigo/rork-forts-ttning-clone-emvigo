# TICKET-003F - REQUEST CRM Service Registry Key

## Goal
Add a registry-only `request_crm` service entry to the existing Super Admin Services model.

This implements the ratified Model 2 direction:

- Super Admin controls commercial/service availability through Services / Catalogue / Companies / Billing.
- Company Admin later sees and activates available modules in Settings -> Modules.
- Operational request handling remains Company Admin-first.
- Customer/Employee request surfaces remain later, role-specific surfaces.

This wave is intentionally small. It must create the service registry identity only. It must not change runtime access, routes, module availability, billing behavior, database schema, or authorization.

## Product decision
Sebastian approved Model 2.

Model 2 means REQUEST CRM is granted through the existing Services entitlement model first, then later bridges into Company Admin Settings -> Modules.

Super Admin Settings -> Modules remains for global activation/inactivation of functions. Super Admin Services remains the commercial entitlement/add-on layer.

## Positive scope
Scope: this active wave only.

In scope:

- inspect `serviceRegistry.ts`, `ServiceFeatureKey`, service tests, and nearby service catalogue patterns;
- add a `request_crm` service key to the existing registry/type model if the current structure supports it safely;
- describe it as a billable REQUEST CRM suite/service;
- use the existing diagnostic/display `affects` module seam to point to existing modules where supported:
  - `admin-requests`
  - `employee-customer-requests`
- add focused registry/type tests if existing tests/patterns exist;
- update docs/handoff reports.

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
Before changing anything, inspect:

- `web-cleanops/src/lib/serviceRegistry.ts`
- service feature key type definition, likely in `web-cleanops/src/types/index.ts` or nearby
- tests for `serviceRegistry` or `findInvalidModuleReferences`
- `web-cleanops/src/lib/modules.ts`
- `web-cleanops/docs/architecture/request-crm/entitlement-module-visibility-alignment.md`
- `web-cleanops/docs/architecture/request-crm/service-module-mapping-blueprint.md`
- current `03-rork-outbox.md`, `05-ticket-registry.md`, `06-verification-report.md`

## Required registry behavior
Add one service-suite entry, not multiple scattered keys.

Preferred key:

```txt
request_crm
```

Preferred label:

```txt
Request CRM
```

Intent:

```txt
Billable service suite for company-admin request handling, admin requests, employee/customer request intake, request settings, and later customer/employee request surfaces.
```

The service may use the existing `affects` display/diagnostic seam to reference:

- `admin-requests`
- `employee-customer-requests`

Important: in this wave, `affects` remains display/diagnostic only. It must not create runtime entitlement-to-module availability behavior.

## Hard non-goals
Do not implement:

- backend/domain schema
- Supabase migrations
- database writes
- new entitlement database model
- Service -> Module runtime bridge
- automatic module availability derivation
- company module activation changes
- route gating changes
- `/crm/*` access changes
- `/settings/request` or `/settings/crm` implementation
- live request creation
- real request persistence
- Notification Center work
- Action Center / Auto-Action Center work
- live notification engine
- live AI provider
- automation runner
- rule builder
- runtime guard enforcement
- kill switch enforcement
- circuit breaker enforcement
- email outbox/inbound email
- public/customer/employee request portal surfaces
- authorization weakening

Do not modify unrelated existing flows.

## Notification Center / Action Center note
Notification Center and Action Center / Auto-Action Center should follow the same strategic pattern later:

1. Super Admin service entitlement/add-on.
2. Company Admin module availability and local activation.
3. Role-specific operational surfaces.

Do not build or alter those modules in this wave. Only avoid decisions that would block the same pattern later.

## Tests / verification
If code changes are made, run focused tests for the registry/type layer.

Minimum expectations:

- `request_crm` is part of the service feature key set/type;
- service registry contains exactly one REQUEST CRM suite entry;
- existing service registry validation passes;
- `affects` module references point only to valid existing module IDs;
- no runtime access, route, module availability, authorization, database, or backend behavior changes.

If repo-wide baseline failures appear in unrelated files, document them without fixing them.

## Required output in GitHub
When done, update:

- `web-cleanops/docs/ai-handoff/05-ticket-registry.md`
- `web-cleanops/docs/ai-handoff/03-rork-outbox.md`
- `web-cleanops/docs/ai-handoff/06-verification-report.md`

Also update, if useful:

- `web-cleanops/docs/architecture/request-crm/service-module-mapping-blueprint.md`
- `web-cleanops/docs/architecture/request-crm/entitlement-module-visibility-alignment.md`

The outbox must include:

- files inspected;
- exact files changed;
- exact service key added;
- whether `affects` points at request modules;
- tests/checks run;
- confirmation of zero runtime/access/route/backend change;
- next recommended wave.

## Next expected wave after this
If this registry-only wave succeeds, the next wave should still be narrow:

- WAVE-003G — REQUEST CRM Service -> Module Bridge Plan or Bridge Slice

That later wave can decide/implement how `request_crm` entitlement affects Company Admin module availability. Do not implement that bridge now.

## Conversation reply policy
After completing the wave, RORK must not paste a long report in the RORK conversation.

RORK must follow:

- `web-cleanops/docs/ai-handoff/07-rork-conversation-reply-policy.md`
- `web-cleanops/docs/ai-handoff/08-rork-execution-discipline.md`

In the RORK conversation, only write the short completion or blocked signal.

## Stop conditions
Stop and mark BLOCKED if:

- the service registry cannot accept a new key safely;
- the service feature key type cannot be updated without broader architecture changes;
- valid module references cannot be confirmed;
- implementation would alter runtime gating/access/routes;
- implementation would require backend/migrations/database writes;
- implementation would touch Notification Center or Action Center behavior;
- authorization would be weakened;
- or implementation would require touching unrelated domains.
