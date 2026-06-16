# ADR-0004: Domain Modules Own Domain Logic

## Status

Accepted.

## Decision

Domain modules own their own calculations, validations, and mutations.

Automation & AI Center owns orchestration visibility, registry, policy, audit, approvals, and AI-extension linkage.

## Examples

- Schedule owns ETA calculation.
- Cases owns case lifecycle.
- Chat owns message persistence.
- Keys/Alarm owns access data.
- Finance owns invoice/payment state.

## Consequences

Automation & AI Center must not become a giant domain service or direct database mutation layer.

## Runtime safety relationship

This decision also applies to runtime safety controls. Rate limits, quotas, circuit breakers, kill switches, incidents, and module health must follow the same source-of-truth and auditability principles. See ADR-0005 and ADR-0006.
