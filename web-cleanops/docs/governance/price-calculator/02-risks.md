# Risks - Price Calculator

**Audience:** RORK / GPT-5.5 High  
**Project:** CleanOps / Stadportalen / Price Calculator  
**Instruction level:** Treat this as implementation guidance for repository analysis, architecture validation, and phased build planning. The human project owner does not need explanatory simplification. Be precise, conservative, and repo-grounded.

---
## Risk 1 - Scope creep into CRM

Mitigation: CRM is deferred. Only prepare source/status fields.

## Risk 2 - Incorrect package semantics

Mitigation: Use `CleaningPlan`/`PricingPlan` semantics. Do not model plans as different task inclusion levels.

## Risk 3 - SEO damage from redirecting to portal too early

Mitigation: Keep public calculator on company website domain before submission.

## Risk 4 - localStorage regression

Mitigation: All submitted data must be Supabase-authoritative. Temporary form state is not authoritative.

## Risk 5 - Tenant data leakage

Mitigation: RLS/company scoping. Never expose private settings through public config endpoint.

## Risk 6 - Client-side price manipulation

Mitigation: Recalculate trusted price at submission and persist trusted result.

## Risk 7 - Overcomplex settings UI

Mitigation: MVP settings should configure only necessary services, plans, pricing values, and quote behavior.

## Risk 8 - Existing customer model conflict

Mitigation: Inspect current schema and extend existing customer/prospect concepts if available.

## Risk 9 - Auth friction

Mitigation: Prefer magic-link style login if current auth supports it. Avoid forcing password creation immediately.

## Risk 10 - Quote values changing later

Mitigation: Snapshot pricing rules, selected plan, question labels, and answers.
