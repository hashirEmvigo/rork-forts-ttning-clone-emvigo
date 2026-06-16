# ADR-0003 - Mock AI first and provider isolation

Status: Accepted

## Decision

REQUEST uses Internal AI Service. First implementation uses mock adapter. Real provider integration comes only after core flows work in staging.

## Consequences

- No direct provider calls from UI/modules.
- AI outputs are testable and deterministic in early slices.
- Provider can be replaced or disabled via policy/feature flags.
