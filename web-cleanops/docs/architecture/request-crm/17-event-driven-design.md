# 17 - Event-driven Design

## Principle

All relevant modules emit domain events. Rules/policies decide resulting actions. Do not bury those policies in module-specific code.

REQUEST domain events are inputs to central automation candidates.

## Canonical flow

```text
DomainEvent
  type
  source_module
  linked_object_type/id
  payload_json
  created_at
  correlation_id
  tenant_id
      |
      v
Automation & AI Center action registration / policy evaluation
      |
      +-> Notification
      +-> DashboardItem
      +-> InternalTask
      +-> Append to existing Request
      +-> Create new Request/Draft
      +-> AI proposal / draft
      +-> No-op / log only
```

## Example events

- `request.created`
- `request.customer_message_received`
- `request.employee_message_received`
- `request.status_changed`
- `request.priority_changed`
- `request.severity_changed`
- `request.sla_due_soon`
- `request.sla_overdue`
- `request.snoozed`
- `request.auto_unsnoozed`
- `request.handle_self_enabled`
- `request.owner_inactive_detected`
- `request.locked`
- `request.access_requested`
- `request.access_request_expired`
- `internal_task.assigned`
- `internal_task.comment_created`
- `chat.ai_unable_to_resolve`
- `chat.converted_to_request`
- `notification.handled`
- `email.delivery_failed`

## Output policy boundary

REQUEST may implement the resulting domain mutation only after policy approval. The policy must be centrally discoverable.
