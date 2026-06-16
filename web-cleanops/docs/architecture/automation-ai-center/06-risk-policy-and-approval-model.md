# Risk Policy and Approval Model

## Purpose

Every auto-action and AI-action must have explicit risk and approval behavior.

## Risk levels

### Low

Internal only. No customer-facing impact. No permanent business-critical mutation.

Examples:

- create internal log
- classify internal message
- mark item as needs review
- create low-priority internal notification

Default execution:

`auto_execute_with_log`

### Medium

May affect customer or employee experience, but low legal/financial/security impact.

Examples:

- send customer app notification for ETA delay if opted in
- create case from chat message
- create admin notification for missing access information
- update estimated arrival time, not confirmed booking time

Default execution:

`auto_execute_with_notification` or `requires_admin_review`, depending on action.

### High

Customer dissatisfaction risk, schedule disruption, sensitive operational impact, or multi-entity impact.

Examples:

- negative customer impact detected
- multiple bookings affected by delay
- complaint detected
- missing critical access data shortly before assignment
- schedule solution proposed
- customer message draft about sensitive issue

Default execution:

`requires_admin_review`

### Critical

Financial, legal, access/security, deletion, salary/time-report, agreement, payment, or irreversible operations.

Examples:

- change invoice/payment status
- delete customer data
- change agreement terms
- alter salary/time-report data
- send financial demand
- change confirmed booking without approval
- change critical access instructions

Default execution:

`requires_super_admin_approval` or `blocked`

## Approval policy

```ts
type AutomationApprovalPolicy = {
  required: boolean;
  requiredRole?: 'admin' | 'company_admin' | 'super_admin';
  allowEditBeforeApproval: boolean;
  allowReject: boolean;
  allowAutoExecuteAfterApproval: boolean;
  reasonRequiredOnReject: boolean;
};
```

## Execution mode mapping

| Risk | Default execution mode |
|---|---|
| Low | auto_execute_with_log |
| Medium | auto_execute_with_log or auto_execute_with_notification |
| High | requires_admin_review |
| Critical | requires_super_admin_approval or blocked |

## Customer communication policy

Customer communication can be automated only when:

- message type is pre-approved template or low-risk standard update
- customer has opted in where required
- event is deterministic and not sensitive
- no ambiguous negative customer impact exists
- duplicate suppression exists
- execution is logged

Customer communication requires approval when:

- complaint is involved
- quality issue is involved
- financial issue is involved
- service cancellation/rebooking is involved
- schedule impact is large or ambiguous
- AI generated text is involved and policy has not allowed auto-send

## Employee impact policy

Automation must not unfairly assign blame.

If employee 1 is late and employee 2 is on time, logs must preserve individual facts.

Valid:

- employee 1 late arrival recorded
- employee 2 on-time arrival recorded
- team-level downstream delay risk recorded separately

Invalid:

- mark whole team as late without individual facts
- AI creates negative employee note without approval
- automation changes salary/time report from delay detection alone

## Schedule policy

Always distinguish:

- planned time
- estimated time
- confirmed changed time
- actual time

ETA updates may be automated under policy.

Permanent booking changes require approval unless an explicit low-risk business rule is approved later.

## AI approval policy

AI-generated content is a proposal unless explicitly configured otherwise.

Initial implementation:

- AI summarize: no approval needed if internal only
- AI suggest: no execution without admin action
- AI draft customer message: approval required
- AI create approval request: allowed
- AI auto-send: blocked initially

## Approval queue item

Approval item must include:

- source automation action key
- source execution id
- module
- source entity
- risk level
- proposed action
- proposed payload
- AI used yes/no
- summary
- approval required role
- editable payload if allowed
- approve/reject history

## Operational risk and runtime guard policy

Risk is not only business risk. A feature can also create operational risk if it can consume shared resources or degrade the platform.

Operational high-risk examples:

- unbounded list reads
- heavy exports
- AI calls
- media uploads
- realtime subscriptions
- background jobs
- schedule optimization
- public calculators
- repeated notification sending

Operational critical-risk examples:

- database saturation risk
- platform-wide traffic spike
- critical dependency outage
- payment/invoice mutation failure loop
- access/security-sensitive process failure
- automation runner loop

Required guard behavior:

- low operational risk: log and monitor
- medium operational risk: rate limit and timeout
- high operational risk: rate limit, timeout, incident path, limited mode or kill switch
- critical operational risk: circuit breaker, kill switch, alerting, and manual recovery process

## Approval for safety override

Changing safety limits, disabling a kill switch, or overriding a circuit breaker may affect platform stability.

High/critical safety overrides require:

- actor id
- reason
- linked incident or change request
- timestamp
- old value
- new value
- review/rollback path
