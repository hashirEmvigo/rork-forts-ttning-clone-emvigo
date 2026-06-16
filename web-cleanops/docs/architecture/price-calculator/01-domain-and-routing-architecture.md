# Domain and Routing Architecture - Price Calculator

**Audience:** RORK / GPT-5.5 High  
**Project:** CleanOps / Stadportalen / Price Calculator  
**Instruction level:** Treat this as implementation guidance for repository analysis, architecture validation, and phased build planning. The human project owner does not need explanatory simplification. Be precise, conservative, and repo-grounded.

---
## Recommended domain model

The public calculator should live on the ordinary marketing website domain, for example:

```text
stadalliansen.se/rakna-ut-pris
```

The portal/authenticated quote view may live on:

```text
stadportalen.se/login
stadportalen.se/quote/...
```

or future white-label/subdomain architecture:

```text
customer-company-domain.se/min-offert
kund.customer-company-domain.se/offert
```

## SEO principle

Before quote submission, the user should remain on the public website domain.

Do not redirect the initial "Calculate your price" click directly to a portal login page. The public calculator landing page should be a real landing page with crawlable content and supporting FAQ/trust text.

## Route states

### Public route

```text
/rakna-ut-pris
```

State: calculator active.

### Public route after submission

Same page may switch client state to quote-created/login prompt.

Optional separate route:

```text
/rakna-ut-pris/offert-skapad
```

This transactional state should be noindex if implemented as a route.

### Private portal routes

All authenticated portal quote/customer routes should be non-indexable.

## Multi-tenant routing

The architecture should support multiple companies later.

Potential forms:

```text
/company-slug/rakna-ut-pris
/c/:companySlug/calculator
/calculator/:embedKey
```

For the immediate Stadalliansen use case, the public site can resolve company configuration through a fixed company ID, slug, or embed key.

## Embed strategy

MVP can support a full-page iframe or embedded app route, but SEO-critical content must remain on the public site.

Best target architecture:

- Public site owns route, metadata, FAQ text, and indexable content.
- CleanOps calculator component/API provides dynamic form and pricing.
- Submitted data goes to CleanOps backend/Supabase.

## RORK implementation requirement

Inspect the current repo and decide whether the app can own this public route directly or whether it should expose an embeddable calculator route/API. Return the least disruptive architecture that supports the above domain model.
