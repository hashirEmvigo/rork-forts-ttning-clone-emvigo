# 09 - Snooze, Handle Self and Locked Access

These concepts must remain separate.

## Snooze

Snooze is list filtering, not access control.

Scopes:

- personal
- global

Auto-unsnooze triggers:

- new customer/employee message
- SLA due/near due
- emergency severity
- task assigned
- snooze expiration

Auto-unsnooze is an automation candidate and must be centrally discoverable.

## Handle self

Handle-self is active ownership/work allocation. It hides the request from normal active lists for colleagues but does not make the request private. Supervisor/superadmin overview remains possible according to policy.

## Locked request

Locked request is access control. Non-authorized admin may see limited metadata and request access.

Access request states:

- pending
- approved
- denied
- expired
- overridden

Every decision must be audited.

## Escalation boundary

Owner absence or no response within configured time may trigger escalation. Escalation policy belongs in Automation & AI Center, not hidden in REQUEST.
