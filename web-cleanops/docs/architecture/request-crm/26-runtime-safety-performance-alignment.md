# 26 - Runtime Safety and Performance Alignment

## Dependency

Runtime Safety & Performance Guard belongs inside Automation & AI Center v3, not as a separate REQUEST-side subsystem.

Canonical source (saved in this repo): `/docs/architecture/automation-ai-center/00-automation-ai-center-index.md`
(`v3-runtime-safety-master-review`). The runtime safety / performance documents are
`12-runtime-safety-and-performance-guard.md` through `19-runtime-guard-canonical-model.md`
in `/docs/architecture/automation-ai-center/`, with runtime guard policy schema at
`/schemas/automation-ai-center/runtime-guard-policy.schema.json` and seeds in
`/mock-data/automation-ai-center/`.

## REQUEST responsibilities

REQUEST should emit enough telemetry and domain events for central runtime guard visibility later:

- request list query latency
- notification fetch latency
- chat message submit latency
- email outbox backlog
- AI mock/provider call latency when provider exists
- error counts
- frontend render loop risk indicators
- repeated mutation attempts
- event queue backlog
- failed delivery attempts

## Automation & AI Center responsibilities

- central runtime guard policy
- rate limit policy
- circuit breaker policy
- kill switch state
- performance/resilience gates
- runtime incident logs
- alert/follow-up
- resolution

## Slice 0 restriction

Slice 0 may display mock Runtime Safety badges and mocked guard state only.

Do not implement:

- production rate limiting
- production kill switch toggles
- production circuit breakers
- live runtime incident ingestion
- live session quarantine
- live throttling
- live alert routing
- live enforcement mutations

## Future integration contract

Any future REQUEST runtime guard integration must use the central model:

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
