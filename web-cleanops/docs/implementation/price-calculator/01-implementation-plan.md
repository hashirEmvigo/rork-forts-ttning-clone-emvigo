# Implementation Plan - Price Calculator MVP

**Audience:** RORK / GPT-5.5 High  
**Project:** CleanOps / Stadportalen / Price Calculator  
**Instruction level:** Treat this as implementation guidance for repository analysis, architecture validation, and phased build planning. The human project owner does not need explanatory simplification. Be precise, conservative, and repo-grounded.

---
## Phase 0 - Repo analysis

No code. Inspect current app and return implementation plan.

## Phase 1 - Documentation registration

- Add module to dev-center/backlog indexes if required.
- Mark CRM as deferred.
- Add risk notes.

## Phase 2 - Data layer

- Add migrations or migration proposals.
- Add types.
- Add repository functions.
- Add RLS policies.
- Add seed/default config if existing seed strategy supports it.

## Phase 3 - Pricing engine

- Implement pure functions.
- Add unit tests.
- Keep formulas versioned.
- Store calculation traces.

## Phase 4 - Settings UI

- Add company admin settings page/section.
- Configure services.
- Configure cleaning plans and rates.
- Configure basic pricing values.
- Configure quote behavior.

## Phase 5 - Public calculator UI

- Build full-page layout.
- Build service selector.
- Build form flow for home cleaning and move-out cleaning.
- Build price preview.
- Build right-side FAQ/help panel.

## Phase 6 - Submission flow

- Validate fields.
- Recalculate price through trusted logic.
- Create prospect.
- Create quote request.
- Store answers.
- Show quote-created state.

## Phase 7 - Login handoff

- Integrate with existing login/magic-link mechanism if present.
- Otherwise, create a safe placeholder that routes to existing login.
- Do not implement new auth system without explicit approval.

## Phase 8 - QA and hardening

- Unit tests.
- Repository tests.
- UI tests if test framework supports.
- Manual QA runbook.
- Verify no localStorage regression.
- Verify tenant isolation.

## Phase 9 - Review for future CRM

- Confirm records contain enough source/status fields.
- Do not build CRM UI.
