# API Contracts - Price Calculator

**Audience:** RORK / GPT-5.5 High  
**Project:** CleanOps / Stadportalen / Price Calculator  
**Instruction level:** Treat this as implementation guidance for repository analysis, architecture validation, and phased build planning. The human project owner does not need explanatory simplification. Be precise, conservative, and repo-grounded.

---
## Objective

Define the logical API/repository contracts. Actual implementation must follow existing repo conventions.

## Public calculator config

```http
GET /api/public/calculator/:companySlugOrEmbedKey
```

Returns:

```json
{
  "company": {},
  "settings": {},
  "services": [],
  "cleaningPlans": [],
  "faq": []
}
```

## Price preview

```http
POST /api/public/calculator/:companySlugOrEmbedKey/preview
```

Request:

```json
{
  "serviceKey": "home_cleaning",
  "cleaningPlanId": "...",
  "answers": {}
}
```

Response:

```json
{
  "estimatedHours": 5.5,
  "calculatedPrice": 2860,
  "minPrice": 2700,
  "maxPrice": 3100,
  "currency": "SEK",
  "displayText": "Estimated price: 2,700-3,100 SEK"
}
```

## Submit quote request

```http
POST /api/public/calculator/:companySlugOrEmbedKey/quote-requests
```

Request:

```json
{
  "serviceKey": "home_cleaning",
  "cleaningPlanId": "...",
  "answers": {},
  "customer": {
    "name": "...",
    "email": "...",
    "phone": "...",
    "address": {}
  },
  "sourceUrl": "..."
}
```

Response:

```json
{
  "quoteRequestId": "...",
  "prospectId": "...",
  "status": "submitted",
  "requiresManualReview": false,
  "loginMode": "magic_link_ready"
}
```

## Admin settings

Logical operations:

- Read calculator settings by company.
- Update calculator settings.
- List/update services.
- List/create/update cleaning plans.
- List/update pricing rules.
- List quote requests.
- Read quote request details.

## Security requirements

- Public config endpoint must expose only public-safe settings.
- Public quote submission must validate tenant/company and rate-limit if supported.
- Admin endpoints must require company admin or super admin privileges.
- RLS must enforce company isolation.
- Price calculation must not trust arbitrary client-provided totals.
