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
