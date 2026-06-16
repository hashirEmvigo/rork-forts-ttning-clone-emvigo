# ADR-0006: Performance and Resilience Gates Are Required

## Status

Accepted.

## Decision

Heavy, automation-relevant, customer-impacting, AI-enabled, public-facing, or data-intensive features require performance and resilience gates before production readiness.

## Context

Prettier UI and faster implementation are not enough. The platform must remain fast, bounded, observable, and recoverable under real use.

## Consequences

- Every heavy feature needs performance budget and runtime safety profile.
- Load, flow, or targeted performance testing is required where relevant.
- Unbounded polling, retries, reads, exports, uploads, AI usage, and subscriptions are release blockers.
- Incident/logging path must exist for abnormal behavior.
- Kill switch, limited mode, or read-only behavior must be defined for high-risk/heavy features.
