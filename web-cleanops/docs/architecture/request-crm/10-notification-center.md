# 10 - Notification Center

## Definition

Notification Center is a tightly integrated operational signal surface. It is not a replacement for Request Manager and it must not automatically convert every event into a request.

## Notification object states

- unread
- read
- acknowledged
- handled
- dismissed

## Types

- information
- prio
- emergency
- access_request
- ai_recommendation
- system_warning
- configurable labels

## Source-of-truth boundary

Notification Center owns:

- notification objects
- notification UI
- acknowledgement / handled / dismissed states
- links to request/customer/employee/booking/work_order/invoice

Automation & AI Center owns:

- trigger registration
- condition policy
- risk level
- runtime flag
- guard action
- AI extension
- execution log
- incident log
- approval policy

## Example: late check-in

Domain event:

- `schedule.assignment_not_started`

V1 output:

- Notification to worklead/area lead.
- Linked employee, booking and schedule.
- Admin can handle or create request.

Later AI extension:

- Ask employee for ETA.
- Recalculate schedule impact via Schedule Engine.
- If no downstream customer impact: information notification/log.
- If downstream customer impact: prio/emergency notification and admin review.

The notification UI can display the status, but the automation action definition must be registered centrally.
