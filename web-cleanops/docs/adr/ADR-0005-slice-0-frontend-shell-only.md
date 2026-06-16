# ADR-0005 - Slice 0 is frontend shell only

Status: Accepted

## Decision

First build slice for REQUEST/CRM is a frontend shell using mock data.

## Consequences

- No live automation.
- No live AI provider.
- No live email outbox.
- No production runtime safety enforcement.
- UX and architecture can be validated before deep backend commitments.
