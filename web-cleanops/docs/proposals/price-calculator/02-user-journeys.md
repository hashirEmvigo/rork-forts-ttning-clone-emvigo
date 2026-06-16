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
