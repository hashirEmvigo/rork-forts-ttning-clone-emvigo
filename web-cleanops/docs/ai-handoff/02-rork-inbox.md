# RORK Inbox

## Repository source of truth (read first)
- **Active repo:** `RiosBioz/Keymaster` — this is the working/master repository for all current and future waves.
- **Old repo:** `RiosBioz/Stadportalen` — historical/archive/frozen. Do **not** rely on it as the active repo.
- **Reason:** Rork cannot connect an existing project to an existing GitHub repository; reconnecting creates a new repository, so the active repo was migrated to `RiosBioz/Keymaster`.
- RORK must assume `RiosBioz/Keymaster` is the active repo unless explicitly overridden in writing.

## Purpose
This file contains the exact instruction RORK should execute for the next wave.

## Current instruction
Status: COMPLETE — awaiting next explicit user instruction.

## Latest completed wave
WAVE-004E-R — Administration Center left navigation UX refinement

## Latest completed ticket
- `TICKET-004E-R — Administration Center Left Navigation UX Refinement`
- Ticket path: `web-cleanops/docs/ai-handoff/tickets/TICKET-004E-R-administration-center-left-navigation-ux-refinement.md`

This was a narrow frontend UX/layout-only Administration Center refinement wave. Future RORK sessions must not start another Administration Center wave or broaden the workspace into backend search, command palette, authorization, new routes, route migration, or runtime behavior unless the user explicitly starts a new wave.

## Current baseline
WAVE-003L-R is complete and `TICKET-003L-R` remains DONE in the ticket registry. Its Admin Requests manual-create foundation is frontend/mock/local-only. Do not expand it unless a future ticket explicitly authorizes that work.

WAVE-004A-R through WAVE-004E-R are complete:
- WAVE-004A-R created the Administration Center architecture blueprint.
- WAVE-004B-R created the Super Admin Administration Center hub at `/administration`.
- WAVE-004C-R created the frontend-only Administration Center registry and local search foundation.
- WAVE-004D-R added registry coverage helpers, ownership-area metadata, validation guardrails, and display-only ownership map UI.
- WAVE-004E-R refactored `/administration` into a focused left-navigation workspace.

## Positive scope
Scope: completed WAVE-004E-R only.

Completed scope:

- refactored only the `/administration` page presentation;
- added internal left category navigation inside `/administration`;
- moved the local search field into the left Administration Center panel;
- changed the main content area to show either search results or one selected category workspace;
- added a secondary icon + text item menu for the selected category;
- kept active items linked to existing known routes;
- kept planned items disabled/non-clickable;
- preserved the existing `/administration` route, Super Admin guard, main sidebar entry, registry metadata, and local search behavior;
- added focused tests for the new UX and existing guard behavior;
- updated handoff documentation and ticket registry for TICKET-004E-R.

Everything outside this scope is out of scope.

## Required RORK behavior
RORK must:

1. Read `web-cleanops/docs/ai-handoff/01-current-objective.md`.
2. Read `web-cleanops/docs/ai-handoff/04-escalation-policy.md`.
3. Read `web-cleanops/docs/ai-handoff/05-ticket-registry.md`.
4. Read `web-cleanops/docs/ai-handoff/07-rork-conversation-reply-policy.md`.
5. Read `web-cleanops/docs/ai-handoff/08-rork-execution-discipline.md`.
6. Read the relevant active ticket file when a new wave is explicitly started.
7. Preserve the completed WAVE-004E-R boundaries unless explicitly instructed otherwise.
8. Do not start any new wave without explicit user instruction.

## Explicit non-goals
Do not implement or modify without a new explicit ticket:

- backend search service
- command palette / Cmd+K
- quick actions
- new Administration Center routes
- route migration or redirects
- sidebar/navigation behavior changes
- new permissions
- access model
- module model
- entitlement model
- Supabase/backend/runtime behavior
- analytics, notifications, activity-log writes, automation, or AI behavior
- Calculator V2 runtime
- CRM runtime
- Admin Requests runtime
- Automation & AI runtime
- Services runtime
- Media runtime
- Templates runtime
- existing settings surfaces
- a parallel settings/navigation system

Do not use `RiosBioz/Stadportalen`.

## Stop rule
TICKET-004E-R is complete. RORK should stop unless the user explicitly starts a new wave or asks for a new prompt/addendum.

## Conversation reply
After completion, report exact files changed, confirm this was frontend UX/layout-only, confirm no backend/runtime/permission/route migration/search-service changes were added, and report focused tests plus full validation result.
