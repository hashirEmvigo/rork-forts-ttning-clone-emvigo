# Combined Price Calculator Documentation for RORK / GPT-5.5 High

This file is generated for fast upload/paste into RORK. The categorized files should still be committed to their respective folders.


<!-- FILE: docs/README-price-calculator-placement.md -->

# Price Calculator Documentation Placement Index

**Audience:** RORK / GPT-5.5 High  
**Project:** CleanOps / Stadportalen / Price Calculator  
**Instruction level:** Treat this as implementation guidance for repository analysis, architecture validation, and phased build planning. The human project owner does not need explanatory simplification. Be precise, conservative, and repo-grounded.

---
## Purpose

This package is intentionally categorized into the existing CleanOps documentation structure:

- `architecture/` for target design, domain model, routing, pricing, API, auth, and frontend structure.
- `backlog/` for implementation scope, deferred scope, and issue grouping.
- `dev-center/` for RORK execution prompts, repo-analysis checklist, and task sequencing.
- `governance/` for decisions, security, privacy, SEO, and risk constraints.
- `implementation/` for phased build plans, migrations, RLS, testing, and acceptance criteria.
- `proposals/` for product intent, user journeys, and public copy direction.
- `runbooks/` for manual QA, release, rollback, and SEO validation.

## Primary instruction to RORK

Start with:

`docs/dev-center/price-calculator/00-rork-master-prompt.md`

Then perform repository analysis before implementation. Do not start coding from these documents directly without mapping the existing Vite + React + Supabase structure.

## Hard scope boundary

Build now:

- Public full-page price calculator landing page architecture.
- Company-level calculator settings.
- Cleaning plan / package setup as operational pricing plans, not different cleaning content.
- Pricing engine foundation.
- Prospect customer creation.
- Quote request creation.
- Login handoff / magic-link-ready flow.
- Admin/settings surfaces needed to configure this.

Prepare but do not fully build now:

- Full CRM pipeline.
- Lead scoring.
- Sales automation.
- Advanced campaign tracking.
- Full chatbot integration.
- Online payment or direct booking automation.


<!-- FILE: docs/architecture/price-calculator/01-domain-and-routing-architecture.md -->

# Domain and Routing Architecture - Price Calculator

**Audience:** RORK / GPT-5.5 High  
**Project:** CleanOps / Stadportalen / Price Calculator  
**Instruction level:** Treat this as implementation guidance for repository analysis, architecture validation, and phased build planning. The human project owner does not need explanatory simplification. Be precise, conservative, and repo-grounded.

---
## Recommended domain model

The public calculator should live on the ordinary marketing website domain, for example:

```text
stadalliansen.se/rakna-ut-pris
```

The portal/authenticated quote view may live on:

```text
stadportalen.se/login
stadportalen.se/quote/...
```

or future white-label/subdomain architecture:

```text
customer-company-domain.se/min-offert
kund.customer-company-domain.se/offert
```

## SEO principle

Before quote submission, the user should remain on the public website domain.

Do not redirect the initial "Calculate your price" click directly to a portal login page. The public calculator landing page should be a real landing page with crawlable content and supporting FAQ/trust text.

## Route states

### Public route

```text
/rakna-ut-pris
```

State: calculator active.

### Public route after submission

Same page may switch client state to quote-created/login prompt.

Optional separate route:

```text
/rakna-ut-pris/offert-skapad
```

This transactional state should be noindex if implemented as a route.

### Private portal routes

All authenticated portal quote/customer routes should be non-indexable.

## Multi-tenant routing

The architecture should support multiple companies later.

Potential forms:

```text
/company-slug/rakna-ut-pris
/c/:companySlug/calculator
/calculator/:embedKey
```

For the immediate Stadalliansen use case, the public site can resolve company configuration through a fixed company ID, slug, or embed key.

## Embed strategy

MVP can support a full-page iframe or embedded app route, but SEO-critical content must remain on the public site.

Best target architecture:

- Public site owns route, metadata, FAQ text, and indexable content.
- CleanOps calculator component/API provides dynamic form and pricing.
- Submitted data goes to CleanOps backend/Supabase.

## RORK implementation requirement

Inspect the current repo and decide whether the app can own this public route directly or whether it should expose an embeddable calculator route/API. Return the least disruptive architecture that supports the above domain model.


<!-- FILE: docs/architecture/price-calculator/02-full-page-landing-page-design.md -->

# Full-Page Landing Page Design - Price Calculator

**Audience:** RORK / GPT-5.5 High  
**Project:** CleanOps / Stadportalen / Price Calculator  
**Instruction level:** Treat this as implementation guidance for repository analysis, architecture validation, and phased build planning. The human project owner does not need explanatory simplification. Be precise, conservative, and repo-grounded.

---
## Design decision

The calculator must not be a small widget buried inside a normal page. It should be a dedicated full-page conversion experience.

## Desktop layout

```text
+---------------------------------------------------------------+
| Header: logo | Back to website | Contact / Help               |
+---------------------------------------------------------------+
|                                                               |
|  LEFT PANEL                         RIGHT PANEL               |
|  Price calculator                   FAQ / trust / help         |
|                                                               |
|  Service selection                  Common questions           |
|  Dynamic form                       How pricing works          |
|  Cleaning plan selector             RUT/tax info               |
|  Price preview                      Support contact            |
|  Contact details                    Future AI chatbot slot     |
|                                                               |
+---------------------------------------------------------------+
```

## After quote submission

The right-side FAQ/trust content should be replaced by login/next-step content.

```text
LEFT PANEL                         RIGHT PANEL
Quote request summary              Login prompt
Price indication                   Magic-link/email instruction
Submitted service details          Continue to portal CTA
```

## Mobile layout

Mobile should stack:

1. Header.
2. Calculator.
3. Price preview.
4. FAQ/help accordion.
5. Quote-created login prompt after submission.

## Visual behavior

- The calculator must be visually dominant.
- The right panel must reduce hesitation and increase conversion.
- Step progress should be visible.
- Price indication should be clear but not overpromise finality.
- The quote-created state should feel like continuity, not a redirect failure.

## Required components

Suggested component names:

- `PublicPriceCalculatorPage`
- `PriceCalculatorLayout`
- `CalculatorHeader`
- `CalculatorStepper`
- `ServiceSelector`
- `DynamicServiceQuestionForm`
- `CleaningPlanSelector`
- `PricePreviewCard`
- `ContactDetailsStep`
- `CalculatorInfoPanel`
- `CalculatorFaqPanel`
- `QuoteCreatedPanel`
- `LoginPromptPanel`
- `ChatbotSlotPlaceholder`

Use actual repo conventions if naming differs.

## Non-goals

Do not build chatbot behavior in MVP. Only reserve the placement.

Do not build complex CMS editing of the landing page in MVP unless existing settings architecture makes this easy.


<!-- FILE: docs/architecture/price-calculator/03-settings-and-tenant-configuration.md -->

# Settings and Tenant Configuration Architecture - Price Calculator

**Audience:** RORK / GPT-5.5 High  
**Project:** CleanOps / Stadportalen / Price Calculator  
**Instruction level:** Treat this as implementation guidance for repository analysis, architecture validation, and phased build planning. The human project owner does not need explanatory simplification. Be precise, conservative, and repo-grounded.

