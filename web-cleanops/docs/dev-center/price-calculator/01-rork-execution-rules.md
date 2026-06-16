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
