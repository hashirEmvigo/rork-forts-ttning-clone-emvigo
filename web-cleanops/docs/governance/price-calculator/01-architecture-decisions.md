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
