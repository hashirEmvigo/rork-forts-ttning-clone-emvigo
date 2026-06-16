# 01-request-management-dev-center.md

## Request Management - Development Center Specification

**Version:** 0.1  
**Purpose:** Define how the Request Manager should be planned, implemented, tested and reviewed in CleanOps Development Center.

---

## 1. Development Center Principle

Request Manager is a heavy operational module. It must not be implemented as one large untracked feature.

Each major function must have its own Development Center page with:

- scope
- business rules
- technical design
- coding moments
- acceptance criteria
- manual test plan
- manual test result
- bug notes
- GitHub/PR reference
- Rork/AI review notes
- decision log

Development should proceed in small implementation slices. After 2-3 coding moments, the product owner manually tests the result and marks each moment.

---

## 2. Manual Validation Statuses

Every coding moment should support one of these statuses:

```text
[ ] Not started
[ ] In progress
[ ] Ready for manual testing
[ ] Solved
[ ] Bug
[ ] Cannot assess
[ ] Waiting for decision
[ ] Re-test required
[ ] Approved
```

The product owner manually marks results after testing.

---

## 3. Recommended Feature Pages

Create these Development Center pages:

```text
RM-010 Request Core
RM-020 Communication Panels
RM-030 Confirmation Flow
RM-040 Inbox Zero / Snooze
RM-050 Emergency Requests
RM-060 Linked Requests
RM-070 Ratings and Feedback
RM-080 Search
RM-090 Notification Center Integration
RM-100 Reporting and KPI Foundations
RM-110 Permissions and Audit
```

---

## 4. Feature Page Template

Each Development Center page should follow this structure:

```markdown
# RM-XXX Feature Name

## Purpose

## Scope

## Out of Scope

## Business Rules

## UX / User Flow

## Data Model Impact

## Repository / Service Impact

## Permission Rules

## Edge Cases

## Coding Moments

| ID | Moment | Status | Notes |
|---|---|---|---|
| RM-XXX-01 | ... | Not started |  |
| RM-XXX-02 | ... | Not started |  |

## Acceptance Criteria

## Manual Test Plan

## Manual Test Result

| Test | Result | Notes |
|---|---|---|
| ... | Not tested |  |

## Bugs Found

## GitHub / PR Reference

## Rork / AI Review

## Decision Log

## Next Step
```

---

## 5. RM-010 Request Core

### Purpose

Create the basic request object, list view, detail view, ownership model and audit foundation.

### Suggested Coding Moments

| ID | Moment | Status |
|---|---|---|
| RM-010-01 | Create request schema/migration draft | Not started |
| RM-010-02 | Create request repository read model | Not started |
| RM-010-03 | Create request list UI | Not started |
| RM-010-04 | Create request detail UI shell | Not started |
| RM-010-05 | Add status/category/priority fields | Not started |
| RM-010-06 | Add owner and next responsible party fields | Not started |
| RM-010-07 | Add audit log foundation | Not started |

### Acceptance Criteria

- A request can be represented with status, category, priority, owner and next responsible party.
- The request list can show active requests.
- The request detail page can load one request.
- Audit events are created for critical state changes.

---

## 6. RM-020 Communication Panels

### Purpose

Implement separated communication surfaces.

### Required Panels

Admin view:

- admin internal discussion
- external communication
- metadata/action panel

External view:

- my notes - visible to admin
- external communication
- simplified status/actions

### Suggested Coding Moments

| ID | Moment | Status |
|---|---|---|
| RM-020-01 | Build admin internal discussion panel | Not started |
| RM-020-02 | Build external communication panel | Not started |
| RM-020-03 | Build external notes panel visible to admin | Not started |
| RM-020-04 | Add role-based rendering | Not started |
| RM-020-05 | Add repository-level visibility filtering | Not started |
| RM-020-06 | Add leakage tests/manual validation | Not started |

### Acceptance Criteria

- Admin internal discussion is never visible to external users.
- External user's notes are visible to admin but not other external parties.
- External conversation is visible only to permitted participants.

---

## 7. RM-030 Confirmation Flow

### Purpose

Implement the controlled closure model.

### Business Rule

External confirmation must show exactly two buttons:

- Yes, the request is handled
- No, I need more help

There must be no separate comment button.

### Suggested Coding Moments

| ID | Moment | Status |
|---|---|---|
| RM-030-01 | Add admin resolved / awaiting confirmation status | Not started |
| RM-030-02 | Build external confirmation panel | Not started |
| RM-030-03 | Implement Yes -> closed transition | Not started |
| RM-030-04 | Implement No -> reopened + open message input | Not started |
| RM-030-05 | Reopen when external user sends new message | Not started |
| RM-030-06 | Add confirmation audit events | Not started |

### Acceptance Criteria

- Admin can mark request as handled.
- External user sees only the two confirmation buttons.
- Yes closes the request.
- No reopens the request and lets the user write in the normal external conversation.
- All transitions are auditable.

---

## 8. RM-040 Inbox Zero / Snooze

### Purpose

Allow admins to hide requests temporarily without losing operational control.

### Suggested Coding Moments

| ID | Moment | Status |
|---|---|---|
| RM-040-01 | Add request_snoozes model | Not started |
| RM-040-02 | Add hide for me action | Not started |
| RM-040-03 | Add hide for team/office action | Not started |
| RM-040-04 | Add return at time behavior | Not started |
| RM-040-05 | Add return on external reply behavior | Not started |
| RM-040-06 | Add deadline/SLA warning return behavior | Not started |
| RM-040-07 | Add safety restrictions for emergency and overdue requests | Not started |

