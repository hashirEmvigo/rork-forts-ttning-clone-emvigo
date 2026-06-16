# ADR-0003: AI Actions Must Attach to Auto Actions

## Status

Accepted.

## Decision

AI actions must be optional extensions of registered auto-actions.

## Context

AI will be useful for summarization, classification, drafting, and decision support. It must not become a separate ungoverned execution layer.

## Consequences

- No standalone hidden AI agents.
- AI output must be traceable to parent automation execution.
- AI permissions and approval behavior are attached to action policy.

## Runtime safety relationship

This decision also applies to runtime safety controls. Rate limits, quotas, circuit breakers, kill switches, incidents, and module health must follow the same source-of-truth and auditability principles. See ADR-0005 and ADR-0006.