---
## Objective

Company admins must be able to configure their own calculator without code changes.

## Required settings categories

### Calculator general settings

- Enabled/disabled.
- Public calculator slug or embed key.
- Show price directly or only after contact details.
- Show exact price or price range.
- Quote validity period.
- Manual review threshold.
- Default currency.
- Tax/RUT display mode.

### Service settings

For each supported service:

- Enabled/disabled.
- Display name.
- Description.
- Input questions enabled.
- Required fields.
- Pricing model.
- Add-ons.
- Manual review rules.

### Cleaning plan settings

Cleaning plans are operational pricing plans.

Fields:

- `name`
- `description`
- `hourly_rate`
- `is_default`
- `flexibility_level`
- `customer_day_time_control`
- `same_staff_preference_level`
- `booking_priority`
- `cancellation_terms_summary`
- `active`
- `sort_order`

### Content settings

- FAQ items.
- Helper text.
- CTA labels.
- Quote-created message.
- Contact/help text.

## Default configuration

The system should ship default settings for fast onboarding. Company admins can override.

## Permissions

- Super admin can define global defaults and inspect company settings.
- Company admin can configure their own calculator.
- Staff should not edit pricing settings unless existing permission model explicitly allows it.

## Implementation note

Use existing settings architecture and permission patterns. Do not create a separate settings subsystem if the app already has a settings convention.


<!-- FILE: docs/architecture/price-calculator/04-cleaning-plans-and-pricing-engine.md -->

# Cleaning Plans and Pricing Engine Architecture

**Audience:** RORK / GPT-5.5 High  
**Project:** CleanOps / Stadportalen / Price Calculator  
**Instruction level:** Treat this as implementation guidance for repository analysis, architecture validation, and phased build planning. The human project owner does not need explanatory simplification. Be precise, conservative, and repo-grounded.

---
## Key semantic rule

Cleaning plans do not define different cleaning content. They define operational/commercial terms and hourly rates.

## Cleaning plan examples

### Flexible plan

- Lower hourly rate.
- Company has more flexibility around day/time scheduling.
- Employee continuity may vary.
- Best price-focused option.

### Fixed plan

- Medium hourly rate.
- More stable day/time preference.
- Stronger same-employee preference.
- Best predictability-focused option.

### Priority plan

- Higher hourly rate.
- Customer preferences have higher priority.
- Strongest continuity and scheduling preference.
- Best control-focused option.

Names should be configurable.

## Pricing engine principles

- Pricing logic must be pure and testable.
- Client preview can calculate provisional values.
- Final persisted quote request must be calculated through a trusted backend/repository path.
- Store snapshots of inputs and calculated outputs.
- Old quotes must not change when settings/pricing rules change later.

## Home cleaning model

Recommended MVP formula:

```text
recommended_hours = base_hours + (sqm * hours_per_sqm) + bathroom_adjustment + addon_hours
raw_price = recommended_hours * selected_cleaning_plan.hourly_rate
price_range = raw_price +/- configured margin
```

Configuration fields:

- `base_hours`
- `hours_per_sqm`
- `minimum_hours`
- `bathroom_extra_hours`
- `addon_hours`
- `range_min_percent`
- `range_max_percent`
- `rounding_increment`

## Move-out cleaning model

Recommended MVP formula:

```text
base_price = max(minimum_price, sqm * price_per_sqm)
addons = balcony + split_windows + extra_bathrooms + other configured addons
raw_price = base_price + addons
price_range = raw_price +/- configured margin
```

Configuration fields:

- `price_per_sqm`
- `minimum_price`
- `addon_prices`
- `range_min_percent`
- `range_max_percent`
- `rounding_increment`

## Internal calculation trace

Store calculation trace internally:

```json
{
  "pricingModel": "home_cleaning_recommended_hours",
  "inputs": {},
  "selectedPlanSnapshot": {},
  "formulaVersion": "v1",
  "steps": [],
  "rawPrice": 0,
  "minPrice": 0,
  "maxPrice": 0,
  "estimatedHours": 0
}
```

The customer should see only simplified result text. Admin may see full internal calculation details.


<!-- FILE: docs/architecture/price-calculator/05-prospect-auth-and-quote-flow.md -->

# Prospect, Auth and Quote Flow Architecture

**Audience:** RORK / GPT-5.5 High  
**Project:** CleanOps / Stadportalen / Price Calculator  
**Instruction level:** Treat this as implementation guidance for repository analysis, architecture validation, and phased build planning. The human project owner does not need explanatory simplification. Be precise, conservative, and repo-grounded.

---
## Prospect concept

A prospect is a person or organization that has submitted interest/quote data but is not yet an active customer.

The system should support a user/customer status such as:

```text
prospect
active_customer
inactive_customer
```

Use existing role/status naming if already present.

## Quote submission flow

On quote request submission:

1. Validate request.
2. Resolve company from public calculator config.
3. Recalculate trusted price.
4. Find existing prospect/customer by company + email if appropriate.
5. Create prospect if none exists.
6. Create quote request.
7. Store answer snapshots.
8. Store pricing snapshot.
9. Set quote status.
10. Present quote-created/login prompt.

## Recommended quote statuses

```text
draft
submitted
pending_review
ready_for_customer
viewed
accepted
rejected
expired
converted
```

MVP may use a smaller subset:

```text
submitted
pending_review
ready_for_customer
```

## Login handoff

Preferred UX:

- Visitor submits quote request.
- Page switches to quote-created state.
- System offers magic-link login or existing login route.
- Visitor can view quote in portal after authentication.

Do not force manual account creation with password in the initial MVP if current auth supports magic links.

## Existing user handling

If the email already belongs to an existing customer/prospect within the same company:

- Attach quote request to existing profile.
- Do not duplicate customers blindly.
- Preserve tenant boundary.

If the email exists in another company:

- Do not leak existence.
- Create/associate only within the current company according to existing multi-tenant identity model.

## CRM preparation

The quote/prospect records may include:

- `source = price_calculator`
- `source_url`
- `campaign_source`
- `prospect_status`
- `quote_status`

Do not build CRM UI now.


<!-- FILE: docs/architecture/price-calculator/06-data-model.md -->

# Data Model - Price Calculator

**Audience:** RORK / GPT-5.5 High  
**Project:** CleanOps / Stadportalen / Price Calculator  
**Instruction level:** Treat this as implementation guidance for repository analysis, architecture validation, and phased build planning. The human project owner does not need explanatory simplification. Be precise, conservative, and repo-grounded.

---
## Purpose

This is the target data model. RORK must map this to the existing schema before proposing migrations.

## Tables / entities

### `calculator_settings`

Company-level calculator behavior.

Fields:

- `id`
- `company_id`
- `enabled`
- `public_slug`
- `embed_key`
- `show_price_before_contact_details`
- `price_display_mode` (`exact`, `range`, `hidden_until_submit`)
- `quote_validity_days`
- `manual_review_threshold_amount`
- `currency`
- `rut_display_mode`
- `created_at`
- `updated_at`

### `calculator_services`

Enabled services and service-level configuration.

Fields:

- `id`
- `company_id`
- `service_key`
- `display_name`
- `description`
- `enabled`
- `pricing_model`
- `sort_order`
- `settings_json`
- `created_at`
- `updated_at`

