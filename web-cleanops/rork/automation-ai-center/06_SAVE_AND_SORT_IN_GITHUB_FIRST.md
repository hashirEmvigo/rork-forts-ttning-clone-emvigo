# Automation & AI Center Runtime Safety v3 - GitHub Documentation Intake First

Task: documentation intake and repository organization only.

Do not implement product code.
Do not create routes/pages.
Do not create UI components.
Do not create migrations.
Do not create a live automation runner.
Do not create live AI execution.
Do not implement production rate limiting, kill switches, circuit breakers, runtime guards, alert routing, incident processing, or enforcement logic.
Do not start Slice 1 yet.
Do not create an implementation plan in this step unless explicitly requested after this documentation intake is complete.

## Required intake steps

1. Unpack and inspect the full package.

2. Save and sort the package into the GitHub repository using the package structure and existing repo documentation conventions.

Preferred target structure:

```text
docs/architecture/automation-ai-center/
- 00_INDEX.md
- 01_ARCHITECTURE.md
- 02_UNIVERSAL_AUTO_ACTION_MODEL.md
- 03_AI_EXTENSION_MODEL.md
- 04_MODULE_INTEGRATION_STANDARD.md
- 05_AUTOMATION_READINESS_CHECKLIST.md
- 06_RISK_POLICY_AND_APPROVAL_MODEL.md
- 07_ANTI_PATTERNS_AND_NON_NEGOTIABLES.md
- 08_FIRST_IMPLEMENTATION_SLICES.md
- 09_FRONTEND_SHELL_SPEC.md
- 10_DOMAIN_EVENT_CATALOG.md
- 11_TESTING_AND_QA_STANDARD.md
- 12_RUNTIME_SAFETY_AND_PERFORMANCE_GUARD.md
- 13_RATE_LIMITING_AND_RESOURCE_QUOTAS.md
- 14_CIRCUIT_BREAKERS_KILL_SWITCHES_AND_LIMITED_MODE.md
- 15_RUNTIME_INCIDENTS_AND_ALERTING.md
- 16_FRONTEND_LOOP_PROTECTION_STANDARD.md
- 17_PERFORMANCE_TESTING_STANDARD.md
- 18_RESILIENCE_DEFINITION_OF_DONE.md
- 19_RUNTIME_GUARD_CANONICAL_MODEL.md

docs/adr/
- ADR-0001-automation-ai-center-single-source-of-truth.md
- ADR-0002-no-special-case-automation-logic.md
- ADR-0003-ai-actions-must-attach-to-auto-actions.md
- ADR-0004-domain-modules-own-domain-logic.md
- ADR-0005-runtime-safety-guard-control-plane.md
- ADR-0006-performance-resilience-gates.md
- ADR-0007-runtime-guards-use-canonical-lifecycle.md

schemas/automation-ai-center/
- JSON schemas from this package.

mock-data/automation-ai-center/
- automation actions
- AI extensions
- approval queue
- execution log
- module coverage
- runtime safety limits
- runtime incidents
- feature runtime flags
- module health
- performance budgets
- runtime guard policies

contracts/typescript/automation-ai-center/
- TypeScript contracts from this package.

filters/automation-ai-center/
- UI filter specs and seeds.

rork/automation-ai-center/
- RORK instructions, planning prompts, Slice 1 prompt, code review gate and PR template.
```

3. If the repository already has matching conventions, adapt paths carefully but preserve separation of concerns: architecture, ADRs, schemas, mock data, contracts, filters, RORK instructions.

4. Update discoverability indexes:
- `docs/architecture/automation-ai-center/00_INDEX.md` must link all Automation & AI Center architecture files in reading order.
- If `docs/architecture/README.md` exists, add a link/section for Automation & AI Center.
- If the repo has a root docs index, add a link there if appropriate.

5. Avoid duplicate/conflicting documentation.
If older Automation & AI Center docs already exist:
- do not silently overwrite unless clearly obsolete;
- mark older docs as superseded if needed;
- add a short note that `v3-runtime-safety-master-review` is the current canonical package.

6. Preserve these non-negotiable architecture rules:

Automation & AI Center is the single source of truth for:
- automation registry
- AI extensions
- risk levels
- execution policy
- approval policy
- runtime guard policy
- runtime flags and kill switches
- circuit breaker visibility
- execution logs
- incident logs
- central automation/AI history
- runtime safety/performance/resilience gates

Domain modules may own local domain logic and technical enforcement, but they must not own hidden automation policy, AI policy, runtime guard state, kill switch state, or execution/incident history as separate source-of-truth models.

Every future auto-action or AI-action must fit the canonical lifecycle:

```text
Trigger -> Condition -> Risk level -> Guard action -> Runtime flag -> Execution/incident log -> Alert/follow-up -> Resolution
```

7. Return only:
- list of files added
- list of files updated
- list of files marked superseded, if any
- final documentation tree
- any path deviations from the requested structure
- any conflicts or missing files found
- confirmation that no product code, routes, UI, migrations, live automation, live AI, runtime guard enforcement, kill switch enforcement, circuit breaker enforcement, or implementation plan was created

Stop after documentation organization.
