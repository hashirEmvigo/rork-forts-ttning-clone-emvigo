# ADR-0002: No Special-Case Automation Logic

## Status

Accepted.

## Decision

Every new automation must use the universal auto-action model.

## Context

Prior calculator work failed because special cases accumulated until the system became too complex.

Automation must not repeat this pattern.

## Consequences

- Every auto-action gets a stable key.
- Every auto-action has trigger, conditions, actions, risk, policy, and logging.
- No direct one-off customer-facing actions inside isolated module code.

## Runtime safety relationship

This decision also applies to runtime safety controls. Rate limits, quotas, circuit breakers, kill switches, incidents, and module health must follow the same source-of-truth and auditability principles. See ADR-0005 and ADR-0006.
