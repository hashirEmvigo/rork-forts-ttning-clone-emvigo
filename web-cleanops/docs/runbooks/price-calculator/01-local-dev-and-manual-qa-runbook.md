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