### `calculator_questions`

Dynamic questions per service.

Fields:

- `id`
- `company_id`
- `calculator_service_id`
- `question_key`
- `label`
- `help_text`
- `input_type`
- `required`
- `options_json`
- `validation_json`
- `sort_order`
- `active`

### `cleaning_plans`

Operational pricing plans with hourly rates.

Fields:

- `id`
- `company_id`
- `name`
- `description`
- `hourly_rate`
- `flexibility_level`
- `customer_day_time_control`
- `same_staff_preference_level`
- `booking_priority`
- `cancellation_terms_summary`
- `is_default`
- `active`
- `sort_order`
- `created_at`
- `updated_at`

### `pricing_rules`

Configurable pricing values and add-ons.

Fields:

- `id`
- `company_id`
- `calculator_service_id`
- `rule_key`
- `rule_type`
- `value_numeric`
- `value_json`
- `condition_json`
- `active`
- `sort_order`
- `created_at`
- `updated_at`

### `quote_requests`

Submitted quote request.

Fields:

- `id`
- `company_id`
- `prospect_id` or `customer_id`
- `user_id` if applicable
- `calculator_service_id`
- `selected_cleaning_plan_id`
- `status`
- `source`
- `source_url`
- `customer_email`
- `customer_phone`
- `customer_name`
- `address_json`
- `estimated_hours`
- `calculated_price`
- `min_price`
- `max_price`
- `currency`
- `pricing_snapshot_json`
- `valid_until`
- `requires_manual_review`
- `created_at`
- `updated_at`

### `quote_request_answers`

Answer snapshots.

Fields:

- `id`
- `quote_request_id`
- `question_key`
- `question_label_snapshot`
- `answer_value_json`
- `created_at`

## Existing model integration

RORK must inspect whether existing tables already cover customers, prospects, services, quotes, or requests.

If existing concepts exist, prefer extending or mapping rather than duplicating.

## Snapshot rule

Quote requests must snapshot:

- selected plan name and hourly rate.
- pricing rule values.
- question labels and answers.
- calculated totals.

This prevents historical quotes from changing when settings are later edited.


<!-- FILE: docs/architecture/price-calculator/07-api-contracts.md -->

# API Contracts - Price Calculator

**Audience:** RORK / GPT-5.5 High  
**Project:** CleanOps / Stadportalen / Price Calculator  
**Instruction level:** Treat this as implementation guidance for repository analysis, architecture validation, and phased build planning. The human project owner does not need explanatory simplification. Be precise, conservative, and repo-grounded.

---
## Objective

Define the logical API/repository contracts. Actual implementation must follow existing repo conventions.

## Public calculator config

```http
GET /api/public/calculator/:companySlugOrEmbedKey
```

Returns:

```json
{
  "company": {},
  "settings": {},
  "services": [],
  "cleaningPlans": [],
  "faq": []
}
```

## Price preview

```http
POST /api/public/calculator/:companySlugOrEmbedKey/preview
```

Request:

```json
{
  "serviceKey": "home_cleaning",
  "cleaningPlanId": "...",
  "answers": {}
}
```

Response:

```json
{
  "estimatedHours": 5.5,
  "calculatedPrice": 2860,
  "minPrice": 2700,
  "maxPrice": 3100,
  "currency": "SEK",
  "displayText": "Estimated price: 2,700-3,100 SEK"
}
```

## Submit quote request

```http
POST /api/public/calculator/:companySlugOrEmbedKey/quote-requests
```

Request:

```json
{
  "serviceKey": "home_cleaning",
  "cleaningPlanId": "...",
  "answers": {},
  "customer": {
    "name": "...",
    "email": "...",
    "phone": "...",
    "address": {}
  },
  "sourceUrl": "..."
}
```

Response:

```json
{
  "quoteRequestId": "...",
  "prospectId": "...",
  "status": "submitted",
  "requiresManualReview": false,
  "loginMode": "magic_link_ready"
}
```

## Admin settings

Logical operations:

- Read calculator settings by company.
- Update calculator settings.
- List/update services.
- List/create/update cleaning plans.
- List/update pricing rules.
- List quote requests.
- Read quote request details.

## Security requirements

- Public config endpoint must expose only public-safe settings.
- Public quote submission must validate tenant/company and rate-limit if supported.
- Admin endpoints must require company admin or super admin privileges.
- RLS must enforce company isolation.
- Price calculation must not trust arbitrary client-provided totals.


<!-- FILE: docs/architecture/price-calculator/08-frontend-components.md -->

# Frontend Component Architecture - Price Calculator

**Audience:** RORK / GPT-5.5 High  
**Project:** CleanOps / Stadportalen / Price Calculator  
**Instruction level:** Treat this as implementation guidance for repository analysis, architecture validation, and phased build planning. The human project owner does not need explanatory simplification. Be precise, conservative, and repo-grounded.

---
## Page components

Suggested structure, subject to existing repo conventions:

```text
src/pages/public/PublicPriceCalculatorPage.tsx
src/components/price-calculator/PriceCalculatorLayout.tsx
src/components/price-calculator/CalculatorStepper.tsx
src/components/price-calculator/ServiceSelector.tsx
src/components/price-calculator/DynamicQuestionForm.tsx
src/components/price-calculator/CleaningPlanSelector.tsx
src/components/price-calculator/PricePreviewCard.tsx
src/components/price-calculator/ContactDetailsForm.tsx
src/components/price-calculator/CalculatorInfoPanel.tsx
src/components/price-calculator/QuoteCreatedPanel.tsx
```

Use existing folder conventions if different.

## State model

Suggested UI states:

```ts
type CalculatorState =
  | 'select_service'
  | 'answer_questions'
  | 'select_plan'
  | 'price_preview'
  | 'contact_details'
  | 'submitting'
  | 'quote_created'
  | 'error';
```

## Quote-created transition

When quote request submission succeeds:

- Keep user on the page.
- Replace FAQ/help panel with login prompt.
- Show submitted service summary.
- Show quote request created state.

## Validation

Validate each step before advancing.

Examples:

- Square meters must be numeric and within configured min/max.
- Email must be valid.
- Required service-specific fields must be present.
- Cleaning plan must be selected if service uses hourly pricing.

## Accessibility

- Use semantic form fields.
- Clear error text.
- Keyboard navigable stepper.
- Buttons must have descriptive labels.
- FAQ accordion must be accessible if implemented.

## Responsive behavior

- Desktop: two columns.
- Tablet: two columns if space allows, otherwise stacked.
- Mobile: stacked, calculator first, FAQ below.

## Non-goals

- Do not implement final AI chatbot.
- Do not implement a complete public CMS.
- Do not build CRM interface.


<!-- FILE: docs/architecture/price-calculator/09-crm-preparation-deferred.md -->

# CRM Preparation - Deferred Scope

**Audience:** RORK / GPT-5.5 High  
**Project:** CleanOps / Stadportalen / Price Calculator  
**Instruction level:** Treat this as implementation guidance for repository analysis, architecture validation, and phased build planning. The human project owner does not need explanatory simplification. Be precise, conservative, and repo-grounded.

---
## Decision

CRM should be prepared structurally but not built in the MVP.

## Why defer CRM

The immediate value is quote acquisition and prospect creation. A full CRM pipeline introduces additional complexity:

