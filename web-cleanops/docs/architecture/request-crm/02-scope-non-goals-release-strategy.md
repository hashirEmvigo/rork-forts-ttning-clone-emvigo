# 02 - Scope, Non-goals and Release Strategy

## Scope

- Request Manager for admin, customer, employee, system and AI-created requests.
- Chat with AI-first intake for customer/employee communication.
- Notification Center for operational signals, priority, emergency and access requests.
- Internal posts and tasks inside requests.
- Visibility model: owner, support, category, locked access, preview and access request.
- Snooze, handle-self and locked request access flows.
- Email outbound with delayed outbox and later inbound reply preparation.
- Test mode, seed data, test batch cleanup and environment strategy.
- Mock-first AI adapter and later provider adapter.
- Automation & AI Center readiness for all domain events and automation candidates.

## Non-goals for first technical scope

- No full visual rule builder in REQUEST settings.
- No autonomous AI closure without approval.
- No full cancellation/rescheduling engine in first iteration.
- No advanced live chat queue routing in first iteration.
- No external customer/employee launch before end-to-end validation.
- No live Automation & AI Center enforcement in Slice 0.
- No production runtime guards, kill switches or circuit breaker enforcement in Slice 0.

## Release strategy

Build internally first. Use feature flags per environment, tenant and role. Use staging/test tenants with realistic data. Connect real AI provider only after Request Core, Chat Core, Notification Core, access and admin approval flows are stable in staging.
