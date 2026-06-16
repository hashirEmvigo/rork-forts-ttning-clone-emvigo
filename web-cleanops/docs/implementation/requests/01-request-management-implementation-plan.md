# 01-request-management-implementation-plan.md

## Request Management Implementation Plan

**Version:** 0.1  
**Target:** Vite + React web app with Supabase-backed persistence  
**Audience:** Rork, developers, product owner

---

## 1. Implementation Objective

Implement the CleanOps Request Manager as a controlled, role-based operational communication module.

The first implementation must prioritize correctness, visibility safety, ownership, next actions and traceability over advanced automation.

---

## 2. Suggested Feature Flags

Recommended flags:

```ts
REQUEST_MANAGER_ENABLED=false
REQUEST_MANAGER_SUPABASE_READ=false
REQUEST_MANAGER_SUPABASE_WRITE=false
REQUEST_MANAGER_SHADOW_VALIDATE=false
REQUEST_MANAGER_EMERGENCY_ENABLED=false
REQUEST_MANAGER_NOTIFICATIONS_ENABLED=false
REQUEST_MANAGER_AI_SEARCH_ENABLED=false
```

Initial rollout should keep write paths controlled and avoid enabling full authority before schema, permissions and manual validation are stable.

---

## 3. Database Implementation

### 3.1 Required Tables

Recommended minimum schema:

- request_tickets
- request_participants
- request_messages
- request_internal_notes
- request_external_notes
- request_status_events
- request_assignments
- request_snoozes
- request_confirmations
- request_ratings
- request_links
- request_attachments
- request_audit_logs
- request_notification_events

### 3.2 Visibility Separation

Do not store all text entries in one table without type/visibility separation unless row-level policies are extremely clear.

Preferred model:

- external messages are one explicit entity
- admin internal discussion is one explicit entity
- external user's own notes are one explicit entity
- audit log is one explicit entity

This reduces the risk of accidentally exposing internal admin discussion.

### 3.3 Required Core Fields: request_tickets

Suggested fields:

```sql
id uuid primary key
company_id uuid not null
request_number text not null
request_type text not null -- ordinary | emergency
category text
subcategory text
priority text
impact text
urgency text
status text not null
owner_admin_id uuid
next_responsible_user_id uuid
next_responsible_role text
next_action text
customer_id uuid
employee_id uuid
supplier_id uuid
related_work_order_id uuid
related_booking_id uuid
title text not null
summary text
created_by_user_id uuid
created_by_role text
created_at timestamptz not null
updated_at timestamptz not null
deadline_at timestamptz
first_response_due_at timestamptz
resolution_due_at timestamptz
closed_at timestamptz
reopened_at timestamptz
emergency_claimed_by uuid
emergency_claimed_at timestamptz
emergency_stabilized_at timestamptz
```

---

## 4. Repository / Service Layer

Recommended repositories/services:

- requestRepository
- requestMessageRepository
- requestNoteRepository
- requestAssignmentService
- requestSnoozeService
- requestConfirmationService
- requestEmergencyService
- requestLinkService
- requestRatingService
- requestSearchService
- requestNotificationBridge
- requestAuditService

Critical rule:

> Visibility and permission filtering must happen in the repository/service layer, not only in React components.

---

## 5. UI Architecture

### 5.1 Main Pages

Recommended routes:

```text
/requests
/requests/:requestId
/requests/emergency
/requests/my-inbox
/requests/team-inbox
/requests/waiting
/requests/snoozed
/requests/reopened
/requests/settings
```

### 5.2 Main Components

Suggested components:

- RequestListPage
- RequestDetailPage
- RequestInboxFilters
- RequestStatusBadge
- RequestPriorityBadge
- RequestMetadataPanel
- RequestInternalDiscussionPanel
- RequestExternalConversationPanel
- RequestExternalNotesPanel
- RequestConfirmationPanel
- RequestSnoozeMenu
- RequestEmergencyBanner
- RequestClaimButton
- RequestLinkedRequestsPanel
- RequestRatingPanel
- RequestAuditTimeline
- RequestSearchBar

### 5.3 Role-Based Layout

Admin layout:

- left: admin internal discussion
- center: external communication
- right: metadata/actions/audit

External layout:

- left: my notes - visible to admin
- center: external communication
- right: simplified status/actions

---

## 6. Confirmation Flow Implementation

When admin resolves a request:

1. status becomes `admin_resolved_awaiting_confirmation`
2. confirmation record is created
3. external user receives confirmation panel
4. external panel shows exactly two buttons:
   - Yes, the request is handled
   - No, I need more help

