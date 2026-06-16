# Public Copy and Content Direction - Price Calculator

**Audience:** RORK / GPT-5.5 High  
**Project:** CleanOps / Stadportalen / Price Calculator  
**Instruction level:** Treat this as implementation guidance for repository analysis, architecture validation, and phased build planning. The human project owner does not need explanatory simplification. Be precise, conservative, and repo-grounded.

---
## Purpose

This document provides copy direction for the public calculator landing page. RORK should wire this as configurable defaults where practical, not hard-code Stadalliansen-specific text unless the repo already uses tenant-specific content conventions.

## Page headline

Suggested English development copy:

```text
Calculate your cleaning price
```

Suggested Swedish production copy for Stadalliansen may later be:

```text
Rakna ut ditt pris
```

Keep copy configurable per company.

## Calculator intro

```text
Answer a few questions and receive a price indication based on your home, selected service, and cleaning plan.
```

## Right-side FAQ defaults

### How is the price calculated?

```text
The price is based on service type, home size, selected frequency, operational plan, and any relevant add-ons.
```

### Is the price binding?

```text
The calculator provides an indication. The final quote may be reviewed if the assignment requires manual confirmation.
```

### Is the cleaning content different between plans?

```text
No. The base cleaning scope is the same. Plans mainly affect price, scheduling flexibility, continuity, and booking terms.
```

### Can I use tax reduction/RUT?

```text
If the service qualifies and the customer meets the legal requirements, tax reduction may apply. Final eligibility is confirmed later.
```

### Do I need to book immediately?

```text
No. You can first create a quote request and continue from the portal.
```

## Quote-created state

```text
Your quote request has been created.

Log in to view your quote, complete missing information, and continue the process.
```

## CTA labels

- `Calculate price`
- `Continue`
- `Create quote request`
- `Log in and view quote`
- `Back to website`

## Implementation note

Keep text configurable through settings if the current architecture supports it. If not, implement default constants in a clearly named module so future tenant customization is straightforward.
