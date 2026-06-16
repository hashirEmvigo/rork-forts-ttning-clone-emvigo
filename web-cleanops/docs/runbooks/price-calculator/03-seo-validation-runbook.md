# SEO Validation Runbook - Price Calculator

**Audience:** RORK / GPT-5.5 High  
**Project:** CleanOps / Stadportalen / Price Calculator  
**Instruction level:** Treat this as implementation guidance for repository analysis, architecture validation, and phased build planning. The human project owner does not need explanatory simplification. Be precise, conservative, and repo-grounded.

---
## Goal

Validate that the price calculator supports SEO goals and does not redirect away from the public website too early.

## Checks

### Public route

Confirm the public calculator page loads on the company website domain or agreed public route.

Expected:

```text
/rakna-ut-pris
```

or equivalent.

### No immediate portal redirect

Click "Calculate your price" from the public website.

Expected:

- User lands on public calculator page.
- User is not sent directly to `/login`.

### Indexable content

Confirm page has public content:

- H1.
- Intro copy.
- FAQ/trust content.
- Service-related text.

### Private/noindex content

Confirm authenticated pages are not indexable:

- Login.
- Quote detail.
- Customer portal.

### Quote-created state

If quote-created is a separate route, mark it noindex.

If quote-created is only client state on the same page, ensure it does not replace all indexable content in the static page response.

## Future improvement

If the marketing site and CleanOps app are separate stacks, prefer:

- Marketing site owns SEO text and page shell.
- CleanOps provides calculator component/API.
- Quote submission goes to CleanOps backend.
