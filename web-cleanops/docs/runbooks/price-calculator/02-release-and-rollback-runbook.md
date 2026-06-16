# Release and Rollback Runbook - Price Calculator

**Audience:** RORK / GPT-5.5 High  
**Project:** CleanOps / Stadportalen / Price Calculator  
**Instruction level:** Treat this as implementation guidance for repository analysis, architecture validation, and phased build planning. The human project owner does not need explanatory simplification. Be precise, conservative, and repo-grounded.

---
## Release prerequisites

- Migrations reviewed.
- RLS reviewed.
- Unit tests pass.
- Manual QA completed.
- Feature flag decision documented if used.
- Company admin settings tested.
- Public route tested on desktop/mobile.

## Suggested rollout

1. Deploy with calculator disabled by default.
2. Enable for internal test company only.
3. Validate settings and public flow.
4. Enable for Stadalliansen test environment/domain.
5. Monitor quote submissions.
6. Enable production landing page link.

## Feature flag recommendation

If current app uses feature flags, add:

```text
EXPO_PUBLIC_PRICE_CALCULATOR_ENABLED
```

or repo-conventional equivalent.

Do not rely solely on frontend flag for data security. Backend/RLS must still be safe.

## Rollback strategy

If public UI fails:

- Hide calculator link on marketing website.
- Disable company calculator settings.
- Turn off feature flag.

If data migration causes issues:

- Stop writes to calculator.
- Preserve submitted quote records.
- Do not drop data without explicit review.

If pricing calculation is wrong:

- Disable quote auto-display.
- Route quote requests to manual review.
- Fix formula and version it.

## Post-release checks

- Verify no unexpected public data exposure.
- Verify quote request records.
- Verify prospect creation.
- Verify emails/login handoff if implemented.
- Verify SEO route response.
