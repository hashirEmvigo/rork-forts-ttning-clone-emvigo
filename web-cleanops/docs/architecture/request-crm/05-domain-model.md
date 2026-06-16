# 05 - Domain Model

RORK must propose the final physical data model, indexes and migrations based on the existing stack. This document defines the logical model.

## Core entities

- Request
- RequestCategory
- RequestParticipant
- RequestThread
- RequestMessage
- InternalPost
- InternalPostAssignee
- Notification
- ChatSession
- AIActionLog
- RequestSnooze
- AccessRequest
- RequestReadState
- EmailOutboxJob
- SystemEvent / DomainEvent

## Request

Represents a long-lived case/communication container.

Key fields:

- id
- request_number
- tenant_id / company_id
- title
- description
- category_id
- subcategory_id
- status
- priority
- severity
- owner_admin_id
- customer_id
- source
- source_event_id
- linked_chat_session_id
- sla_due_at
- requires_attention
- is_locked
- handled_by_owner_only
- is_system_locked_thread
- closed_at
- created_by_user_id
- created_by_actor_type
- created_at / updated_at

## RequestCategory

Configurable category/group controlling routing, access, views and SLA defaults.

Key fields:

- id
- tenant_id
- name
- is_system
- default_owner_strategy
- default_priority
- default_sla_minutes
- email_policy
- visibility_policy_id
- automation_policy_ref nullable
- ai_extension_ref nullable
- active

Note: automation_policy_ref and ai_extension_ref are references to Automation & AI Center concepts, not local REQUEST-owned policy.

## RequestThread

Separate communication loop inside a request.

Thread types:

- customer
- employee
- shared_customer_employee
- internal
- ai_intake

Default rule: customer and employee threads are separate. Shared customer+employee thread requires explicit admin action or explicit centrally registered system rule.

## RequestMessage

Message in a thread. External visibility must be immutable after send except by explicit audited admin override.

## InternalPost

Internal area in a request. Supports tasks, phone calls, notes, AI summaries and system notes. Task is a hard-coded type because it requires assignment, status, comments and acknowledgement.

## Notification

Operational signal object. Do not confuse with Request. Automated notification creation policy belongs in Automation & AI Center.

## ChatSession

AI-only, admin takeover or request-converted chat session.

## AIActionLog

Local REQUEST trace for AI-related outputs. Must be cross-referenceable to Automation & AI Center AI extension/proposal/execution records when applicable.

## SystemEvent / DomainEvent

Event emitted by REQUEST or related modules. Event evaluation and resulting automation registration must be compatible with Automation & AI Center.
