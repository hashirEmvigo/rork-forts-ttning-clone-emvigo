# Package Manifest

## Root

- `README.md`
- `PACKAGE_MANIFEST.md`
- `VERSION.md`
- `UPDATE_SUMMARY_RUNTIME_SAFETY.md`
- `UPDATE_SUMMARY_MASTER_REVIEW_V3.md`
- `QA_REVIEW_REPORT_V3.md`
- `CHECKSUMS.json`

## RORK control prompts

- `rork/00_START_HERE.md`
- `rork/01_CLAUDE_XHIGH_IMPLEMENTATION_PLAN_REQUEST.md`
- `rork/02_SLICE_1_FRONTEND_SHELL_PROMPT.md`
- `rork/03_PER_FEATURE_AUTOMATION_AI_READINESS_SNIPPET.md`
- `rork/04_CODE_REVIEW_GATE.md`
- `rork/05_REPO_PR_DESCRIPTION_TEMPLATE.md`

## Architecture docs

- `docs/architecture/automation-ai-center/00_INDEX.md`
- `docs/architecture/automation-ai-center/01_ARCHITECTURE.md`
- `docs/architecture/automation-ai-center/02_UNIVERSAL_AUTO_ACTION_MODEL.md`
- `docs/architecture/automation-ai-center/03_AI_EXTENSION_MODEL.md`
- `docs/architecture/automation-ai-center/04_MODULE_INTEGRATION_STANDARD.md`
- `docs/architecture/automation-ai-center/05_AUTOMATION_READINESS_CHECKLIST.md`
- `docs/architecture/automation-ai-center/06_RISK_POLICY_AND_APPROVAL_MODEL.md`
- `docs/architecture/automation-ai-center/07_ANTI_PATTERNS_AND_NON_NEGOTIABLES.md`
- `docs/architecture/automation-ai-center/08_FIRST_IMPLEMENTATION_SLICES.md`
- `docs/architecture/automation-ai-center/09_FRONTEND_SHELL_SPEC.md`
- `docs/architecture/automation-ai-center/10_DOMAIN_EVENT_CATALOG.md`
- `docs/architecture/automation-ai-center/11_TESTING_AND_QA_STANDARD.md`
- `docs/architecture/automation-ai-center/12_RUNTIME_SAFETY_AND_PERFORMANCE_GUARD.md`
- `docs/architecture/automation-ai-center/13_RATE_LIMITING_AND_RESOURCE_QUOTAS.md`
- `docs/architecture/automation-ai-center/14_CIRCUIT_BREAKERS_KILL_SWITCHES_AND_LIMITED_MODE.md`
- `docs/architecture/automation-ai-center/15_RUNTIME_INCIDENTS_AND_ALERTING.md`
- `docs/architecture/automation-ai-center/16_FRONTEND_LOOP_PROTECTION_STANDARD.md`
- `docs/architecture/automation-ai-center/17_PERFORMANCE_TESTING_STANDARD.md`
- `docs/architecture/automation-ai-center/18_RESILIENCE_DEFINITION_OF_DONE.md`
- `docs/architecture/automation-ai-center/19_RUNTIME_GUARD_CANONICAL_MODEL.md`

## ADRs

- `docs/adr/ADR-0001-automation-ai-center-single-source-of-truth.md`
- `docs/adr/ADR-0002-no-special-case-automation-logic.md`
- `docs/adr/ADR-0003-ai-actions-must-attach-to-auto-actions.md`
- `docs/adr/ADR-0004-domain-modules-own-domain-logic.md`
- `docs/adr/ADR-0005-runtime-safety-guard-control-plane.md`
- `docs/adr/ADR-0006-performance-resilience-gates.md`
- `docs/adr/ADR-0007-runtime-guards-use-canonical-lifecycle.md`

## Schemas

- `schemas/automation-action.schema.json`
- `schemas/automation-execution.schema.json`
- `schemas/ai-extension.schema.json`
- `schemas/domain-event.schema.json`
- `schemas/approval-queue-item.schema.json`
- `schemas/module-coverage.schema.json`
- `schemas/ui-filter.schema.json`
- `schemas/runtime-safety-limit.schema.json`
- `schemas/runtime-incident.schema.json`
- `schemas/feature-runtime-flag.schema.json`
- `schemas/module-health.schema.json`
- `schemas/performance-budget.schema.json`
- `schemas/runtime-guard-policy.schema.json`

## Mock data

- `mock-data/automation-actions.seed.json`
- `mock-data/module-coverage.seed.json`
- `mock-data/approval-queue.seed.json`
- `mock-data/execution-log.seed.json`
- `mock-data/ui-filters.seed.json`
- `mock-data/runtime-safety-limits.seed.json`
- `mock-data/runtime-incidents.seed.json`
- `mock-data/feature-runtime-flags.seed.json`
- `mock-data/module-health.seed.json`
- `mock-data/performance-budgets.seed.json`
- `mock-data/runtime-guard-policies.seed.json`
- `mock-data/AUTOMATION_ACTIONS_SEED_SUMMARY.md`

## Filters

- `filters/UI_FILTER_SPEC.md`
- `filters/ui-filters.seed.json`

## Type contracts

- `contracts/automation-center.types.ts`
- `contracts/README.md`

## GitHub intake addendum

- `rork/06_SAVE_AND_SORT_IN_GITHUB_FIRST.md` - documentation intake first prompt for saving/sorting this package into GitHub before any planning or implementation.
- `MASTER_PACKAGE_NOTE.md` - explicit package role and dependency note.