- Sales stages.
- Lead ownership.
- Follow-up automation.
- Activity logging.
- Conversion dashboards.
- Pipeline UI.
- Notifications and reminders.

This should not block the calculator MVP.

## What to prepare now

Prepare data fields that make CRM possible later:

- `source`
- `source_url`
- `campaign_source`
- `prospect_status`
- `quote_status`
- `created_from_calculator`
- timestamps
- company relation
- prospect/customer relation

## What not to build now

Do not build:

- CRM navigation.
- Pipeline board.
- Deal stages.
- Lead scoring.
- Sales task reminders.
- CRM dashboards.
- Email/SMS sequences.

## Future CRM direction

A future CRM module can consume quote requests and prospects as inputs.

Possible future entities:

- `crm_leads`
- `crm_pipeline_stages`
- `crm_activities`
- `crm_tasks`
- `crm_notes`
- `crm_conversions`

RORK should avoid locking the MVP into a model that prevents this, but should not implement it now.


<!-- FILE: docs/backlog/price-calculator/01-mvp-backlog.md -->

# MVP Backlog - Price Calculator

**Audience:** RORK / GPT-5.5 High  
**Project:** CleanOps / Stadportalen / Price Calculator  
**Instruction level:** Treat this as implementation guidance for repository analysis, architecture validation, and phased build planning. The human project owner does not need explanatory simplification. Be precise, conservative, and repo-grounded.

---
## Epic 1 - Calculator architecture

- Repo analysis.
- Route decision.
- Component architecture.
- Documentation registration.

## Epic 2 - Settings

- Calculator enabled flag.
- Service configuration.
- Cleaning plan hourly rates.
- Pricing values.
- Quote behavior settings.

## Epic 3 - Pricing engine

- Home cleaning formula.
- Move-out cleaning formula.
- Add-ons.
- Price range.
- Calculation trace.
- Unit tests.

## Epic 4 - Public calculator UI

- Full-page layout.
- Service selector.
- Dynamic forms.
- Cleaning plan selector.
- Price preview.
- FAQ/help panel.
- Quote-created/login panel.

## Epic 5 - Prospect and quote request persistence

- Prospect creation/matching.
- Quote request creation.
- Answer snapshots.
- Pricing snapshots.
- Status handling.

## Epic 6 - QA and release readiness

- Unit tests.
- Repository tests.
- Manual QA.
- SEO validation.
- Security/RLS validation.

## Build order recommendation

1. Settings/data model.
2. Pricing engine.
3. Public UI shell.
4. Submission persistence.
5. Login handoff.
6. QA.


<!-- FILE: docs/backlog/price-calculator/02-deferred-backlog-crm-and-advanced-features.md -->

# Deferred Backlog - CRM and Advanced Features

**Audience:** RORK / GPT-5.5 High  
**Project:** CleanOps / Stadportalen / Price Calculator  
**Instruction level:** Treat this as implementation guidance for repository analysis, architecture validation, and phased build planning. The human project owner does not need explanatory simplification. Be precise, conservative, and repo-grounded.

---
## Deferred CRM features

Do not build in MVP:

- CRM pipeline board.
- Sales stage management.
- Lead ownership.
- Activity timeline.
- Lead scoring.
- Follow-up tasks.
- Automated reminders.
- Email/SMS sequences.
- Conversion analytics.

## Deferred booking features

Do not build in MVP:

- Real-time availability.
- Calendar booking confirmation.
- Employee assignment.
- Route optimization.
- Work order generation from quote acceptance.

## Deferred AI features

Do not build in MVP:

- AI chatbot behavior.
- AI recommendation engine.
- AI sales assistant.

Only reserve UI placement for future chatbot.

## Deferred payment features

Do not build in MVP:

- Card payment.
- Invoice payment.
- Payment provider integration.
- Deposit handling.

## Deferred analytics

Do not build in MVP:

- Funnel analytics dashboard.
- Heatmaps.
- Campaign attribution dashboard.
- Sales conversion report.

Prepare only source/status fields where cheap and safe.


<!-- FILE: docs/backlog/price-calculator/03-github-issues.md -->

# Suggested GitHub Issues - Price Calculator

**Audience:** RORK / GPT-5.5 High  
**Project:** CleanOps / Stadportalen / Price Calculator  
**Instruction level:** Treat this as implementation guidance for repository analysis, architecture validation, and phased build planning. The human project owner does not need explanatory simplification. Be precise, conservative, and repo-grounded.

---
## Issue 1 - Analyze existing repo for price calculator architecture

Scope: no code. Return file map, route plan, settings integration, data model mapping, and risks.

## Issue 2 - Add price calculator documentation registration

Scope: update dev-center/backlog indexes according to existing documentation conventions.

## Issue 3 - Add calculator data model and migration proposal

Scope: create migrations or proposed migrations after repo inspection.

## Issue 4 - Implement pure pricing engine

Scope: home cleaning and move-out cleaning formulas with unit tests.

## Issue 5 - Implement company calculator settings

Scope: settings UI and repository read/write for services, cleaning plans, and pricing rules.

## Issue 6 - Build public full-page calculator UI shell

Scope: layout, stepper, right-side FAQ/help panel, responsive behavior.

## Issue 7 - Build service-specific calculator forms

Scope: home cleaning and move-out cleaning form flows.

## Issue 8 - Implement quote request submission

Scope: prospect creation/matching, quote request persistence, answer snapshots, pricing snapshot.

## Issue 9 - Implement quote-created/login handoff

Scope: replace right panel with login prompt; integrate with existing auth route/magic-link pattern.

## Issue 10 - QA and regression hardening

Scope: tests, manual QA, tenant isolation, no localStorage regression, SEO validation.


<!-- FILE: docs/dev-center/price-calculator/00-rork-master-prompt.md -->

# RORK Master Prompt - Price Calculator MVP

**Audience:** RORK / GPT-5.5 High  
**Project:** CleanOps / Stadportalen / Price Calculator  
**Instruction level:** Treat this as implementation guidance for repository analysis, architecture validation, and phased build planning. The human project owner does not need explanatory simplification. Be precise, conservative, and repo-grounded.

---
## Role

You are RORK operating as GPT-5.5 High. Act as a senior full-stack architect and implementation lead for the CleanOps / Stadportalen repository.

Your task is not to blindly implement. Your first task is to inspect the actual repo, identify existing patterns, and return a precise implementation plan that fits the current architecture.

## Product objective

Build a white-label, company-configurable price calculator and quote request flow for cleaning companies using CleanOps / Stadportalen.

The initial commercial use case is Stadalliansen:

- A user visits the regular public website.
- The user clicks "Calculate your price".
- The user lands on a full-page calculator landing page on the public website domain.
- The left side contains the calculator.
- The right side contains FAQ, trust, help content, and later AI chatbot placement.
- The user fills in service-specific details.
- The system calculates a price indication or price range.
- The user submits a quote request.
- A prospect customer is created.
- A quote request is created.
- The page switches state to quote-created/login prompt.
- The prospect can log in to view the quote in the portal.

## Critical product correction

Do not model "packages" as different cleaning content.

The base cleaning scope is the same for all plans. The package/plans represent operational and commercial setup:

