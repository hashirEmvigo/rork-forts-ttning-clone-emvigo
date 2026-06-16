# 23 - Acceptance Tests and Definition of Done

## Customer flow

- customer starts chat or creates request
- mock AI gathers info and suggests category/priority
- request or draft is created
- admin responds
- email notification outbox job is created with delay
- customer sees only customer-visible thread
- customer response wakes snoozed request

## Employee flow

- employee creates emergency request
- popup/priority shell shows for correct admin
- admin acknowledgement changes state
- emergency continues as normal request after acknowledgement

## Internal task flow

- three tasks created
- task assigned to Sebastian
- task unassigned
- task assigned to Marcus + Sebastian
- task comments notify assigned admins only
- acknowledgement remains per assignee
- opening request does not auto-ack task

## Visibility flow

- personal snooze works
- global snooze does not hide for admin with unacknowledged task
- quick hide hides globally for default interval
- handle-self hides from normal colleague lists but not owner/support/supervisor view
- locked request appears in search as metadata-only
- access approve/deny creates notification and audit

## Notification flow

- late check-in simulated event creates notification candidate, not request by default
- admin can mark handled
- admin can create request from notification
- notification links correctly to employee/booking/customer

## Automation & AI readiness DoD

Every implemented REQUEST feature must declare:

- emitted domain events
- automation candidates
- risk level candidates
- local domain mutations
- central Automation & AI Center references
- audit events
- feature flags
- test data cleanup impact

## Slice 0 DoD

- UI routes render with mock data
- no live API mutations except existing safe read mocks if repo already has them
- automation quick-review panels are read-only/mock
- settings shell does not build rule engine
- all source-of-truth references point to Automation & AI Center
