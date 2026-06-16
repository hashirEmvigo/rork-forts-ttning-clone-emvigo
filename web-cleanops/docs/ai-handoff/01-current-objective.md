# Current Objective

## Repository source of truth
- **Active repo (use this):** `RiosBioz/Keymaster`
- **Old repo (historical/archive/frozen):** `RiosBioz/Stadportalen`
- **Reason:** Rork cannot connect an existing project to an existing GitHub repository; reconnecting creates a new repository. The active working/master repository was therefore migrated to `RiosBioz/Keymaster`.
- **Rule:** All future work must assume `RiosBioz/Keymaster` is the active repo unless explicitly overridden in writing. Treat `RiosBioz/Stadportalen` as historical/archive only.

## Purpose
This file defines the current high-level objective for the active RORK execution wave.

## Current status
Status: COMPLETE — awaiting next explicit user instruction.

## Objective
Complete **TICKET-004E-R — Administration Center Left Navigation UX Refinement** as a narrow frontend UX/layout-only Administration Center implementation slice.

This completed wave refines the existing `/administration` Super Admin Administration Center from a large catalogue-style page into a focused workspace with internal left category navigation, selected-category content, a secondary item menu, and left-panel local search. It preserves the Administration Center as a Super Admin finder/workspace only, not a replacement for existing settings, routes, modules, CRM/Admin Requests, Calculator V2, Services, Media, Templates, Automation & AI Center, or Company Admin surfaces.

## Latest completed wave
Wave: WAVE-004E-R — Administration Center left navigation UX refinement

## Latest completed ticket
- `TICKET-004E-R — Administration Center Left Navigation UX Refinement`
- Path: `web-cleanops/docs/ai-handoff/tickets/TICKET-004E-R-administration-center-left-navigation-ux-refinement.md`

## Current baseline after WAVE-004E-R
1. WAVE-003L-R remains complete and `TICKET-003L-R` remains DONE in the registry.
2. WAVE-004A-R created the Administration Center architecture blueprint.
3. WAVE-004B-R created the Super Admin Administration Center hub at `/administration`.
4. WAVE-004C-R created the frontend-only Administration Center registry and local search foundation.
5. WAVE-004D-R added registry coverage/ownership helpers and display-only ownership map UI.
6. WAVE-004E-R refactored `/administration` into a focused left-navigation workspace.
7. Administration Center registry metadata must not be treated as authorization; existing destination route guards remain authoritative.
8. Existing Admin Requests, Calculator V2, CRM, Automation & AI, Services, Media, Templates, and settings surfaces must be preserved unless a future ticket explicitly authorizes changes.

## Positive scope
Scope: completed WAVE-004E-R only.

In scope:
- refactor only the existing `/administration` page presentation;
- add internal left category navigation inside `/administration`;
- show only one selected category's workspace at a time;
- add a secondary icon + text item menu for the selected category;
- move local search into the left Administration Center panel;
- show local registry search results in the main content area when searching;
- keep planned items disabled/non-clickable and active items linked only to existing routes;
- update focused tests for the new workspace behavior and existing guard behavior;
- update handoff documentation for TICKET-004E-R.

Everything outside this scope is out of scope.

## Required output
TICKET-004E-R is complete. Future RORK sessions must not start another Administration Center wave or broaden this workspace into backend search, command palette, authorization, new routes, route migration, or runtime behavior unless the user explicitly instructs a new wave.

## Core rules
- Frontend UX/layout-only refinement on `/administration`.
- Local search remains frontend-only registry filtering.
- No backend, Supabase, persistence, analytics, notifications, automation, AI, or activity-log writes.
- No new routes, route migration, route redirects, sidebar/navigation behavior changes, package/config changes, or tests outside focused Administration Center coverage.
- No new permissions, modules, entitlements, feature flags, access model, module model, or entitlement model.
- Do not modify Calculator V2 runtime, CRM/Admin Requests runtime, Automation & AI runtime, Services runtime, Media runtime, Templates runtime, or existing settings behavior unless a future ticket explicitly authorizes it.
- Do not use `RiosBioz/Stadportalen`.

## Expected result
The Administration Center now feels like a focused Super Admin workspace: a single main sidebar route opens `/administration`, internal left navigation selects one category at a time, a secondary menu selects items within that category, local search shows focused results in the main area, planned items remain disabled, `TICKET-004E-R` is recorded as DONE, and the next wave should only begin after explicit user instruction.
