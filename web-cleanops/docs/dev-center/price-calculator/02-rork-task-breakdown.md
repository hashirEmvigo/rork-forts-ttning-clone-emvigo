# RORK Task Breakdown - Price Calculator

**Audience:** RORK / GPT-5.5 High  
**Project:** CleanOps / Stadportalen / Price Calculator  
**Instruction level:** Treat this as implementation guidance for repository analysis, architecture validation, and phased build planning. The human project owner does not need explanatory simplification. Be precise, conservative, and repo-grounded.

---
## Task 0 - Repository analysis only

Inspect current architecture and report:

- Route structure.
- Settings pages.
- Customer/user/profiles types.
- Supabase repositories.
- Existing quote/invoice/agreement models.
- Auth and role model.
- Test conventions.
- Documentation conventions.

Output: implementation plan only. No code.

## Task 1 - Architecture registration

Add or update Development Center documentation entries so this module is visible as a planned feature.

Expected status:

- `price_calculator`: planned / analysis_complete.
- `crm_pipeline`: deferred.

## Task 2 - Data model and migration proposal

Create migration proposal for:

- Calculator settings.
- Calculator services.
- Service questions.
- Cleaning plans.
- Pricing rules.
- Quote requests.
- Quote request answers.
- Prospect profile/status relation if missing.

Include RLS assumptions and company isolation.

## Task 3 - Pure pricing engine

Implement pure functions for initial pricing models:

- Home cleaning recommended hours and price range.
- Move-out cleaning price per square meter with add-ons.
- Window cleaning placeholder model if included in MVP settings, but implementation may stay disabled.
- Generic add-on application.
- Price range rounding.

No UI in this task.

## Task 4 - Settings foundation

Build settings for company admin to configure:

- Enabled calculator services.
- Cleaning plans with hourly rates.
- Basic price settings.
- Quote validity period.
- Show exact price vs range.
- Manual review thresholds.
- Public calculator content texts.

## Task 5 - Public calculator page shell

Build the full-page calculator layout:

- Header.
- Left calculator panel.
- Right FAQ/trust/help panel.
- Responsive behavior.
- Quote-created state replacing FAQ with login prompt.

Do not wire final persistence until repository layer is validated.

## Task 6 - Calculator form flows

Build service-specific dynamic form flow for:

- Home cleaning.
- Move-out cleaning.

Support stepper state, validation, price preview, and customer contact details.

## Task 7 - Quote request submission

On submit:

- Recalculate trusted price.
- Create or match prospect by email/company.
- Store prospect status.
- Store quote request.
- Store answers snapshot.
- Create login handoff state.

## Task 8 - Portal handoff

Implement login prompt / magic-link-ready surface consistent with existing auth patterns.

Do not build a full customer portal redesign in this slice.

## Task 9 - Tests and QA

Add tests for:

- Pricing engine.
- Validation.
- Quote creation repository.
- Prospect creation/matching.
- Settings defaults.
- UI state transitions.

## Task 10 - Manual review and hardening

Add admin indicators for quote requests requiring manual review if thresholds are exceeded.

Do not build full CRM.