### Acceptance Criteria

- Snoozed requests disappear from correct active views.
- Snoozed requests return automatically.
- External replies cancel snooze.
- Emergency requests cannot be hidden unsafely.

---

## 9. RM-050 Emergency Requests

### Purpose

Create a separate operational emergency workflow.

### Suggested Coding Moments

| ID | Moment | Status |
|---|---|---|
| RM-050-01 | Add emergency request type/statuses | Not started |
| RM-050-02 | Build emergency creation flow | Not started |
| RM-050-03 | Build emergency list/view | Not started |
| RM-050-04 | Add Take request / claim action | Not started |
| RM-050-05 | Add escalation timer model | Not started |
| RM-050-06 | Add mark emergency stabilized action | Not started |
| RM-050-07 | Add notification bridge placeholder | Not started |

### Acceptance Criteria

- Emergency requests are visually and logically separate from ordinary requests.
- Admin can claim/take an emergency request.
- Unclaimed emergency requests escalate.
- Stabilized emergency requests can move to follow-up.

---

## 10. RM-060 Linked Requests

### Purpose

Allow requests to be connected through explicit relation types.

### Suggested Coding Moments

| ID | Moment | Status |
|---|---|---|
| RM-060-01 | Add request_links model | Not started |
| RM-060-02 | Add link request action | Not started |
| RM-060-03 | Add create child request from existing request | Not started |
| RM-060-04 | Add linked request panel | Not started |
| RM-060-05 | Add relation type labels | Not started |
| RM-060-06 | Add visibility-safe navigation | Not started |

---

## 11. RM-070 Ratings and Feedback

### Purpose

Support external feedback on admin handling and internal admin assessment of employee handling.

### Suggested Coding Moments

| ID | Moment | Status |
|---|---|---|
| RM-070-01 | Add rating model | Not started |
| RM-070-02 | Add external rating flow | Not started |
| RM-070-03 | Add internal employee handling assessment | Not started |
| RM-070-04 | Add low-rating follow-up flag | Not started |
| RM-070-05 | Add permission controls | Not started |

---

## 12. RM-080 Search

### Purpose

Enable structured and text-based request discovery.

### Suggested Coding Moments

| ID | Moment | Status |
|---|---|---|
| RM-080-01 | Add structured filters | Not started |
| RM-080-02 | Add text search across permitted fields | Not started |
| RM-080-03 | Add customer/employee/supplier filters | Not started |
| RM-080-04 | Add saved views/search presets | Not started |
| RM-080-05 | Prepare semantic search design | Not started |

---

## 13. RM-090 Notification Center Integration

### Purpose

Prepare request events for the future CleanOps notification center.

### Suggested Coding Moments

| ID | Moment | Status |
|---|---|---|
| RM-090-01 | Add request notification event model | Not started |
| RM-090-02 | Emit event on emergency created | Not started |
| RM-090-03 | Emit event on assignment | Not started |
| RM-090-04 | Emit event on deadline warning | Not started |
| RM-090-05 | Emit event on reopen | Not started |
| RM-090-06 | Add notification center bridge contract | Not started |

---

## 14. RM-100 Reporting and KPI Foundations

### Purpose

Prepare reporting without building full analytics too early.

### Suggested Coding Moments

| ID | Moment | Status |
|---|---|---|
| RM-100-01 | Store first response timestamps | Not started |
| RM-100-02 | Store resolution timestamps | Not started |
| RM-100-03 | Store confirmation timestamps | Not started |
| RM-100-04 | Store emergency claim/stabilization timestamps | Not started |
| RM-100-05 | Add basic KPI query draft | Not started |

---

## 15. RM-110 Permissions and Audit

### Purpose

Ensure visibility safety and traceability across all Request Manager features.

### Suggested Coding Moments

| ID | Moment | Status |
|---|---|---|
| RM-110-01 | Define permission matrix | Not started |
| RM-110-02 | Add repository-level permission filters | Not started |
| RM-110-03 | Add RLS policy draft | Not started |
| RM-110-04 | Add audit event registry | Not started |
| RM-110-05 | Add manual permission test matrix | Not started |

---

## 16. GitHub + Rork Review Workflow

Recommended workflow:

1. Implement 2-3 coding moments.
2. Product owner manually tests those moments.
3. Product owner marks each moment as Solved, Bug, Cannot assess, Waiting for decision or Re-test required.
4. Push to GitHub / open PR.
5. Ask Rork for architectural and implementation review.
6. Paste Rork review into the relevant Development Center page.
7. Fix critical findings before continuing.
8. Continue with the next 2-3 coding moments.

---

## 17. Rork Review Prompt for Development Center

```text
Please review the Request Manager Development Center breakdown.

Focus on:
1. Whether the feature pages are correctly separated.
2. Whether the suggested coding moments are small enough for manual validation after every 2-3 steps.
3. Whether any feature should be moved earlier or later in the build order.
4. Whether the permission and audit work needs to be built before some UI features.
5. Whether emergency requests, confirmation flow and snooze are sufficiently isolated to avoid regressions.
6. Whether the proposed manual validation statuses are practical for product-owner testing.
7. Whether this aligns with the current CleanOps Development Center architecture.

Do not implement yet. Return recommended adjustments and a safe first build slice.
```
