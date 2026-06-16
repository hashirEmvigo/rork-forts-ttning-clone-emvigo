# 33-request-management-architecture.md

> **SUPERSEDED (v0.1).** This document is superseded by the **REQUEST CRM v0.2
> (Automation & AI Center aligned)** package at `../request-crm/`
> (start at `../request-crm/00-index.md`). Retained for history only;
> do not use for new planning.

## Request Management Architecture

**Version:** 0.1  
**Scope:** CleanOps Request Manager / operational communication hub  
**Audience:** Rork, developers, product owner, future architecture reviews

---

## 1. Purpose

The Request Manager is the central communication channel for the business. It must connect administration, customers, employees and suppliers in one traceable, role-based operational workflow.

The system must replace scattered email, phone calls and informal notes with a controlled request model where every request has:

- an owner
- a next responsible party
- a next action
- a status
- a deadline or follow-up rule
- a complete audit trail
- clear visibility boundaries between internal and external communication

The target principle is:

> No request may exist without a clear next action and a responsible party.

---

## 2. Core Product Principles

| Principle | Meaning |
|---|---|
| Next action first | Every request must clearly show who must do what next. |
| Hidden is not forgotten | Snoozed/hidden requests are temporarily removed from active views but must automatically return. |
| Admin resolved is not externally confirmed | Admin can mark a request as handled, but final closure depends on recipient confirmation or a controlled auto-close rule. |
| Emergency is a separate workflow | Emergency requests are not just high-priority ordinary requests; they need claim, escalation and alert rules. |
| Internal and external communication must be strictly separated | Incorrect visibility is a critical security and trust bug. |
| The system should reduce phone calls | Especially for sickness, delays, alarms, access problems and urgent employee/customer incidents. |
| Everything important must be logged | Status changes, ownership, snooze, reopen, confirmation, ratings and escalation must be auditable. |

---

## 3. Roles

| Role | Description |
|---|---|
| Admin | Office user who handles requests. |
| Super Admin | Can see and administer the full system. |
| Customer | External customer user who can create and follow own requests. |
| Employee | Operational employee who can create requests, emergency requests and confirm information. |
| Supplier | External supplier with limited access to requests where they are a participant. |
| Customer Responsible Admin | Admin primarily responsible for a customer. |
| Area Responsible Admin | Admin responsible for a geographic or operational area. |
| Watcher | Internal user following a request without being the next responsible party. |
| Backup Responsible | User who receives the request if the primary owner is absent or escalation is triggered. |

---

## 4. Communication Model

Each request must support separated communication surfaces.

### 4.1 Admin View

The admin view must include:

1. **Left panel: Admin internal discussion**  
   Visible only to admins, super admins and explicitly permitted internal roles. Used for internal reasoning, case assessment, complaint analysis, operational coordination and internal follow-up.

2. **External communication panel**  
   The actual dialogue between admin and connected external parties: customer, employee or supplier.

3. **Metadata/action panel**  
   Shows status, category, priority, deadline, SLA, owner, next responsible party, snooze state, linked requests, confirmation state, ratings and audit history.

### 4.2 External User View

For customer, employee and supplier users, the request must include:

1. **Left panel: My notes - visible to admin**  
   The external user may write own notes connected to the request. These notes are visible to admin but not to other external parties. This panel must not be labelled private, because admin can read it.

2. **External communication panel**  
   The normal conversation with admin.

3. **Simplified request status**  
   External users see only safe status information and actions relevant to them.

### 4.3 Visibility Rule

- Admin internal discussion must never be visible to external parties.
- External user's notes are visible to admin but not to other external parties.
- External communication is visible according to participant rules.
- Audit/system logs are visible according to role permissions.

---

## 5. Request Types

The system must support at least two top-level request types.

### 5.1 Ordinary Request

Used for normal business communication such as:

- customer support
- finance questions
- booking changes
- standard complaints
- supplier orders
- non-urgent schedule changes
- general questions

Ordinary requests use normal categorization, deadlines, reminders and ownership rules.

### 5.2 Emergency Request

Emergency requests must be treated as a separate operational workflow.

Examples:

- employee sickness before a scheduled customer visit
- employee delay to customer
- customer alarm/security incident
- employee cannot access customer premises
- urgent customer staffing problem
- serious service failure requiring immediate action
- key, lock or alarm issue

Emergency requests require:

- prominent notification
- claim/take ownership action
- escalation if not claimed in time
- restricted snooze rules
- fast operational status updates
- notification to responsible customer/area admin
- after-action follow-up when the emergency phase is stabilized

---

## 6. Status Model

Recommended high-level statuses:

| Status | Meaning |
|---|---|
| New | Request is created but not triaged. |
| Requires admin | Admin or office team must act. |
| In progress | Admin is actively handling the request. |
| Waiting for customer | Admin is waiting for customer input. |
| Waiting for employee | Admin is waiting for employee input or confirmation. |
| Waiting for supplier | Admin is waiting for supplier response. |
| Waiting for internal action | A colleague/internal role must act. |
| Snoozed | Temporarily hidden until a defined date/event. |
| Admin resolved - awaiting confirmation | Admin considers the request handled; recipient must confirm. |
| Reopened | External party responded or stated that more help is needed. |
| Closed | Request is fully closed. |
| Emergency active | Emergency requires immediate action. |
| Emergency stabilized | Acute phase is handled, follow-up remains. |

