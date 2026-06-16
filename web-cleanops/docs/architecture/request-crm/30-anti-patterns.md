# 30 - Anti-patterns and Non-negotiables

## Anti-patterns

- Building notification rules as hidden REQUEST-module logic.
- Building AI policies directly inside chat/request components.
- Creating one-off automations for each request type.
- Treating Notification Center as the automation source of truth.
- Treating REQUEST settings as a no-code automation builder in first iteration.
- Implementing production kill switches or rate limiting in Slice 0.
- Sending email directly inside request transactions.
- Marking internal tasks as acknowledged just because the request was opened.
- Allowing customer/employee shared visibility by default.
- Letting AI use unrestricted database access.
- Connecting real AI provider before mock flows work.

## Non-negotiables

- REQUEST emits domain events.
- Automation & AI Center owns central automation/AI/runtime policy.
- AI goes through Internal AI Service.
- Every external visibility decision is explicit and audited.
- Every meaningful state change is auditable.
- Slice 0 is frontend shell only.
