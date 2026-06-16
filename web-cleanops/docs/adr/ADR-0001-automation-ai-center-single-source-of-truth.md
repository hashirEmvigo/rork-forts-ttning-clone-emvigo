# ADR-0001: Automation & AI Center as Single Source of Truth

## Status

Accepted.

## Decision

Automation & AI Center is the single source of truth for automation visibility, metadata, governance, risk, approval, execution history, and AI extension status.

## Context

The product will contain many automations across many modules. Scattered rules will create operational risk and technical debt.

## Consequences

- Feature modules may display quick reviews.
- Feature modules may own domain logic.
- Automation governance must remain centrally discoverable.
- Hidden module-specific automation logic is not allowed.

## Runtime safety relationship

This decision also applies to runtime safety controls. Rate limits, quotas, circuit breakers, kill switches, incidents, and module health must follow the same source-of-truth and auditability principles. See ADR-0005 and ADR-0006.