- Hourly rate.
- Customer flexibility around days and time windows.
- Company flexibility around scheduling.
- Same employee preference / continuity level.
- Booking priority.
- Cancellation or rescheduling terms.
- Internal operational constraints.

Use naming such as `CleaningPlan`, `ServicePlan`, or `PricingPlan`. Avoid semantics suggesting that one plan includes more cleaning tasks than another.

## Build now

Build or prepare implementation for:

1. Full-page calculator landing page.
2. SEO-safe routing architecture.
3. Company settings for calculator configuration.
4. Service configuration for initial services.
5. Cleaning plan setup with hourly rates.
6. Pricing engine foundation.
7. Prospect customer user type/status.
8. Quote request persistence.
9. Quote answers persistence.
10. Login handoff after quote request.
11. Admin/settings UI required for configuration.
12. API/repository layer consistent with existing Supabase-authoritative patterns.
13. Tests for calculation, persistence, RLS assumptions, and UI state.

## Prepare but do not build now

Create a clean extension point for future CRM, but do not build full CRM.

Do not build:

- Kanban pipeline.
- Lead scoring.
- Sales-stage automation.
- Full sales dashboard.
- Email campaign automation.
- AI chatbot behavior.
- Direct booking automation.
- Payment flow.

## Repository constraints

Before implementation, inspect:

- Current route structure.
- Current settings module structure.
- Company and user models.
- Existing customer/prospect concepts, if any.
- Existing quote/invoice/agreement patterns.
- Supabase repository patterns.
- Existing localStorage migration status.
- Development Center documentation structure.
- Test setup.

Do not introduce localStorage-first behavior. If a temporary client-side draft is needed for form UX, keep it isolated and non-authoritative. All created prospects and quote requests must be Supabase-authoritative.

## Required first response from RORK

Return a repo-grounded analysis with:

1. Existing files and modules that should be reused.
2. Missing database tables/migrations.
3. Proposed new files.
4. Proposed route structure.
5. Proposed settings UI entry point.
6. Feature flag recommendation.
7. Data model recommendation.
8. Risk list.
9. Step-by-step implementation slices.
10. Test plan.

Do not implement until this analysis is accepted.


<!-- FILE: docs/dev-center/price-calculator/01-rork-execution-rules.md -->

# RORK Execution Rules - Price Calculator

**Audience:** RORK / GPT-5.5 High  
**Project:** CleanOps / Stadportalen / Price Calculator  
**Instruction level:** Treat this as implementation guidance for repository analysis, architecture validation, and phased build planning. The human project owner does not need explanatory simplification. Be precise, conservative, and repo-grounded.

---
## Rule 1 - Repo first

Never assume current CleanOps structure. Inspect the repo first and explicitly cite the files you will modify or extend.

## Rule 2 - Supabase authoritative

Do not create new localStorage-first flows. The calculator form may have local UI state, but authoritative data for quote requests, prospects, settings, pricing rules, and submitted answers must be persisted through Supabase-compatible repositories.

## Rule 3 - Narrow implementation slices

Work in small slices:

1. Documentation and architecture mapping.
2. Database/migration proposal.
3. Repository layer.
4. Settings read/write.
5. Pricing engine pure functions.
6. Public calculator UI shell.
7. Quote request submission.
8. Prospect creation/login handoff.
9. Tests.

Do not combine large UI, auth, DB, and pricing changes in one unreviewable slice.

## Rule 4 - CRM deferred

Prepare minimal fields needed for future CRM, but do not build CRM screens or pipeline logic now.

Permitted preparation:

- `source` fields.
- `status` fields.
- `lead_status` or `prospect_status` if required.
- `created_from_calculator` marker.
- quote/prospect relation.

Not permitted now:

- CRM pipeline UI.
- Sales stages UI.
- Lead scoring.
- Automated follow-up sequences.
- Conversion analytics dashboards.

## Rule 5 - SEO boundary

The public price calculator page must be suitable for public website embedding or route ownership. Important SEO content must not depend exclusively on client-only rendering if deployed on a marketing website.

The portal/login/quote detail pages must be treated as non-indexable/private.

## Rule 6 - Package semantics

Do not describe packages as different cleaning scopes. They are operational plans with different pricing/flexibility/continuity terms.

## Rule 7 - Backwards compatibility

Do not break existing customer, work order, invoice, agreement, timbank, schedule, or mission log flows.

If any existing type must be extended, provide a migration-safe approach.

## Rule 8 - Validation and tests

Every pricing formula must be implemented as pure testable logic before it is connected to UI persistence.

Every submitted quote request must be recalculated server-side or through a trusted backend/repository path. Never trust only client-calculated totals.


<!-- FILE: docs/dev-center/price-calculator/02-rork-task-breakdown.md -->

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


<!-- FILE: docs/dev-center/price-calculator/03-rork-repo-analysis-checklist.md -->

# RORK Repo Analysis Checklist - Price Calculator

**Audience:** RORK / GPT-5.5 High  
**Project:** CleanOps / Stadportalen / Price Calculator  
**Instruction level:** Treat this as implementation guidance for repository analysis, architecture validation, and phased build planning. The human project owner does not need explanatory simplification. Be precise, conservative, and repo-grounded.

---
## Required inspection targets

Before proposing code, inspect these areas and report exact file paths:

### Routing

- Current router setup.
- Public vs authenticated route boundaries.
- Existing landing or login routes.
- Any tenant/company route patterns.

### Auth and users

- Existing user roles/types.
- Profile model.
- Customer model.
- Company admin model.
- Supabase auth usage.
- Magic link support or reset/login patterns.

### Settings

- Settings page structure.
- Existing company settings storage.
- Super admin vs company admin permissions.
- Existing feature flags.

### Data and persistence

- Supabase client setup.
- Repository conventions.
- Migration folder conventions.
- RLS policy style.
- Any localStorage bridge still present.

### Existing commercial objects

- Customers.
- Agreements.
- Invoices.
- Services.
- Work orders.
- Customer requests.
- Mission log / time reporting references if related.

### Tests

- Unit test framework.
- Existing repository tests.
- Existing component tests.
- Test data builders.

## Required output format

Return:

```text
A. Existing structures found
B. Relevant files
C. Recommended file additions
D. Recommended migrations
E. Risk areas
F. Implementation slices
G. Test strategy
H. Blockers / questions
```

Do not implement code in the first pass.


<!-- FILE: docs/governance/price-calculator/01-architecture-decisions.md -->

# Architecture Decisions - Price Calculator

**Audience:** RORK / GPT-5.5 High  
**Project:** CleanOps / Stadportalen / Price Calculator  
**Instruction level:** Treat this as implementation guidance for repository analysis, architecture validation, and phased build planning. The human project owner does not need explanatory simplification. Be precise, conservative, and repo-grounded.

---
## ADR 1 - Full-page landing page

Decision: The price calculator should be a dedicated full-page landing page, not a small embedded block on a generic page.

Reason: Better conversion, better trust, clearer user focus, easier layout for FAQ/help/chatbot.

## ADR 2 - Public website first

Decision: The visitor should not be redirected to the portal before quote submission.

Reason: SEO and trust. The public landing page should live on the ordinary company website domain.

## ADR 3 - Portal after quote creation

Decision: After quote submission, the visitor may be handed off to the portal/login flow.

Reason: SEO is no longer the priority after submission; authenticated quote details should not be indexed.

