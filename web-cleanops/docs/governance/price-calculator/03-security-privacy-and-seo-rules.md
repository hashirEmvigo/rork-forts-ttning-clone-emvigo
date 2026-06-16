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
