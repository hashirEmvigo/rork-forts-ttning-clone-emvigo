# Module Integration Standard

## Purpose

Every new feature module must be built so Automation & AI Center can later discover relevant automation data, events, state changes, and AI-extension points.

## Core rule

Feature modules may own domain logic.

Automation & AI Center must own central automation visibility, metadata, risk, policy, approval, execution history, and AI extension linkage.

## Required pattern: domain event first

Every automation-relevant event must be represented as a domain event or explicit state transition.

A domain event is a structured fact that something happened.

Examples:

- `schedule.employee_late_detected`
- `schedule.eta_updated`
- `cases.case_created`
- `cases.unhandled_case_risk_detected`
- `chat.customer_message_received`
- `chat.complaint_signal_detected`
- `keys.missing_alarm_code_detected`
- `customer_card.cleaning_protocol_missing`

## Domain event shape

```ts
type DomainEvent = {
  id: string;
  eventKey: string;
  module: AutomationModuleKey;
  sourceEntityType: string;
  sourceEntityId: string;
  occurredAt: string;
  actorType: 'system' | 'admin' | 'company_admin' | 'employee' | 'customer' | 'ai';
  actorId?: string;
  payload: Record<string, unknown>;
  correlationId?: string;
};
```

## Required integration points per module

Each module must expose or document:

1. domain events
2. state transitions
3. risk conditions
4. notification candidates
5. approval candidates
6. audit/log entries
7. data needed by Automation & AI Center
8. data that Automation & AI Center must not mutate directly
9. quick review requirements
10. AI extension candidates

## Quick review rule

Feature modules may show local quick review widgets.

A quick review must be a view or summary, not a separate control plane.

Quick review may show:

- related auto-actions
- latest execution
- local risk indicator
- pending approval count
- AI draft count
- link to Automation & AI Center detail page

Quick review must not become an independent source of truth.

## Schedule integration examples

Domain events:

- `schedule.employee_late_detected`
- `schedule.delay_impact_detected`
- `schedule.employee_delay_confirmation_requested`
- `schedule.employee_confirmed_no_delay_impact`
- `schedule.employee_confirmed_delay_impact`
- `schedule.eta_updated`
- `schedule.negative_customer_impact_detected`
- `schedule.admin_review_required`

Automation candidates:

- ask employees if next assignment will be delayed
- update ETA
- send app notification if customer opted in
- create admin notification if negative customer impact
- create AI proposal for schedule solution later

Must preserve separate fields:

- planned time
- estimated time
- confirmed changed time
- actual time

## Cases integration examples

Domain events:

- `cases.case_created`
- `cases.case_status_changed`
- `cases.customer_replied`
- `cases.unhandled_case_risk_detected`
- `cases.priority_changed`
- `cases.case_escalated`

Automation candidates:

- classify case
- suggest priority
- create SLA warning
- assign owner suggestion
- AI draft reply later

## Chat integration examples

Domain events:

- `chat.customer_message_received`
- `chat.unanswered_message_detected`
- `chat.complaint_signal_detected`
- `chat.booking_request_detected`
- `chat.cancellation_request_detected`

Automation candidates:

- create case from chat
- detect complaint
- summarize conversation
- draft admin response
- route to correct team

## Keys/Alarm integration examples

Domain events:

- `keys.access_info_updated`
- `keys.missing_key_info_detected`
- `keys.missing_alarm_code_detected`
- `keys.high_risk_access_note_added`
- `keys.access_instruction_conflict_detected`

Automation candidates:

- warn admin before work order
- create internal notification
- mark customer card as missing critical access info
- AI summarize missing access data later

## Notifications integration examples

Domain events:

- `notifications.customer_opted_in`
- `notifications.customer_opted_out`
- `notifications.delivery_failed`
- `notifications.admin_notification_created`
- `notifications.notification_acknowledged`

Automation candidates:

- retry failed internal notification
- escalate unacknowledged critical notification
- suppress duplicate notifications

## Work Orders integration examples

Domain events:

- `work_orders.created`
- `work_orders.assigned`
- `work_orders.missing_required_info_detected`
- `work_orders.started`
- `work_orders.completed`
- `work_orders.completion_missing_media`

Automation candidates:

- missing info warning
- missing protocol warning
- post-completion quality check

## Required Definition of Done addition

Every new feature must document:

```text
Automation & AI Center readiness:
- Domain events:
- Automation candidates:
- AI-extension candidates:
- Risk conditions:
- Approval candidates:
- Quick review needs:
- Central discoverability:
- Hidden automation logic added: no
```

## Runtime safety integration points

Each module must expose or document its runtime safety profile.

Add these required integration points per module:

11. heavy routes and endpoints
12. default data volume and pagination limits
13. timeout policy
14. retry policy
15. polling/realtime behavior
16. rate limit and quota needs
17. feature flag or kill switch needs
18. limited-mode/read-only behavior
19. runtime incident fields
20. performance budget

## Module safety profile output

Every heavy module must document:

```text
Runtime Safety Profile:
- Module:
- Heavy routes:
- Heavy endpoints:
- User/session/company limits:
- Data volume limits:
- Polling/realtime behavior:
- Timeout policy:
- Retry policy:
- Feature flag / kill switch:
- Limited mode behavior:
- Incident fields:
- Performance budget:
```

## Example: Booking List safety

Booking List must not be able to reload forever.

Required behavior:

- bounded page/date-range data
- stable query key
- no duplicate initial fetch
- no hidden polling unless approved
- rate limit repeated reads per session
- controlled message when throttled
- runtime incident when abnormal request count is detected
- limited mode can disable auto-refresh and reduce date range

## Example: Invoice export safety

Invoice export must not run as unlimited synchronous requests.

Required behavior:

- one active export job per user/company unless otherwise approved
- background job or queue pattern for heavy exports
- timeout and retry policy
- kill switch for export function
- incident on repeated failure or queue backlog
