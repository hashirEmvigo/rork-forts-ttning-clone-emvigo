# RORK Repo Analysis Checklist - Price Calculator

**Audience:** RORK / GPT-5.5 High  
**Project:** CleanOps / Stadportalen / Price Calculator  
**Instruction level:** Treat this as implementation guidance for repository analysis, architecture validation, and phased build planning. The human project owner does not need explanatory simplification. Be precise, conservative, and repo-grounded.

---
## Required inspection targets

Before proposing code, inspect these areas and report exact file paths:

### Routing

- Current router setup.
- Public vs authenticated route boundaries.
- Existing landing or login routes.
- Any tenant/company route patterns.

### Auth and users

- Existing user roles/types.
- Profile model.
- Customer model.
- Company admin model.
- Supabase auth usage.
- Magic link support or reset/login patterns.

### Settings

- Settings page structure.
- Existing company settings storage.
- Super admin vs company admin permissions.
- Existing feature flags.

### Data and persistence

- Supabase client setup.
- Repository conventions.
- Migration folder conventions.
- RLS policy style.
- Any localStorage bridge still present.

### Existing commercial objects

- Customers.
- Agreements.
- Invoices.
- Services.
- Work orders.
- Customer requests.
- Mission log / time reporting references if related.

### Tests

- Unit test framework.
- Existing repository tests.
- Existing component tests.
- Test data builders.

## Required output format

Return:

```text
A. Existing structures found
B. Relevant files
C. Recommended file additions
D. Recommended migrations
E. Risk areas
F. Implementation slices
G. Test strategy
H. Blockers / questions
```

Do not implement code in the first pass.
