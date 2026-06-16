# START HERE - Automation & AI Center

## Role

You are implementing only after reading the full package and inspecting the current repository.

Do not begin coding in the first response.

## Fixed product decision

The product will have a Super Admin module called:

`Automation & AI Center`

It is the control plane for deterministic automations, optional AI extensions, approval visibility, execution history, module coverage, runtime safety controls, feature kill switches, runtime incidents, module health, and performance guardrails.

## Core architecture decision

Automation & AI Center is the single source of truth for automation visibility and governance.

AI actions must attach to registered auto-actions.

Runtime safety controls must be centrally discoverable. Rate limits, quotas, circuit breakers, kill switches, module health, session/user/company throttling, and runtime incidents must not become hidden module-specific logic.

Domain modules still own their domain logic and domain mutations.

## What to do first

1. Read this package.
2. Inspect the repository.
3. Identify route/nav/layout conventions.
4. Identify existing Super Admin patterns.
5. Identify existing table/card/badge/filter patterns.
6. Identify any existing logging, error boundary, feature flag, rate limit, or observability patterns.
7. Produce an implementation plan only.

## What not to do first

Do not build:

- live automation engine
- live AI execution
- live approval mutations
- live customer notifications
- live domain mutations
- no-code rule builder
- hidden automation logic
- live throttling
- live kill switch toggles
- live circuit breaker enforcement
- production alert routing
- DB migrations for production execution/enforcement without approved plan

## First approved build target

A front-end shell with mock data:

- route
- navigation
- dashboard cards
- auto-actions table
- filters
- action detail
- AI extensions
- approval queue
- execution log
- risk/policies
- test mode
- module coverage
- runtime safety overview
- limits/quotas
- runtime incidents
- feature flags / kill switches
- module health
- performance budgets

Everything should be clearly non-live if using mock data.
