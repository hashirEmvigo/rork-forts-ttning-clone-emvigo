# Architecture Documentation

This folder contains CleanOps / Städportalen architecture documentation. Start with
`00-architecture-index.md` for the full, annotated map of every architecture area.

## Canonical packages

- **request-crm/** - REQUEST CRM Communications Platform v0.2 (Automation & AI Center aligned). Start at `request-crm/00-index.md`.
- **automation-ai-center/** - Automation & AI Center Runtime Safety v3 (`v3-runtime-safety-master-review`): the single source of truth for the automation registry, AI extensions, risk levels, runtime guards, kill switches, circuit breaker visibility, execution/incident logs, performance/resilience gates and module health. Start at `automation-ai-center/00-automation-ai-center-index.md`.

## Other areas

- **Repository handoff:** see `../repository/README.md` for the current active repository source-of-truth and RORK/GitHub workflow.
- **administration-center/** - planning blueprint for a future Super Admin Administration Center hub. Start at `administration-center/01-administration-center-architecture-blueprint.md`.
- **core-operations/** - operational foundation (Mission, Mission Log, Time Reporting, Payroll/Invoice Basis, execution).
- **schedule/** - scheduling, recurrence, occurrences, conflict detection, service-level packages.
- **ai/** - AI assistant feature notes (intake, knowledge base, handover, copilot). Distinct from the central automation governance plane in `automation-ai-center/`.
- **requests/** - earlier request-management notes (v0.1), superseded by `request-crm/`.
- **keys/** - KEYS / Access Management architecture (reserved).

## Decisions

Architecture decision records live in `/docs/adr/`. Both REQUEST CRM (`ADR-0001..0006`) and
Automation & AI Center (`ADR-0001..0007`) ADRs coexist there; the two sets share numeric
prefixes but use distinct topic slugs.

## Rule

Before changing architecture, read `/docs/00-master-index.md`, the project constitution and
data-authority policy under `/docs/governance/`, and the relevant area folder above.
