# 22 - Implementation Phases

This is internal build order, not external release order.

## Phase 0 - Architecture validation

RORK/Claude returns implementation plan only. No code.

Required output:

- repo analysis
- data model proposal
- migrations order
- API contracts
- component tree
- feature flags
- test plan
- risks and dependencies
- build order
- Automation & AI Center integration map

## Slice 0 - Frontend shell and automation readiness

UI shell only with mock/static data.

Includes:

- CRM nav
- dashboard shell
- request list shell
- request detail 3-column shell
- notification center shell
- chat inbox shell
- settings shell
- automation quick-review placeholders
- mock data

No backend automation, no live AI, no production notification runner.

## Phase 1 - Foundation/domain schema

Core tables, roles, categories, audit, feature flags and test mode.

## Phase 2 - Request Core

Create/list/open request, metadata and 3-column admin UI.

## Phase 3 - Threads and visibility

Customer/employee/shared/internal threads and visibility scopes.

## Phase 4 - Internal posts/tasks

Task posts, assignees, comments, acknowledgement and read state.

## Phase 5 - Notification Center v1

Notification domain objects, status changes and create-request-from-notification. Automated creation policy must remain central-ready.

## Phase 6 - Chat v1 + mock AI

Chat sessions, mock AI, convert to request and transcript summary.

## Later phases

- advanced visibility
- email outbox
- AI provider suggestion mode
- emergency popup
- inbound email reply
- hardening/regression
