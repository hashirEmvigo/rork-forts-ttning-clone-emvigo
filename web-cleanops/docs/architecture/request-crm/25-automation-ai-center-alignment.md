# 25 - Automation & AI Center Alignment

> Dependency (canonical): the Automation & AI Center package is saved in this repo at
> `/docs/architecture/automation-ai-center/00-automation-ai-center-index.md`
> (package version `v3-runtime-safety-master-review`). That index is the single source of
> truth referenced throughout this document. Supporting paths: `/docs/adr/ADR-0001..ADR-0007`
> (automation decisions), `/schemas/automation-ai-center/`, `/mock-data/automation-ai-center/`
> and `/rork/automation-ai-center/`.

## Global rule

Automation & AI Center is the single source of truth for automation, AI decisions, risk levels, runtime guards, kill switches, incident logs and performance/resilience gates.

REQUEST must not implement hidden module-specific automation logic.

## REQUEST may own

- request data
- request status lifecycle
- thread/message data
- internal posts/tasks
- notification domain objects
- chat session data
- local audit records
- domain event emission
- local quick-review panels
- domain service validation

## Automation & AI Center owns

- automation action registry
- AI extension registry
- risk level policy
- guard action policy
- runtime flags / kill switches
- circuit breaker visibility
- performance/resilience gates
- execution logs
- incident logs
- alert/follow-up policy
- resolution state
- approval policy

## Canonical auto-action lifecycle

Every future automation must map to:

```text
Trigger
  -> Condition
  -> Risk level
  -> Guard/action policy
  -> Runtime flag
  -> Execution/incident log
  -> Alert/follow-up
  -> Resolution
```

## REQUEST event-to-action examples

| REQUEST event | Local domain meaning | Automation & AI Center candidate |
|---|---|---|
| `request.customer_message_received` | new external customer message | unsnooze request, notify owner/support, AI reply draft |
| `request.sla_due_soon` | SLA near due | prio dashboard item / notification |
| `request.access_requested` | admin asks for locked access | notify owner/support, escalate if no response |
| `chat.ai_unable_to_resolve` | chat escalation needed | create request draft, notify group, AI summary |
| `email.delivery_failed` | outbound email failed | notification/incident candidate |

## Local quick review

REQUEST screens may show:

- linked automation action key
- current mock status
- risk level badge
- AI extension candidate
- last mock execution timestamp
- link to Automation & AI Center

They must not become the source of truth.
