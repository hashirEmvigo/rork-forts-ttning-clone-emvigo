# ADR-0001 - REQUEST uses a single communication domain

Status: Accepted

## Decision

REQUEST Manager, Chat and Notification Center must be built under one communication-domain architecture rather than three independent systems.

## Consequences

- Shared concepts for actor, message, thread, visibility and audit.
- Easier conversion from chat to request.
- Easier cross-linking from notifications to requests.
- Requires strict service boundaries to avoid monolith sprawl.
