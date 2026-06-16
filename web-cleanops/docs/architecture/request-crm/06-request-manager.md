# 06 - Request Manager

## Definition

Request Manager is the long-lived communication and responsibility layer. It replaces email as the working surface, not only as a message channel.

## Hard-coded request types from start

- Cancellation / Rescheduling
- Customer wants to book selected service
- Complaint
- Something broke
- Customer information
- Invoice question
- General question/message to office
- Payroll question
- Schedule system request

Admin-created categories/types must be supported later, but full dynamic form builder is not required in the first iteration.

## Three-column request view

### Left: internal area

- Internal posts
- Internal tasks
- Phone calls
- Notes
- AI summaries
- System notes
- Task acknowledgement state

### Middle: external communication

- Customer thread
- Employee thread
- Shared thread when explicitly selected
- AI intake transcript/summary

Admin UI must show recipients before send.

### Right: request metadata

- Category
- Status
- Priority
- Severity
- SLA
- Customer / employee / booking / work order / invoice links
- Owner/support
- Snooze
- Handle self
- Lock/access
- Email policy
- Automation & AI quick-review panel

## Status, priority, severity and SLA

Do not conflate these fields.

- Status: lifecycle state.
- Priority: business importance.
- Severity: routing/popup/emergency signal.
- SLA/deadline: response/resolve/internal task timing.
