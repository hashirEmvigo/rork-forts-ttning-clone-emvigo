# Migrations and RLS Plan - Price Calculator

**Audience:** RORK / GPT-5.5 High  
**Project:** CleanOps / Stadportalen / Price Calculator  
**Instruction level:** Treat this as implementation guidance for repository analysis, architecture validation, and phased build planning. The human project owner does not need explanatory simplification. Be precise, conservative, and repo-grounded.

---
## Migration principle

All new authoritative data must live in Supabase-compatible tables. Avoid localStorage-first persistence.

## Proposed migrations

RORK should generate migrations only after repo inspection.

Expected new tables or equivalent existing-table extensions:

- `calculator_settings`
- `calculator_services`
- `calculator_questions`
- `cleaning_plans`
- `pricing_rules`
- `quote_requests`
- `quote_request_answers`

If existing `services`, `customers`, `quotes`, or `requests` tables can be extended safely, propose that instead.

## RLS policy pattern

Company-scoped tables must enforce:

- Super admin can access all according to existing model.
- Company admin can access own company rows.
- Public endpoint can read only public-safe calculator config if implemented through RPC/API layer.
- Public quote submission can insert only through controlled function/API if supported.

## Public write risk

A public calculator submission creates data. Do not expose unrestricted insert policies without rate limits, validation, and company scoping.

Preferred options:

1. Server/API route performs validated insert.
2. Supabase RPC with strict validation.
3. Restricted insert policy with carefully validated fields.

Choose based on existing app architecture.

## Snapshot fields

Quote request migration must support snapshot JSON for:

- Pricing formula version.
- Selected cleaning plan.
- Pricing rules.
- Customer-visible totals.
- Internal calculation trace.

## Indexes

Recommended indexes:

- `company_id`
- `company_id, enabled`
- `quote_requests.company_id, created_at`
- `quote_requests.company_id, status`
- `quote_requests.company_id, customer_email`
- `quote_request_answers.quote_request_id`

## Migration safety

- Do not drop existing columns.
- Do not rename existing columns without compatibility layer.
- Add nullable fields first if backfill is needed.
- Keep seed data optional.