Important rule:

> Snoozed is a visibility/workflow state, not a final completion state.

---

## 7. Inbox Zero / Snooze Model

The Request Manager must support an operational inbox-zero workflow.

Admin must be able to hide requests temporarily when no action is currently needed from the office.

Examples of quick actions:

- Hide for me for 2 days
- Hide for office/team for 2 days
- Wait for customer
- Wait for employee
- Wait for supplier
- Hide until Monday 08:00
- Hide until deadline/reminder
- Hide until external party replies

A snoozed request must automatically return when:

- the snooze time expires
- the external party replies
- the deadline approaches
- the SLA enters warning state
- an emergency escalation occurs
- a manual reopen action is taken

Safety rules:

- Emergency requests must not be hidden without assignment and escalation protection.
- Overdue requests must not be hidden without a new deadline or escalation decision.
- A request where the current admin is the next responsible party must not be hidden unless a valid next action is set.
- Hide for office/team requires clear reason, waiting state or future return condition.

---

## 8. Confirmation Flow

When admin considers a request handled, the request should enter:

**Admin resolved - awaiting confirmation**

The external participant receives exactly two actions:

1. **Yes, the request is handled**
2. **No, I need more help**

There must be no separate "Write comment" button in this confirmation step.

Rules:

- If the user clicks **Yes**, the request becomes closed.
- If the user clicks **No**, the request is reopened and the normal external communication input opens.
- If the user replies in the external conversation, the request is reopened.
- Admin must see confirmation state and timestamp.
- The audit log must record who confirmed or reopened the request.

Optional later rule:

- Auto-close after X days without response, depending on category and customer configuration.

---

## 9. Ratings and Feedback

Two separate feedback flows are required.

### 9.1 External Feedback on Admin Handling

After a request is resolved/closed, customer/employee/supplier may rate the handling.

Possible dimensions:

- response quality
- clarity
- speed
- outcome satisfaction

Low rating may create an internal follow-up request or flag.

### 9.2 Admin Feedback on Employee Handling

Admin may internally rate or assess an employee's handling of a request. This is never visible to customers.

Possible dimensions:

- communication
- responsibility
- professionalism
- operational execution
- follow-up quality

This must be permission-controlled and should be treated as quality follow-up, not a punitive public score.

---

## 10. Linked Requests

Requests must be linkable using explicit relation types.

| Relation | Example |
|---|---|
| Child request | Customer complaint creates internal employee follow-up. |
| Related request | Several requests concern the same customer event. |
| Duplicate | Two users report the same issue. |
| Caused by | Internal operational failure caused customer complaint. |
| Follow-up of | New request follows a previous closed request. |
| Escalation of | Ordinary request becomes emergency. |
| Merged with | Two requests are consolidated into one main request. |

Linked request visibility must respect each request's permission model.

---

## 11. Notification Model

The future notification center must integrate with Request Manager.

Emergency notification must show:

- emergency type
- customer/area
- short summary
- time since creation
- responsible admin/area admin
- claim state
- deadline/SLA timer
- quick actions

Recommended quick actions:

- Take request
- Assign colleague
- Send template response
- Mark phone call required
- Escalate
- Mark emergency stabilized

Ordinary notifications should be lower intensity and primarily used for:

- deadline warning
- SLA risk
- request reopened
- confirmation missing
- assigned to me
- external party replied

---

## 12. Search Model

The Request Manager must support both structured and full-text/semantic search.

Structured filters:

- customer
- employee
- supplier
- category
- status
- priority
- deadline
- request type
- owner
- next responsible party
- created date
- updated date
- emergency state
- linked requests

Free-text search must search external messages, permitted internal notes, request titles and metadata.

Future semantic search examples:

- "Show all complaints about late arrival during the last three months."
- "Find all requests mentioning alarm, keys or access problems."
- "Show reopened requests related to customer X."

---

## 13. Reporting and KPIs

The system should later support operational reporting:

- number of requests by category
- first response time
- resolution time
- confirmation time
- SLA breaches
- emergency request count
- emergency claim time
- reopened request rate
- customer satisfaction score
- complaints by customer/employee/category
- snoozed request count per admin/team
- requests without owner
- requests waiting too long for external response

---

## 14. High-Level Data Model

Suggested domain entities:

- request
- request_participant
- request_message
- request_internal_note
- request_external_note
- request_status_event
- request_assignment
- request_snooze
- request_confirmation
- request_rating
- request_link
- request_attachment
- request_audit_log
- request_notification_event

Key design requirement:

> Messages, internal discussions, external notes and audit events must not be stored as one undifferentiated blob. Visibility and auditability require explicit separation.

---

## 15. Non-Negotiable Security Rules

- Admin internal discussion must never leak to customers, employees or suppliers.
- Customer/employee/supplier notes must not be visible to other external parties.
- Permission checks must exist at repository/API level, not only in UI.
- Audit events must be append-only or otherwise tamper-resistant.
- Rating visibility must be role-controlled.
- Emergency request access must be broad enough for operational handling but still tenant-scoped.

---

## 16. Recommended Build Strategy

Build in controlled phases:

1. Request core
2. Communication panels
3. Confirmation flow
4. Inbox Zero / snooze
5. Emergency requests
6. Linked requests
7. Ratings
8. Search
9. Notification Center integration
10. Reporting/KPI foundations

Each heavy function should get its own Development Center page.
