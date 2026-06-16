# Slice 0 Prompt - Frontend Shell Only

Use only after implementation plan has been reviewed and approved.

## Goal

Build a REQUEST/CRM frontend shell with mock/static data.

## Scope

- CRM navigation entry.
- Dashboard shell.
- Request list shell.
- Request detail 3-column shell.
- Notification Center shell.
- Chat inbox/session shell.
- Settings shell.
- Automation & AI Center quick-review placeholders.
- Runtime Safety mock badges.
- Feature flag gating.

## Data

Use package mock data or repo fixture conventions.

## Do not implement

- real backend mutations
- live notification runner
- live chat escalation
- real AI provider
- real email outbox
- production automation engine
- production runtime guards
- live kill switches
- live rate limiting
- live circuit breakers
- customer/employee portal exposure

## Done

- Full shell is navigable.
- Mock data renders consistently.
- Settings shell shows future configuration without live logic.
- Automation quick-review panels link conceptually to Automation & AI Center.
- All live actions are disabled/mock.
