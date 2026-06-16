# Automation & AI Center - RORK Package

See `VERSION.md` for current package version and lineage. See `QA_REVIEW_REPORT_V3.md` for validation notes.

## Runtime safety update

This package now includes the `Runtime Safety & Performance Guard` extension.

Automation & AI Center is not only a future place to view deterministic automations and AI-assisted actions. It is also the control plane for safety visibility around runaway functions, request loops, rate limits, circuit breakers, feature kill switches, module health, runtime incidents, and performance/resilience gates.

The enforcement logic may live in several layers: Cloudflare/WAF, API layer, Supabase Edge Functions, backend/domain services, database policies/functions, background workers, and frontend guards. Automation & AI Center is the central place where these controls are registered, reviewed, logged, and followed up.

## Execution instruction

This package is a technical source-of-truth package for the future Automation & AI Center.

RORK/Claude must not start implementation directly from these documents.

Required first step:

1. Read this full package.
2. Inspect the current repository.
3. Produce an implementation plan only.
4. Do not write code in the first response.
5. Do not build the real automation execution engine yet.
6. Do not build real AI execution yet.
7. Do not add hidden automation logic inside feature modules.
8. Do not add hidden runtime safety logic that cannot be discovered from Automation & AI Center.
9. Do not implement live throttling, kill switches, circuit breakers, production rate limits, live session quarantine, or live alert routing in Slice 1.

The first shippable implementation after the plan is approved should be a Super Admin front-end shell with mock data.

## Primary goal

Create a future control plane for all deterministic automations, AI-assisted actions, runtime safety controls, incident visibility, and performance guardrails across Stadportalen/CleanOps.

The module name is:

`Automation & AI Center`

Recommended primary route:

`/super-admin/automation-ai-center`

Optional short alias if routing conventions support it:

`/auto-ai-center`

## Architectural source of truth

Automation & AI Center is the single source of truth for:

- automation registry
- automation visibility
- automation status
- risk level
- execution mode
- approval requirement
- execution history
- audit log
- AI extension status
- AI permissions
- module coverage
- operational review
- runtime safety limits
- runtime guard policies
- rate limiting policies
- resource quota visibility
- circuit breaker status
- feature runtime flags and kill switches
- session/user/company/module throttling visibility
- runtime incident history
- module health status
- performance budgets and resilience gates

Feature modules may show quick local reviews or local safety indicators, but they must not become independent sources of truth for automation configuration, runtime safety policy, kill switch state, or incident history.

## Do not overbuild now

The initial implementation is not the real engine and not the real enforcement layer.

Build now:

- Super Admin route
- page shell
- navigation structure
- dashboard cards
- mock auto-action registry
- module coverage view
- mock runtime guard policy registry
- filters
- action detail layout
- AI extension placeholder sections
- approval queue placeholder
- execution log placeholder
- runtime safety placeholder sections
- runtime guard policy placeholder sections
- incidents placeholder sections
- module health placeholder sections
- limits/quotas placeholder sections
- documentation/architecture links if suitable

Do not build now:

- real automation runner
- real policy engine
- real AI tool execution
- real approval mutation flow
- real kill switch enforcement
- real request throttling enforcement
- real circuit breaker enforcement
- production incident alert routing
- live session/user/company throttling or quarantine
- database migrations for production execution/enforcement
- no-code rule builder
- module-specific hidden automations
- hidden module-specific safety exceptions

## Read order

1. `VERSION.md`
2. `QA_REVIEW_REPORT_V3.md`
3. `rork/00_START_HERE.md`
4. `rork/01_CLAUDE_XHIGH_IMPLEMENTATION_PLAN_REQUEST.md`
5. `docs/architecture/automation-ai-center/00_INDEX.md`
6. `docs/architecture/automation-ai-center/01_ARCHITECTURE.md`
7. `docs/architecture/automation-ai-center/02_UNIVERSAL_AUTO_ACTION_MODEL.md`
8. `docs/architecture/automation-ai-center/03_AI_EXTENSION_MODEL.md`
9. `docs/architecture/automation-ai-center/04_MODULE_INTEGRATION_STANDARD.md`
10. `docs/architecture/automation-ai-center/05_AUTOMATION_READINESS_CHECKLIST.md`
11. `docs/architecture/automation-ai-center/06_RISK_POLICY_AND_APPROVAL_MODEL.md`
12. `docs/architecture/automation-ai-center/07_ANTI_PATTERNS_AND_NON_NEGOTIABLES.md`
13. `docs/architecture/automation-ai-center/08_FIRST_IMPLEMENTATION_SLICES.md`
14. `docs/architecture/automation-ai-center/09_FRONTEND_SHELL_SPEC.md`
15. `docs/architecture/automation-ai-center/10_DOMAIN_EVENT_CATALOG.md`
16. `docs/architecture/automation-ai-center/11_TESTING_AND_QA_STANDARD.md`
17. `docs/architecture/automation-ai-center/12_RUNTIME_SAFETY_AND_PERFORMANCE_GUARD.md`
18. `docs/architecture/automation-ai-center/13_RATE_LIMITING_AND_RESOURCE_QUOTAS.md`
19. `docs/architecture/automation-ai-center/14_CIRCUIT_BREAKERS_KILL_SWITCHES_AND_LIMITED_MODE.md`
20. `docs/architecture/automation-ai-center/15_RUNTIME_INCIDENTS_AND_ALERTING.md`
21. `docs/architecture/automation-ai-center/16_FRONTEND_LOOP_PROTECTION_STANDARD.md`
22. `docs/architecture/automation-ai-center/17_PERFORMANCE_TESTING_STANDARD.md`
23. `docs/architecture/automation-ai-center/18_RESILIENCE_DEFINITION_OF_DONE.md`
24. `docs/architecture/automation-ai-center/19_RUNTIME_GUARD_CANONICAL_MODEL.md`
25. `filters/UI_FILTER_SPEC.md`
26. `schemas/*`
27. `mock-data/*`
28. `contracts/*`

## Deliverable expected from RORK first

A written implementation plan only, including:

- current repository route/nav analysis
- proposed file structure
- components to create/reuse
- mock data strategy
- state management strategy
- UI pages and route path
- risk of conflicts with existing patterns
- runtime safety UI placement
- runtime guard policy UI placement
- feature flag/kill switch UI placement
- incident/logging UI placement
- performance and resilience test plan
- what will not be implemented in Slice 1
- exact Slice 1 execution plan

After the implementation plan is approved, use `rork/02_SLICE_1_FRONTEND_SHELL_PROMPT.md`.
