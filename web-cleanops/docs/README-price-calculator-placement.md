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
