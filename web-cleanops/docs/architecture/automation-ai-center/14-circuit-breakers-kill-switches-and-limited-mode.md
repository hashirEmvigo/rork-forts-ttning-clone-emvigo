# Circuit Breakers, Kill Switches, and Limited Mode

## Status

Architecture standard. Slice 1 displays mock state only.

## Purpose

Allow the platform to stop calling failing or overloaded functionality before it degrades the whole system.

## Circuit breaker principle

A circuit breaker protects a dependency, endpoint, module, or feature.

States:

- `closed`: normal operation
- `open`: calls are blocked or failed fast
- `half_open`: limited test traffic is allowed to verify recovery

## Open-circuit triggers

Open a circuit when one or more thresholds are exceeded:

- error rate
- timeout rate
- p95/p99 latency
- dependency health failure
- repeated slow database query
- repeated provider failure
- repeated AI provider failure
- repeated upload failure
- queue backlog threshold

## Open-circuit behavior

When a circuit opens, the linked `RuntimeGuardPolicy` must record/drive the following behavior:

- stop additional expensive calls
- fail fast with controlled response
- create or update runtime incident
- notify IT/dev team for high/critical severity
- display module state in Automation & AI Center
- link guard policy, runtime flag, incident, and resolution path
- allow manual override only with audit

## Kill switches

A kill switch is a controlled runtime flag that disables or limits behavior without a new deploy.

Kill switches must exist for high-risk or heavy features, including:

- AI chat
- AI auto-action execution
- automation runner
- customer-facing notifications
- invoice export
- media upload
- schedule planning/optimization
- public pricing calculator
- bulk operations
- realtime-heavy views

## Feature runtime states

Allowed states:

- `enabled`: normal behavior
- `limited_mode`: reduced functionality or reduced data window
- `read_only`: view only, no mutations
- `admin_only`: only admin/super admin access
- `maintenance_mode`: planned maintenance message
- `disabled`: feature unavailable

## Limited mode examples

| Feature | Limited behavior |
|---|---|
| Booking List | show only current page/date range, disable auto-refresh |
| Schedule | read-only grid, disable planning mutations |
| Invoice export | allow viewing invoices, disable export jobs |
| Media Center | show existing media, pause uploads |
| AI chat | disable new AI calls, keep conversation history visible |
| Automation jobs | observe-only mode, no execution |
| Public pricing calculator | simplified response or request cap |

## Manual override rule

Manual override requires:

- actor id
- reason
- timestamp
- previous state
- new state
- expected rollback/review time
- linked incident id if relevant

## Audit rule

No feature flag, kill switch, or circuit breaker state change may be unaudited.

## Slice 1 UI expectation

Slice 1 may show:

- feature flags table
- current state badge
- affected module
- reason
- last changed at
- changed by mock value
- linked incident mock id
- non-live warning

No live toggle mutation in Slice 1. Runtime flag and guard policy state is mock/read-only.
