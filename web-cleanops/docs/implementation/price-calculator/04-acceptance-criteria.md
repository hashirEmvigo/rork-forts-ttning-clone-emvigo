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
