# ADR-0006 - Runtime safety belongs to Automation & AI Center

Status: Accepted

## Decision

Rate limiting, circuit breakers, kill switches, runtime guard policy, incident logs and performance/resilience gates belong to Automation & AI Center. REQUEST may emit telemetry and show local read-only status.

## Consequences

- No local REQUEST-specific kill switch model.
- No local runtime incident source-of-truth.
- Slice 0 can show mock badges only.
