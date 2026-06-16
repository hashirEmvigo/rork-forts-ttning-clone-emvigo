# TICKET-002 - REQUEST CRM Implementation Plan

## Goal
Analyze the saved REQUEST CRM v0.2 documentation package, the current codebase, and the Automation & AI Center Runtime Safety v3 architecture package. Produce a technical implementation plan only.

## Scope
RORK may inspect the repository and documentation package.

RORK may create or update only planning/reporting documentation, preferably:

- `web-cleanops/docs/architecture/request-crm/implementation-plan.md`
- `web-cleanops/docs/ai-handoff/03-rork-outbox.md`
- `web-cleanops/docs/ai-handoff/05-ticket-registry.md`
- `web-cleanops/docs/ai-handoff/06-verification-report.md`

If the target architecture folder does not exist, RORK may create it under `web-cleanops/docs/architecture/request-crm/`.

## Non-goals
Do not implement product code yet.
Do not create migrations yet.
Do not create routes/pages yet.
Do not create UI components yet.
Do not start Slice 0 yet.
Do not create live automation, live AI, notification engine, email outbox, runtime guards, kill switches, or circuit breaker enforcement yet.

## Architecture rules
REQUEST CRM owns:

- request domain model
- request categories/types
- request threads
- request messages
- internal posts/tasks
- task acknowledgement/read state
- request visibility/access behavior
- snooze / handle-self / locked request domain behavior
- notification objects
- chat sessions
- request-related settings shell
- domain events emitted by the communication platform
- local quick-review UI surfaces

Automation & AI Center owns:

- automation registry
- AI extension registry
- risk levels
- execution policy
- approval policy
- runtime guard policy
- runtime flags and kill switches
- circuit breaker visibility
- execution logs
- incident logs
- central automation/AI history
- source-of-truth configuration for automation and AI behavior

REQUEST CRM must not create its own hidden automation framework.
Notification rules, AI settings, emergency routing, access-request escalation, snooze triggers, SLA warnings, email-delivery warnings, and chat escalation must be Automation & AI Center compatible.

## Required repository analysis
Identify:

- existing routing structure
- existing Super Admin / Company Admin navigation patterns
- existing CRM/customer/request-related components, if any
- existing notification-related logic, if any
- existing chat-related logic, if any
- existing settings structure
- existing feature flag pattern
- existing audit/activity log pattern
- existing test setup
- existing mock-data or seed-data conventions
- existing documentation conventions

## Required documentation alignment
Confirm that the following documentation areas are now available and identify their paths:

- REQUEST CRM architecture docs
- REQUEST CRM ADRs
- REQUEST CRM UI specs
- REQUEST CRM schemas
- REQUEST CRM mock-data
- REQUEST CRM TypeScript contracts
- REQUEST CRM RORK prompts/review gates
- Automation & AI Center integration standard

Report any missing documents, conflicting documents, duplicate docs, or path deviations.

## Required implementation plan sections
Save the implementation plan to:

`web-cleanops/docs/architecture/request-crm/implementation-plan.md`

The plan must include:

A. Current repo findings
- Exact existing files/directories inspected and relevant observations.

B. Proposed route/page structure
Recommend routes for:
- CRM / Request dashboard
- Request list
- Request detail
- Notification Center
- Chat inbox
- Settings shell

Specify whether these should live under Super Admin, Company Admin, or shared admin routes based on current app structure.

C. Frontend component architecture
Propose component structure for:
- CRM dashboard shell
- Request list/table
- Request detail three-column layout
- internal posts/tasks column
- external conversation column
- request metadata/right-side panel
- Notification Center shell
- Chat inbox shell
- Settings shell
- Automation & AI quick-review panels

D. Data/domain model proposal
Propose logical entities and future physical tables for:
- requests
- request_categories
- request_types
- request_threads
- request_messages
- internal_posts
- internal_post_assignees
- notifications
- chat_sessions
- ai_action_logs or AI proposal references
- request_snoozes
- access_requests
- request domain events

Do not create migrations yet. This is a planning proposal only.

E. API/service boundary proposal
Propose service boundaries and endpoint candidates for:
- requests
- request threads/messages
- internal posts/tasks
- notifications
- chat sessions
- settings shell
- domain events
- AI mock/service adapter
- future email outbox/inbound handling

F. Permissions/access strategy
Propose how to model:
- RBAC + ABAC
- owner/support/category access
- locked request metadata preview
- request access workflow
- superadmin/company admin override
- customer/employee visibility separation
- audit requirements

G. Event/domain-event strategy
Define the domain event pattern REQUEST CRM should emit.

