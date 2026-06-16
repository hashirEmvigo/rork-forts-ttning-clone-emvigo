# Architecture Documentation Index

## Purpose

This folder contains CleanOps architecture documentation.

Architecture documents define system boundaries, domain models, module behavior, data ownership principles, workflow rules and long-term technical direction.

Use this folder before implementing or changing any module-level behavior.

---

## Architecture Areas

### administration-center/

Contains the planning blueprint for a future Super Admin Administration Center hub. This is documentation-only and must not be treated as implementation approval.

Start at `administration-center/01-administration-center-architecture-blueprint.md` before proposing any Administration Center route, navigation, registry, search, permission, or settings-hub work.

### core-operations/

Contains the operational foundation for CleanOps, including the core operational build specification, operational execution architecture, rollout/backfill runbooks and Supabase validation patterns.

Start here when working with Mission, Mission Log, Time Reporting, Payroll Basis, Invoice Basis, operational execution or operational data flow.

### schedule/

Contains schedule-related architecture.

Start here when working with recurring bookings, schedule occurrences, one-off bookings, schedule preview, assignment variations, conflict detection, service-level scheduling rules or future AI-assisted scheduling.

### request-crm/  (current canonical package)

Contains the **REQUEST CRM Communications Platform v0.2 (Automation & AI Center aligned)** package. This is now the canonical planning source for the REQUEST / CRM communication domain: Request Manager, Notification Center, chat/AI intake, internal posts & tasks, email outbox/inbound, threads & visibility, settings shell and audit.

Start here for any REQUEST / CRM communication work. Begin with `request-crm/00-index.md`, which links every document in reading order. Related package material lives in `docs/adr/` (ADR-0001..0006), `docs/ui/request-crm/`, `/schemas/request-crm/`, `/mock-data/request-crm/`, `/contracts/typescript/request-crm/` and `/rork/request-crm/`.

Automation & AI Center Runtime Safety v3 remains the single source of truth for the automation registry, AI extensions, risk levels, runtime guards, kill switches, circuit breaker visibility, execution/incident logs and approval policy.

### automation-ai-center/  (current canonical package)

Contains the **Automation & AI Center Runtime Safety v3** package (`v3-runtime-safety-master-review`): the single source of truth for the automation action registry, AI extension registry, risk levels, execution/approval policy, runtime guard policy, runtime flags & kill switches, circuit breaker visibility, execution/incident logs, performance/resilience gates and module health.

Start at `automation-ai-center/00-automation-ai-center-index.md`, which links every document (`00`–`19`) in reading order. Related package material lives in `docs/adr/` (ADR-0001..0007 automation decisions), `/schemas/automation-ai-center/`, `/mock-data/automation-ai-center/`, `/contracts/typescript/automation-ai-center/`, `/filters/automation-ai-center/` and `/rork/automation-ai-center/` (provenance in `/rork/automation-ai-center/_package/`).

This is distinct from the `ai/` AI-assistant feature docs; Runtime Safety & Performance Guard is owned here, not by any domain module.

### requests/  (superseded)

Contains earlier request-management architecture notes (v0.1). **Superseded by `request-crm/`** above; retained for history. Do not use for new planning.

### keys/

Reserved for KEYS / Access Management architecture.

This folder should contain key, tag, code, customer entry, access custody, key transfer, schedule access analysis, key automation and access-risk documentation.

### adr/  (architecture decision records)

`/docs/adr/` holds architecture decision records for both canonical packages. These are decisions, not implementation tasks:

- REQUEST CRM: `ADR-0001-request-platform-single-communication-domain` … `ADR-0006-runtime-safety-belongs-to-automation-ai-center`.
- Automation & AI Center: `ADR-0001-automation-ai-center-single-source-of-truth` … `ADR-0007-runtime-guards-use-canonical-lifecycle`.

Note: the two ADR sets share numeric prefixes `0001..0006` but use distinct topic slugs, so they coexist as separate files. The numeric overlap is a known cross-package collision (flagged during intake), not a duplicate; renumbering was intentionally avoided to preserve canonical ADR references.

---

## Rules

Before changing architecture:

1. Read `/docs/00-master-index.md`.
2. Read `/docs/governance/01-project-constitution.md`.
3. Read `/docs/governance/02-data-authority-and-test-data-policy.md`.
4. Read the relevant module architecture folder.
5. Verify that the change does not conflict with existing module boundaries.
6. Update the relevant implementation and Dev Center documentation if scope changes.
