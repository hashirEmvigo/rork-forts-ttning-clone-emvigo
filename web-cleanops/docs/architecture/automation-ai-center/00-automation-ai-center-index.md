# Automation & AI Center - Architecture Index

Module name: `Automation & AI Center`
Package version: `v3-runtime-safety-master-review`
Status: documentation / architecture only (no live automation, no live AI, no runtime enforcement)
Audience: RORK / Claude XHigh / implementation agents

> This is the current canonical Automation & AI Center package, including Runtime
> Safety & Performance Guard. It is a standalone architecture package that is
> **required by** REQUEST / CRM and other domain modules, but is not owned by them.
> Original package provenance (manifest, version, QA review, checksums) lives in
> `/rork/automation-ai-center/_package/`.

## Purpose

Centralize visibility, governance, risk, execution history, approval requirements, optional AI extensions, runtime safety controls, performance guardrails, incident visibility, and operational resilience for all automation-relevant behavior in Städportalen / CleanOps.

## Core principle

Every automation must be a registered, inspectable, traceable action in a universal model.

AI must be an optional extension attached to a registered auto-action. AI must not become a separate hidden execution layer.

Runtime safety controls (rate limits, kill switches, circuit breakers, resource quotas, module health, incident follow-up) must be centrally discoverable, never hidden inside a feature module without central visibility.

## Reading order (architecture docs)

1. `01-automation-ai-center-architecture.md` - system purpose, boundaries, UI sections, source-of-truth rules, runtime safety placement.
2. `02-universal-auto-action-model.md` - canonical auto-action data and lifecycle model.
3. `03-ai-extension-model.md` - how AI attaches to existing auto-actions and how AI resource usage is protected.
4. `04-module-integration-standard.md` - how feature modules expose events, logs, quick-review compatibility, and safety requirements.
5. `05-automation-readiness-checklist.md` - required checklist for every new feature.
6. `06-risk-policy-and-approval-model.md` - risk levels, approval behavior, and operational guard actions.
7. `07-anti-patterns-and-non-negotiables.md` - rules that must not be violated.
8. `08-first-implementation-slices.md` - phased build strategy.
9. `09-frontend-shell-spec.md` - Slice 1 UI requirements.
10. `10-domain-event-catalog.md` - initial event catalog by module, including runtime/system events.
11. `11-testing-and-qa-standard.md` - test and review requirements.
12. `12-runtime-safety-and-performance-guard.md` - central model for throttling, quarantine, guard actions, module health, runtime safety.
13. `13-rate-limiting-and-resource-quotas.md` - concrete limit and quota strategy by scope and module.
14. `14-circuit-breakers-kill-switches-and-limited-mode.md` - circuit breaker, feature flag, kill switch, read-only, and limited-mode standard.
15. `15-runtime-incidents-and-alerting.md` - incident lifecycle, required fields, alerting, and follow-up.
16. `16-frontend-loop-protection-standard.md` - frontend protections against request loops, retry storms, polling leaks, subscription leaks.
17. `17-performance-testing-standard.md` - load, stress, spike, soak, frontend, API, database, and observability testing.
18. `18-resilience-definition-of-done.md` - release gate for performance, safety, and resilience.
19. `19-runtime-guard-canonical-model.md` - canonical guard lifecycle: Trigger → Condition → Risk → Guard action → Runtime flag → Logs/incidents → Alert/follow-up → Resolution.

## Single source of truth

Automation & AI Center is the single source of truth for:

- automation action registry
- AI extension registry
- risk levels
- execution policy
- approval policy
- runtime guard policy
- runtime flags and kill switches
- circuit breaker visibility
- execution logs
- incident logs
- performance / resilience gates
- module health
- central automation / AI history

Domain modules may own local domain logic and technical enforcement, but they must not own hidden automation policy, AI policy, runtime guard state, kill switch state, or execution / incident history as separate source-of-truth models.

## Canonical runtime guard lifecycle

Every future auto-action, AI-action, or runtime guard must map to the same generic lifecycle (no special-case logic per module):

```text
Trigger
  -> Condition
  -> Risk level
  -> Guard action
  -> Runtime flag
  -> Execution/incident log
  -> Alert/follow-up
  -> Resolution
```

## Related package locations (repo paths)

- Architecture docs: `/docs/architecture/automation-ai-center/` (this folder, `00`–`19`)
- ADRs: `/docs/adr/ADR-0001..ADR-0007` (automation-ai-center decisions; see note below)
- JSON schemas: `/schemas/automation-ai-center/`
- Mock / seed data: `/mock-data/automation-ai-center/`
- TypeScript contracts: `/contracts/typescript/automation-ai-center/`
- UI filter specs & seeds: `/filters/automation-ai-center/`
- RORK execution prompts & review gates: `/rork/automation-ai-center/`
- Original package provenance (manifest, version, QA review, checksums): `/rork/automation-ai-center/_package/`

> ADR note: `/docs/adr/` also contains REQUEST CRM ADRs numbered `ADR-0001..ADR-0006`.
> The Automation & AI Center ADRs (`ADR-0001..ADR-0007`) share those numeric prefixes
> but use distinct topic slugs, so they coexist as separate files. The numeric overlap
> is a known cross-package collision, not a duplicate.

## Dependency relationship

REQUEST / CRM (`/docs/architecture/request-crm/`) references this package as an external
dependency. See `request-crm/25-automation-ai-center-alignment.md` and
`request-crm/26-runtime-safety-performance-alignment.md`. Those documents point back to
this index as the canonical source of truth.

This package is distinct from `/docs/architecture/ai/`, which documents the customer / operational
**AI assistant feature**, not the central automation governance plane.

## Implementation gate (do not skip)

- No product code, routes, UI components, migrations, live automation runner, live AI execution,
  production rate limiting, kill switch enforcement, circuit breaker enforcement, runtime guard
  enforcement, incident routing, or live alert routing is authorized by this package.
- The first approved build is Slice 1: an Automation & AI Center frontend shell with mock /
  read-only data only (see `08-first-implementation-slices.md` and `09-frontend-shell-spec.md`).
- An implementation plan is produced only after this documentation intake, and only when explicitly requested.
