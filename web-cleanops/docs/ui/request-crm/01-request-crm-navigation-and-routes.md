# UI - REQUEST CRM Navigation and Routes

Target route names may be adapted to current repo conventions.

## Proposed IA

```text
CRM / REQUEST
  Dashboard
  Requests
    Request detail
  Notifications
  Chat
  Settings
```

## Route candidates

- `/crm`
- `/crm/dashboard`
- `/crm/requests`
- `/crm/requests/:id`
- `/crm/notifications`
- `/crm/chat`
- `/crm/chat/:sessionId`
- `/crm/settings`

## Shared components

- RequestStatusBadge
- PriorityBadge
- SeverityBadge
- RequestOwnerBadge
- ThreadVisibilityBadge
- InternalTaskAcknowledgementBadge
- AutomationQuickReviewCard
- AIExtensionStatusBadge
- RuntimeSafetyMockBadge
- LinkedObjectChip
- EmptyState
- MockDataNotice