Include examples:
- request.created
- request.customer_message_received
- request.employee_message_received
- request.status_changed
- request.snoozed
- request.unsnoozed
- request.access_requested
- request.emergency_created
- chat.ai_unable_to_resolve
- notification.acknowledged
- internal_task.assigned
- internal_task.acknowledged

Explain how these become candidates for Automation & AI Center without implementing the automation engine now.

H. Notification Center v1 plan
Plan a simple Notification Center v1 that owns notification objects and UI behavior only.

It must not become a hidden rule engine.

Clarify:
- notification object model
- severity/status model
- acknowledge/handle/dismiss behavior
- linked object behavior
- create-request-from-notification behavior
- which parts must remain future Automation & AI Center responsibility

I. Chat + mock-AI plan
Plan Chat v1 with mock-AI only.

Clarify:
- chat session states
- AI intake mock responses
- create request draft/from chat
- admin takeover placeholder
- transcript/summary handling
- no real AI provider yet
- future AI extension linkage to Automation & AI Center

J. Settings shell plan
Plan a settings shell, not a full rule builder.

Settings shell may include:
- request categories
- request types
- statuses
- priority/severity labels
- SLA defaults
- email policy placeholders
- internal post types
- visibility/access defaults
- notification type labels
- AI policy placeholders
- Automation & AI Center links

Settings shell must not implement:
- full visual rule builder
- standalone notification automation engine
- standalone AI rule engine
- production runtime safety controls

K. Feature flag plan
Propose feature flags for:
- request platform
- request manager
- notification center
- chat
- AI mock
- AI provider later
- email outbound later
- email inbound later
- request snooze
- handle self
- locked requests
- emergency popup
- test mode
- external customer/employee exposure

L. Test strategy
Plan tests for:
- frontend shell
- mock-data rendering
- request list/detail navigation
- three-column request layout
- visibility indicators
- notification shell behavior
- chat shell behavior
- settings shell behavior
- feature flag behavior
- no live automation execution
- no external customer/employee exposure
- no runtime guard enforcement in Slice 0

M. Seed/mock-data strategy
Propose how mock-data should be organized for Slice 0:
- request categories
- request types
- request list
- request detail
- internal posts/tasks
- notifications
- chat sessions
- dashboard cards
- domain events
- automation candidates
- settings shell data
- runtime safety indicators

N. Implementation slices
Recommend phased implementation slices.

Required first slice:

Slice 0: Frontend shell + mock data only

Slice 0 may include:
- CRM navigation shell
- Request dashboard shell
- Request list shell
- Request detail three-column shell
- Notification Center shell
- Chat inbox shell
- Settings shell
- read-only mock data
- read-only filters
- Automation & AI quick-review placeholders
- feature flag placeholders
- documentation links

Slice 0 must not include:
- live backend automation
- real AI provider
- production notification engine
- production email outbox
- inbound email processing
- real rule engine
- real runtime guards
- real kill switch enforcement
- real circuit breaker enforcement
- customer/employee external release
- irreversible domain mutations
- production migrations unless explicitly approved later

Then propose later slices for:
- domain schema
- request core
- threads/visibility
- internal posts/tasks
- notification center v1
- chat v1 + mock AI
- snooze/handle-self/locked requests
- email outbound
- AI provider suggestion mode
- inbound email
- hardening/regression

O. Risk and blocker review
Identify:
- architectural risks
- implementation risks
- access/visibility risks
- Automation & AI Center alignment risks
- performance/runtime safety risks
- data cleanup risks
- current repo blockers
- documentation gaps

P. Recommended next prompt
End by writing the exact next prompt we should send to implement Slice 0 after the plan is reviewed and approved.

## Output requirements
Return and save:

- documentation paths confirmed
- repo findings
- technical implementation plan
- proposed slices
- risks/blockers
- open questions
- exact next Slice 0 implementation prompt

## Verification
No build/test is required unless RORK changes code, which is not allowed.
RORK must verify that only documentation/planning/handoff files were changed.

## Conversation reply policy
After completing the wave, RORK must follow:

`web-cleanops/docs/ai-handoff/07-rork-conversation-reply-policy.md`

RORK should only write a short completion signal in the RORK conversation. The full plan and report must be saved in GitHub.

## Escalation
RORK must stop and mark this ticket BLOCKED if:

- the uploaded REQUEST CRM v0.2 documentation package cannot be found,
- the Automation & AI Center Runtime Safety v3 architecture package cannot be found,
- the current codebase cannot be inspected sufficiently,
- or a requested planning decision conflicts with existing architecture.
