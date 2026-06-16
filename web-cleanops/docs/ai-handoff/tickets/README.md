# AI Handoff Tickets

## Purpose
This folder contains ticket files for RORK wave execution.

## Ticket naming
Use this format:

```txt
TICKET-001-short-title.md
TICKET-002-short-title.md
```

## Required ticket format

```md
# TICKET-001 - Title

## Goal
What this ticket must achieve.

## Scope
Files, modules, or areas that may be changed.

## Non-goals
What RORK must not implement in this ticket.

## Architecture rules
Architecture constraints that must be followed.

## Implementation steps
Concrete technical steps.

## Acceptance criteria
What must be true when the ticket is done.

## Verification
Tests, typecheck, build, or manual checks required.

## Escalation
When RORK must stop for this ticket.
```

## Wave rule
RORK should execute tickets in registry order and should not jump ahead unless the active inbox instruction explicitly says so.