## ADR 4 - Cleaning plans are operational plans

Decision: Packages/plans do not define different cleaning content.

Reason: The base cleaning content is the same. Plans affect hourly rate, flexibility, continuity, booking priority, and terms.

## ADR 5 - Supabase authoritative data

Decision: Prospects, settings, quote requests, answers, and pricing snapshots must be authoritative in Supabase-compatible storage.

Reason: Avoid localStorage regressions and ensure multi-tenant consistency.

## ADR 6 - CRM deferred

Decision: Prepare CRM fields but do not build full CRM in MVP.

Reason: MVP value is acquisition and quote request creation. CRM adds significant scope.

## ADR 7 - Snapshot pricing

Decision: Quote requests must snapshot pricing and selected plan data.

Reason: Historical quote values must not change when settings are updated later.


<!-- FILE: docs/governance/price-calculator/02-risks.md -->

# Risks - Price Calculator

**Audience:** RORK / GPT-5.5 High  
**Project:** CleanOps / Stadportalen / Price Calculator  
**Instruction level:** Treat this as implementation guidance for repository analysis, architecture validation, and phased build planning. The human project owner does not need explanatory simplification. Be precise, conservative, and repo-grounded.

---
## Risk 1 - Scope creep into CRM

Mitigation: CRM is deferred. Only prepare source/status fields.

## Risk 2 - Incorrect package semantics

Mitigation: Use `CleaningPlan`/`PricingPlan` semantics. Do not model plans as different task inclusion levels.

## Risk 3 - SEO damage from redirecting to portal too early

Mitigation: Keep public calculator on company website domain before submission.

## Risk 4 - localStorage regression

Mitigation: All submitted data must be Supabase-authoritative. Temporary form state is not authoritative.

## Risk 5 - Tenant data leakage

Mitigation: RLS/company scoping. Never expose private settings through public config endpoint.

## Risk 6 - Client-side price manipulation

Mitigation: Recalculate trusted price at submission and persist trusted result.

## Risk 7 - Overcomplex settings UI

Mitigation: MVP settings should configure only necessary services, plans, pricing values, and quote behavior.

## Risk 8 - Existing customer model conflict

Mitigation: Inspect current schema and extend existing customer/prospect concepts if available.

## Risk 9 - Auth friction

Mitigation: Prefer magic-link style login if current auth supports it. Avoid forcing password creation immediately.

## Risk 10 - Quote values changing later

Mitigation: Snapshot pricing rules, selected plan, question labels, and answers.


<!-- FILE: docs/governance/price-calculator/03-security-privacy-and-seo-rules.md -->

# Security, Privacy and SEO Rules - Price Calculator

**Audience:** RORK / GPT-5.5 High  
**Project:** CleanOps / Stadportalen / Price Calculator  
**Instruction level:** Treat this as implementation guidance for repository analysis, architecture validation, and phased build planning. The human project owner does not need explanatory simplification. Be precise, conservative, and repo-grounded.

---
## Security rules

- Public endpoints must expose only public-safe configuration.
- Quote submissions must be validated and company-scoped.
- Do not trust client-calculated price totals.
- Use RLS policies consistent with the existing app.
- Prevent cross-company prospect lookup leakage.
- Avoid unrestricted public inserts unless protected by API/RPC validation.

## Privacy rules

- Quote requests contain personal contact information.
- Store only necessary personal data.
- Treat prospect details as company-private.
- Do not expose prospect existence across companies.
- Avoid logging sensitive customer data in console or error messages.

## SEO rules

- Public calculator landing page should be indexable if it contains useful public content.
- Quote-created transactional route, if separate, should be noindex.
- Portal login and authenticated quote pages should be noindex/private.
- Important landing page content should not rely only on delayed client-only rendering if deployed on the marketing website.

## User experience rules

- Do not redirect before quote submission.
- After submission, show a clear quote-created state.
- Keep the login prompt contextual.
- Always provide a way back to the public website.

## Operational rules

- Manual review thresholds must be respected.
- Admins should see internal calculation trace.
- Customers should see simplified price indication only.


<!-- FILE: docs/implementation/price-calculator/01-implementation-plan.md -->

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


<!-- FILE: docs/implementation/price-calculator/02-migrations-and-rls-plan.md -->

# Migrations and RLS Plan - Price Calculator

**Audience:** RORK / GPT-5.5 High  
**Project:** CleanOps / Stadportalen / Price Calculator  
**Instruction level:** Treat this as implementation guidance for repository analysis, architecture validation, and phased build planning. The human project owner does not need explanatory simplification. Be precise, conservative, and repo-grounded.

---
## Migration principle

All new authoritative data must live in Supabase-compatible tables. Avoid localStorage-first persistence.

## Proposed migrations

RORK should generate migrations only after repo inspection.

Expected new tables or equivalent existing-table extensions:

- `calculator_settings`
- `calculator_services`
- `calculator_questions`
- `cleaning_plans`
- `pricing_rules`
- `quote_requests`
- `quote_request_answers`

If existing `services`, `customers`, `quotes`, or `requests` tables can be extended safely, propose that instead.

## RLS policy pattern

Company-scoped tables must enforce:

- Super admin can access all according to existing model.
- Company admin can access own company rows.
- Public endpoint can read only public-safe calculator config if implemented through RPC/API layer.
- Public quote submission can insert only through controlled function/API if supported.

## Public write risk

A public calculator submission creates data. Do not expose unrestricted insert policies without rate limits, validation, and company scoping.

Preferred options:

1. Server/API route performs validated insert.
2. Supabase RPC with strict validation.
3. Restricted insert policy with carefully validated fields.

Choose based on existing app architecture.

## Snapshot fields

Quote request migration must support snapshot JSON for:

- Pricing formula version.
- Selected cleaning plan.
- Pricing rules.
- Customer-visible totals.
- Internal calculation trace.

## Indexes

Recommended indexes:

- `company_id`
- `company_id, enabled`
- `quote_requests.company_id, created_at`
- `quote_requests.company_id, status`
- `quote_requests.company_id, customer_email`
- `quote_request_answers.quote_request_id`

## Migration safety

- Do not drop existing columns.
- Do not rename existing columns without compatibility layer.
- Add nullable fields first if backfill is needed.
- Keep seed data optional.


<!-- FILE: docs/implementation/price-calculator/03-test-plan.md -->

# Test Plan - Price Calculator

**Audience:** RORK / GPT-5.5 High  
**Project:** CleanOps / Stadportalen / Price Calculator  
**Instruction level:** Treat this as implementation guidance for repository analysis, architecture validation, and phased build planning. The human project owner does not need explanatory simplification. Be precise, conservative, and repo-grounded.

---
## Unit tests

### Pricing engine

Test home cleaning:

- Square meter based recommended hours.
- Minimum hours.
- Extra bathroom adjustment.
- Add-on hours.
- Cleaning plan hourly rate.
- Price range rounding.

Test move-out cleaning:

- Price per square meter.
- Minimum price.
- Add-ons.
- Price range.
- Manual review threshold.

### Validation

- Required fields.
- Invalid square meters.
- Invalid email.
- Missing cleaning plan.
- Unsupported service.

## Repository tests

Test:

- Read calculator settings.
- Read enabled services.
- Read active cleaning plans.
- Create or match prospect.
- Create quote request.
- Create answer snapshots.
- Tenant/company isolation assumptions.

## Component tests

If existing test stack supports:

- Service selection changes form.
- Stepper prevents invalid progression.
- Price preview appears after valid answers.
- Quote-created state replaces right panel.
- Error state is shown on failed submission.

## Manual QA

Use runbook:

`docs/runbooks/price-calculator/01-local-dev-and-manual-qa-runbook.md`

## Regression checks

Verify:

- Login still works.
- Existing settings pages still work.
- Existing customer pages still work.
- No localStorage seed data is used for submitted prospects/quotes.
- Company isolation remains intact.


<!-- FILE: docs/implementation/price-calculator/04-acceptance-criteria.md -->

# Acceptance Criteria - Price Calculator MVP

**Audience:** RORK / GPT-5.5 High  
**Project:** CleanOps / Stadportalen / Price Calculator  
**Instruction level:** Treat this as implementation guidance for repository analysis, architecture validation, and phased build planning. The human project owner does not need explanatory simplification. Be precise, conservative, and repo-grounded.

---
## Public landing page

Accepted when:

- A full-page price calculator route exists or is exposed according to agreed architecture.
- Desktop layout has calculator on left and FAQ/help panel on right.
- Mobile layout is usable and stacked.
- User remains on the public calculator page before quote submission.

## Settings

Accepted when:

- Company admin can configure active calculator services.
- Company admin can configure cleaning plans and hourly rates.
- Company admin can configure home cleaning and move-out cleaning base pricing.
- Settings are company-scoped.

## Pricing

Accepted when:

- Home cleaning returns recommended hours and price range.
- Move-out cleaning returns square-meter price plus add-ons.
- Pricing engine has unit tests.
- Submitted quote stores pricing snapshot.

## Prospect and quote request

Accepted when:

- A quote request submission creates or matches a prospect in the correct company.
- Quote request is persisted.
- Quote answers are persisted.
- Quote status is set.
- Manual review flag can be set based on configured threshold.

## Quote-created state

Accepted when:

- After submission, the page switches to quote-created state.
- FAQ/right panel is replaced by login/next-step prompt.
- User is not left on a dead-end page.

## Security and isolation

Accepted when:

- Company data is isolated.
- Public endpoints do not expose private settings.
- Price totals are not trusted from client payload alone.

## Deferred scope

Accepted when:

- CRM is not built.
- CRM extension fields are prepared where appropriate.
- No CRM navigation or pipeline UI appears in MVP.


<!-- FILE: docs/proposals/price-calculator/01-product-brief-and-mvp-scope.md -->

# Product Brief and MVP Scope - Price Calculator

**Audience:** RORK / GPT-5.5 High  
**Project:** CleanOps / Stadportalen / Price Calculator  
**Instruction level:** Treat this as implementation guidance for repository analysis, architecture validation, and phased build planning. The human project owner does not need explanatory simplification. Be precise, conservative, and repo-grounded.

---
## Product brief

The Price Calculator is a public acquisition and quote-request module for cleaning companies using CleanOps / Stadportalen.

It allows a company to publish a full-page price calculator on its ordinary marketing website. End customers can calculate a price indication and submit a quote request. The system then creates a prospect customer and a quote request in CleanOps.

## Primary user groups

### Public visitor

A person or company interested in cleaning services.

### Prospect customer

A visitor who has submitted a quote request but is not yet an active customer.

### Company admin

The cleaning company user who configures prices, cleaning plans, enabled services, and reviews submitted quote requests.

### Super admin

The system owner/admin who manages multiple companies and default templates.

## MVP scope

Build now:

- Full-page calculator landing page.
- Initial service support for home cleaning and move-out cleaning.
- Company-level calculator settings.
- Cleaning plan setup with hourly rates.
- Price indication / price range calculation.
- Prospect creation.
- Quote request creation.
- Quote answer snapshotting.
- Login prompt after submission.
- Admin/settings configuration surfaces.

## Explicitly deferred

Do not build now:

- Full CRM pipeline.
- Lead kanban.
- Lead scoring.
- Sales automation.
- Payment flow.
- Direct booking calendar confirmation.
- Full chatbot logic.
- Advanced analytics dashboard.

## Critical package definition

The cleaning scope is not package-specific. All cleaning plans share the same base cleaning content.

Plans differ by:

- Hourly rate.
- Flexibility.
- Preferred day/time constraints.
- Same employee preference.
- Booking priority.
- Operational terms.

## Success criteria

The MVP is successful when:

1. A company admin can configure calculator services and cleaning plan hourly rates.
2. A public visitor can calculate a price indication on a full-page landing page.
3. A quote request creates a prospect customer.
4. The submitted answers and calculated values are persisted.
5. The visitor receives or sees a login handoff.
6. Existing CleanOps flows remain unaffected.


<!-- FILE: docs/proposals/price-calculator/02-user-journeys.md -->

# User Journeys - Price Calculator

**Audience:** RORK / GPT-5.5 High  
**Project:** CleanOps / Stadportalen / Price Calculator  
**Instruction level:** Treat this as implementation guidance for repository analysis, architecture validation, and phased build planning. The human project owner does not need explanatory simplification. Be precise, conservative, and repo-grounded.

---
## Journey 1 - Home cleaning visitor

1. Visitor goes to the public marketing website.
2. Visitor clicks "Calculate your price".
3. Visitor lands on `/rakna-ut-pris` or equivalent company-owned public route.
4. Left panel shows calculator.
5. Right panel shows FAQ and trust/help content.
6. Visitor selects Home Cleaning.
7. Visitor enters square meters, bathrooms, frequency, postal code, and preferred cleaning plan.
8. System calculates recommended hours and price range.
9. Visitor enters contact details.
10. Visitor submits quote request.
11. System creates prospect and quote request.
12. Page switches to quote-created state.
13. Visitor is prompted to log in to view the quote.

## Journey 2 - Move-out cleaning visitor

1. Visitor selects Move-out Cleaning.
2. Visitor enters square meters, home type, bathrooms, balcony/window add-ons, date, and postal code.
3. System calculates price per square meter plus add-ons.
4. Visitor sees price indication.
5. Visitor submits quote request.
6. Prospect and quote request are created.
7. Visitor can log in to continue.

## Journey 3 - Company admin configuration

1. Company admin opens Settings.
2. Admin opens Price Calculator settings.
3. Admin enables services.
4. Admin configures cleaning plans and hourly rates.
5. Admin configures move-out cleaning square-meter price and add-ons.
6. Admin configures quote behavior.
7. Admin copies or validates landing page/widget integration.

## Journey 4 - Quote review

1. Admin sees new quote request.
2. Admin opens the request.
3. Admin sees customer/prospect details.
4. Admin sees submitted answers.
5. Admin sees calculated price details internally.
6. Admin may mark the request for manual review.
7. Full CRM actions are deferred.

## Journey 5 - Future CRM conversion

Prepared but deferred:

1. Prospect becomes qualified lead.
2. Lead enters CRM pipeline.
3. Sales activity is tracked.
4. Quote is accepted.
5. Prospect converts to customer.
6. Work order/agreement/booking can be created.

Only relation fields should be prepared now. Do not build this full journey in MVP.


