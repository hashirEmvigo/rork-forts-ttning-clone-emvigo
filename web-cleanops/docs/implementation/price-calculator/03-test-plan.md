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