No separate comment button is allowed.

Rules:

- Yes -> close request
- No -> reopen request and open normal message input
- Any new external message -> reopen request
- All transitions must be logged

---

## 7. Inbox Zero / Snooze Implementation

Snooze must be implemented as a controlled workflow object, not only a UI hide flag.

Required fields:

```text
request_id
scope: user | team | office
hidden_for_user_id
hidden_for_role/team
reason
return_at
return_on_external_reply
return_on_deadline_warning
created_by
created_at
cancelled_at
```

Core behavior:

- hidden requests are removed from active inbox views
- request returns when return_at is reached
- request returns immediately when external party replies
- request returns when deadline/SLA warning triggers
- emergency requests require stricter rules

---

## 8. Emergency Request Implementation

Emergency request must support:

- emergency request creation from employee/customer/admin
- operational classification
- notification bridge
- claim/take request action
- escalation timer
- stabilized state
- after-action follow-up

Recommended emergency statuses:

```text
emergency_new
emergency_unclaimed
emergency_claimed
emergency_in_progress
emergency_stabilized
emergency_follow_up
emergency_closed
```

Core actions:

- Take request
- Assign colleague
- Escalate
- Send quick response
- Mark phone call required
- Mark emergency stabilized
- Create follow-up task/request

---

## 9. Linked Requests Implementation

Request links must support relation type and visibility-safe navigation.

Suggested fields:

```text
id
source_request_id
target_request_id
relation_type
created_by
created_at
note
```

Relation types:

- child
- related
- duplicate
- caused_by
- follow_up_of
- escalation_of
- merged_with

---

## 10. Ratings Implementation

Two rating types are required:

1. external rating of admin handling
2. internal admin assessment of employee handling

Suggested fields:

```text
request_id
rating_type
rated_by_user_id
rated_subject_user_id
score
rating_dimensions_json
comment
visibility
created_at
```

Visibility must be strictly controlled.

---

## 11. Search Implementation

Phase 1:

- structured filters
- title/summary/message text search
- customer/employee/supplier filters
- status/category/deadline filters

Phase 2:

- semantic search
- natural language query support
- similar request retrieval
- complaint pattern detection

---

## 12. Manual Test Strategy

Manual testing must happen after every 2-3 implemented coding moments.

Each moment should be marked as one of:

- Solved
- Bug
- Cannot assess
- Waiting for decision
- Re-test required

Required test areas:

- role visibility
- admin internal discussion leakage prevention
- external notes visibility
- confirmation buttons
- reopen on "No"
- snooze return behavior
- emergency claim/escalation
- linked request visibility
- rating visibility
- audit trail correctness

---

## 13. Suggested Build Order

### Phase 1: Request Core

- schema
- request list
- request detail
- status/category/priority
- owner and next responsible party
- audit log

### Phase 2: Communication Panels

- admin internal discussion
- external communication
- external user notes visible to admin
- visibility tests

### Phase 3: Confirmation Flow

- admin resolved state
- two-button external confirmation
- reopen on No
- close on Yes
- audit logging

### Phase 4: Inbox Zero / Snooze

- hide for me/team
- return date
- return on reply
- deadline warning return

### Phase 5: Emergency

- emergency creation
- notification bridge placeholder
- claim/take request
- escalation rules
- stabilized state

### Phase 6: Advanced Features

- linked requests
- ratings
- search
- reporting foundations

---

## 14. Rork Review Prompt

Use this prompt after the documents have been uploaded to GitHub:

```text
Please review the CleanOps Request Manager architecture and implementation proposal.

Focus on:
1. Whether the domain model is consistent with the existing CleanOps architecture.
2. Whether the proposed schema separates internal admin discussion, external communication, external notes and audit logs safely.
3. Whether the confirmation flow is correctly modeled with only two external actions:
   - Yes, the request is handled
   - No, I need more help
4. Whether the Inbox Zero / snooze model is safe and cannot cause requests to be forgotten.
5. Whether emergency requests should be modeled as a separate request type or as a state/priority layer.
6. Whether the suggested feature flags, repositories and routes fit the current Vite + React + Supabase codebase.
7. Which parts should be built first to minimize risk.
8. Which database tables, RLS policies and tests are required before enabling write paths.
9. Whether this should be broken into additional Development Center feature pages.

Do not implement yet. Return an architectural review, risk analysis and recommended first implementation slice.
```