<!-- FILE: docs/proposals/price-calculator/03-public-copy-and-content.md -->

# Public Copy and Content Direction - Price Calculator

**Audience:** RORK / GPT-5.5 High  
**Project:** CleanOps / Stadportalen / Price Calculator  
**Instruction level:** Treat this as implementation guidance for repository analysis, architecture validation, and phased build planning. The human project owner does not need explanatory simplification. Be precise, conservative, and repo-grounded.

---
## Purpose

This document provides copy direction for the public calculator landing page. RORK should wire this as configurable defaults where practical, not hard-code Stadalliansen-specific text unless the repo already uses tenant-specific content conventions.

## Page headline

Suggested English development copy:

```text
Calculate your cleaning price
```

Suggested Swedish production copy for Stadalliansen may later be:

```text
Rakna ut ditt pris
```

Keep copy configurable per company.

## Calculator intro

```text
Answer a few questions and receive a price indication based on your home, selected service, and cleaning plan.
```

## Right-side FAQ defaults

### How is the price calculated?

```text
The price is based on service type, home size, selected frequency, operational plan, and any relevant add-ons.
```

### Is the price binding?

```text
The calculator provides an indication. The final quote may be reviewed if the assignment requires manual confirmation.
```

### Is the cleaning content different between plans?

```text
No. The base cleaning scope is the same. Plans mainly affect price, scheduling flexibility, continuity, and booking terms.
```

### Can I use tax reduction/RUT?

```text
If the service qualifies and the customer meets the legal requirements, tax reduction may apply. Final eligibility is confirmed later.
```

### Do I need to book immediately?

```text
No. You can first create a quote request and continue from the portal.
```

## Quote-created state

```text
Your quote request has been created.

Log in to view your quote, complete missing information, and continue the process.
```

## CTA labels

- `Calculate price`
- `Continue`
- `Create quote request`
- `Log in and view quote`
- `Back to website`

## Implementation note

Keep text configurable through settings if the current architecture supports it. If not, implement default constants in a clearly named module so future tenant customization is straightforward.


<!-- FILE: docs/runbooks/price-calculator/01-local-dev-and-manual-qa-runbook.md -->

# Local Development and Manual QA Runbook - Price Calculator

**Audience:** RORK / GPT-5.5 High  
**Project:** CleanOps / Stadportalen / Price Calculator  
**Instruction level:** Treat this as implementation guidance for repository analysis, architecture validation, and phased build planning. The human project owner does not need explanatory simplification. Be precise, conservative, and repo-grounded.

---
## Preconditions

- RORK has inspected the repo.
- Required migrations or mocks are available.
- Company admin test account exists.
- Test company has calculator settings.

## Manual QA - Settings

1. Log in as company admin.
2. Open settings.
3. Enable price calculator.
4. Enable home cleaning and move-out cleaning.
5. Create at least two cleaning plans with different hourly rates.
6. Configure home cleaning base formula.
7. Configure move-out cleaning price per square meter and add-ons.
8. Save settings.
9. Reload and confirm settings persist.

## Manual QA - Home cleaning public flow

1. Open public calculator route.
2. Select home cleaning.
3. Enter square meters.
4. Enter number of bathrooms.
5. Select frequency if implemented.
6. Select cleaning plan.
7. Confirm price preview appears.
8. Enter contact details.
9. Submit quote request.
10. Confirm quote-created/login prompt appears.
11. Confirm right-side FAQ panel is replaced.
12. Confirm record appears in admin/repository if UI exists.

## Manual QA - Move-out cleaning public flow

1. Select move-out cleaning.
2. Enter square meters.
3. Add balcony/split-window options.
4. Confirm price preview includes add-ons.
5. Submit quote request.
6. Confirm quote and answers are persisted.

## Manual QA - Tenant isolation

1. Create or use two companies.
2. Configure different plans/prices.
3. Confirm public config for company A does not expose company B settings.
4. Confirm admin for company A cannot see company B quote requests.

## Manual QA - Regression

Verify:

- Login works.
- Existing customer pages work.
- Existing settings still load.
- Existing invoices/agreements are unaffected.
- No localStorage seed/fallback drives quote request persistence.


<!-- FILE: docs/runbooks/price-calculator/02-release-and-rollback-runbook.md -->

# Release and Rollback Runbook - Price Calculator

**Audience:** RORK / GPT-5.5 High  
**Project:** CleanOps / Stadportalen / Price Calculator  
**Instruction level:** Treat this as implementation guidance for repository analysis, architecture validation, and phased build planning. The human project owner does not need explanatory simplification. Be precise, conservative, and repo-grounded.

---
## Release prerequisites

- Migrations reviewed.
- RLS reviewed.
- Unit tests pass.
- Manual QA completed.
- Feature flag decision documented if used.
- Company admin settings tested.
- Public route tested on desktop/mobile.

## Suggested rollout

1. Deploy with calculator disabled by default.
2. Enable for internal test company only.
3. Validate settings and public flow.
4. Enable for Stadalliansen test environment/domain.
5. Monitor quote submissions.
6. Enable production landing page link.

## Feature flag recommendation

If current app uses feature flags, add:

```text
EXPO_PUBLIC_PRICE_CALCULATOR_ENABLED
```

or repo-conventional equivalent.

Do not rely solely on frontend flag for data security. Backend/RLS must still be safe.

## Rollback strategy

If public UI fails:

- Hide calculator link on marketing website.
- Disable company calculator settings.
- Turn off feature flag.

If data migration causes issues:

- Stop writes to calculator.
- Preserve submitted quote records.
- Do not drop data without explicit review.

If pricing calculation is wrong:

- Disable quote auto-display.
- Route quote requests to manual review.
- Fix formula and version it.

## Post-release checks

- Verify no unexpected public data exposure.
- Verify quote request records.
- Verify prospect creation.
- Verify emails/login handoff if implemented.
- Verify SEO route response.


<!-- FILE: docs/runbooks/price-calculator/03-seo-validation-runbook.md -->

# SEO Validation Runbook - Price Calculator

**Audience:** RORK / GPT-5.5 High  
**Project:** CleanOps / Stadportalen / Price Calculator  
**Instruction level:** Treat this as implementation guidance for repository analysis, architecture validation, and phased build planning. The human project owner does not need explanatory simplification. Be precise, conservative, and repo-grounded.

---
## Goal

Validate that the price calculator supports SEO goals and does not redirect away from the public website too early.

## Checks

### Public route

Confirm the public calculator page loads on the company website domain or agreed public route.

Expected:

```text
/rakna-ut-pris
```

or equivalent.

### No immediate portal redirect

Click "Calculate your price" from the public website.

Expected:

- User lands on public calculator page.
- User is not sent directly to `/login`.

### Indexable content

Confirm page has public content:

- H1.
- Intro copy.
- FAQ/trust content.
- Service-related text.

### Private/noindex content

Confirm authenticated pages are not indexable:

- Login.
- Quote detail.
- Customer portal.

### Quote-created state

If quote-created is a separate route, mark it noindex.

If quote-created is only client state on the same page, ensure it does not replace all indexable content in the static page response.

## Future improvement

If the marketing site and CleanOps app are separate stacks, prefer:

- Marketing site owns SEO text and page shell.
- CleanOps provides calculator component/API.
- Quote submission goes to CleanOps backend.
