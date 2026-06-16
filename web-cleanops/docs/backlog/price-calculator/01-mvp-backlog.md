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
