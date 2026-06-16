# ADR-0004 - Notification Center is a domain object/UI, not the automation policy source

Status: Accepted

## Decision

Notification Center owns notification objects and UI state. Automated notification creation and escalation policy is owned centrally by Automation & AI Center.

## Consequences

- Notification settings shell can display labels and linked action keys.
- Rule evaluation must not be hidden in the notification module.
