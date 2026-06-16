# 21 - API Contract Candidates

Exact contracts must be proposed by RORK after repo inspection. These are boundary candidates only.

## Request endpoints

```text
GET    /api/requests
POST   /api/requests
GET    /api/requests/{id}
PATCH  /api/requests/{id}
POST   /api/requests/{id}/threads
POST   /api/requests/{id}/threads/{threadId}/messages
POST   /api/requests/{id}/internal-posts
POST   /api/internal-posts/{postId}/comments
POST   /api/internal-posts/{postId}/assignees
POST   /api/internal-posts/{postId}/acknowledge
POST   /api/requests/{id}/snooze
POST   /api/requests/{id}/handle-self
POST   /api/requests/{id}/lock
POST   /api/requests/{id}/access-requests
POST   /api/access-requests/{id}/approve
POST   /api/access-requests/{id}/deny
```

## Notification endpoints

```text
GET    /api/notifications
POST   /api/notifications/{id}/acknowledge
POST   /api/notifications/{id}/handle
POST   /api/notifications/{id}/dismiss
POST   /api/notifications/{id}/create-request
GET    /api/notification-types
```

Do not implement local hidden `/api/notification-rules` as production source of truth. If a rule endpoint exists later, it must proxy/reference Automation & AI Center policy.

## Chat and AI endpoints

```text
POST   /api/chat/sessions
POST   /api/chat/sessions/{id}/messages
POST   /api/chat/sessions/{id}/convert-to-request
POST   /api/chat/sessions/{id}/admin-takeover
POST   /api/internal-ai/classify-message
POST   /api/internal-ai/summarize-conversation
POST   /api/internal-ai/suggest-reply
POST   /api/internal-ai/create-request-draft
POST   /api/internal-ai/approve-proposal
POST   /api/internal-ai/reject-proposal
```

Use Internal AI Service namespace, not direct provider routes.
