# ADR-0007: Runtime Guards Use the Canonical Lifecycle

## Status

Accepted.

## Decision

Runtime safety controls must use the same centrally discoverable lifecycle as automations:

```text
Trigger -> Condition -> Risk level -> Guard action -> Runtime flag -> Execution/incident log -> Alert/follow-up -> Resolution
```

## Context

Rate limits, circuit breakers, frontend-loop protection, kill switches, AI budgets, export limits, upload limits, and module degradation controls can become untraceable if each module implements separate hidden safety logic.

## Consequences

- Runtime guard policies must be centrally visible in Automation & AI Center.
- Guard actions and runtime state changes must be logged or linked to runtime incidents.
- Feature modules may implement technical enforcement, but they must not own the source-of-truth policy/state/history.
- Slice 1 may show guard policies as mock/read-only data only.
- Live enforcement requires a separate approved implementation plan.
