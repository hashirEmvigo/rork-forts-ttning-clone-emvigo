# 27 - Slice 0 Frontend Shell

## Objective

Build a click-through frontend shell that makes the REQUEST/CRM product understandable before backend logic is implemented.

## Scope

Routes may be adapted to current repo conventions, but target surfaces are:

```text
/crm
/crm/dashboard
/crm/requests
/crm/requests/:id
/crm/notifications
/crm/chat
/crm/settings
```

## Required screens

- CRM dashboard shell
- request list shell
- request detail shell with 3 columns
- notification center shell
- chat inbox/session shell
- settings shell
- automation quick-review placeholder components
- mock Runtime Safety/Automation & AI badges

## Data

Use static/mock data from `mock-data/` or repo-equivalent fixtures.

## Strict non-goals

Do not build:

- real request backend
- real notification runner
- real chat logic
- real AI provider integration
- real email outbox
- real automation engine
- real settings rule builder
- production kill switch/rate limiting/circuit breaker enforcement
- live customer/employee portal exposure

## Exit criteria

- User can navigate the full CRM/REQUEST concept.
- All major sections visibly align with Automation & AI Center.
- No hidden automation is introduced.
- Frontend is behind feature flag.
- Mock data is isolated.
