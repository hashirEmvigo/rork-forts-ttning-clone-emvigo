# REQUEST CRM Communications Platform - Architecture Index

Version: v0.2-automation-ai-center-aligned
Status: implementation-planning-ready (no code yet)
Audience: RORK / Claude 5 XHigh / implementation agents

> This is the current canonical REQUEST / CRM planning package. It supersedes the
> earlier `docs/architecture/requests/` notes (see those files for the superseded
> markers). REQUEST CRM v0.2 is "Automation & AI Center aligned".

## Purpose

REQUEST is the internal communications and operations platform covering:

- Request Manager
- Notification Center
- Chat / AI intake
- Operational dashboard
- Internal posts and task coordination
- Email outbox/inbound preparation
- Access control, visibility and audit

REQUEST is not a traditional support ticket system. It is a communication-domain platform and operational control layer.

## Non-negotiable boundary

REQUEST emits domain events and owns communication-domain state. **Automation & AI Center
Runtime Safety v3** owns the automation action registry, AI extension registry, risk levels,
runtime guards, kill switches, circuit breaker visibility, execution logs, incident logs and
approval policy. Local REQUEST screens may show quick-review panels, but the central source of
truth must remain the Automation & AI Center. Treat that package as an external dependency.

## Required read order (priority path)

1. `01-executive-summary.md`
2. `03-architecture-principles.md`
3. `05-domain-model.md`
4. `16-security-permissions-audit.md`
5. `17-event-driven-design.md`
6. `25-automation-ai-center-alignment.md`
7. `26-runtime-safety-performance-alignment.md`
8. `27-slice-0-frontend-shell.md`
9. `28-settings-shell.md`
10. `29-rork-assignment.md`

## Full document list (in order)

- `00-index.md` - this index
- `01-executive-summary.md`
- `02-scope-non-goals-release-strategy.md`
- `03-architecture-principles.md`
- `04-system-overview.md`
- `05-domain-model.md`
- `06-request-manager.md`
- `07-threads-visibility.md`
- `08-internal-posts-tasks.md`
- `09-snooze-handle-self-locked-access.md`
- `10-notification-center.md`
- `11-chat-ai-intake.md`
- `12-ai-layer-internal-service.md`
- `13-email-outbox-inbound.md`
- `14-dashboard-operational-exceptions.md`
- `15-integrations-other-modules.md`
- `16-security-permissions-audit.md`
- `17-event-driven-design.md`
- `18-settings-configuration.md`
- `19-test-strategy.md`
- `20-feature-flags.md`
- `21-api-contract-candidates.md`
- `22-implementation-phases.md`
- `23-acceptance-tests-dod.md`
- `24-risks-open-questions.md`
- `25-automation-ai-center-alignment.md`
- `26-runtime-safety-performance-alignment.md`
- `27-slice-0-frontend-shell.md`
- `28-settings-shell.md`
- `29-rork-assignment.md`
- `30-anti-patterns.md`

## Related package locations

- ADRs: `../../adr/ADR-0001..ADR-0006`
- UI specifications: `../../ui/request-crm/`
- JSON schemas: `/schemas/request-crm/`
- Mock/seed data: `/mock-data/request-crm/`
- TypeScript contracts: `/contracts/typescript/request-crm/`
- RORK execution prompts & review gates: `/rork/request-crm/`
- Original package provenance (source docx, VERSION, manifest, checksums): `/rork/request-crm/_package/`
- Automation & AI Center (external dependency, canonical source of truth): `/docs/architecture/automation-ai-center/00-automation-ai-center-index.md`

## Implementation gate (do not skip)

- No product code, routes, UI, migrations, live automation or live AI yet.
- RORK/Claude must return a reviewed implementation plan first.
- First approved build slice is Slice 0: frontend shell with mock/static data only.
