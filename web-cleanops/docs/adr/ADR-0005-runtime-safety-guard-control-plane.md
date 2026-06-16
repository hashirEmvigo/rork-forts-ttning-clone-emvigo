# ADR-0005: Runtime Safety Guard Belongs in the Control Plane

## Status

Accepted.

## Decision

Automation & AI Center must include central visibility for runtime safety controls: rate limits, resource quotas, circuit breakers, feature runtime flags, kill switches, session/user/company/module throttling, runtime incidents, and module health.

## Context

The system must not allow one user, one function, one page loop, one retry storm, or one heavy module to overload the entire platform.

Feature modules may implement local technical enforcement, but the policy and outcome must be centrally visible.

## Consequences

- No hidden rate limits or kill switches.
- Runtime incidents must be inspectable.
- Feature flags must be auditable.
- Heavy modules must declare safety profiles.
- Runtime safety mock UI belongs in the Automation & AI Center shell.
- Production enforcement is deferred until repository inspection and approved implementation plan.
