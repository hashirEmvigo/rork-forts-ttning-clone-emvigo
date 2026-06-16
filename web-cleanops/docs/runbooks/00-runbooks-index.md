# Runbooks Documentation Index

## Purpose

This folder contains operational runbooks for CleanOps.

Runbooks define repeatable operational procedures for sensitive, manual or semi-manual actions.

Use this folder before running tenant resets, manual migrations, cleanup procedures, backfills or other operational maintenance tasks.

---

## Documents

### 01-tenant-test-data-reset-runbook.md

Validated, repeatable procedure for fully removing a single company/tenant and all company-scoped data from the live Supabase project, with optional auth.users orphan cleanup.

Read this before deleting or resetting any company tenant.

### 02-manual-migration-runbook.md

Manual migration runbook.

Use this before performing manual migration steps that are not fully automated through the normal migration pipeline.

### 03-price-calculator-prelaunch-and-qa-runbook.md

Pre-launch readiness checklist and manual QA script for the public price calculator (`/rakna-ut-ditt-pris`).

Read this before enabling the public calculator for testing or deciding whether to soft-launch. It documents the verified dark-state safety, route/SEO/Edge-Function/RLS behaviour, the read-only verification commands, and the step-by-step enable → submit → inbox → disable → cleanup QA sequence.

---

## Rules

Before following a runbook:

1. Read the full runbook.
2. Confirm the target environment.
3. Confirm whether the action affects production, staging or test data.
4. Perform dry-run or SELECT-only verification where required.
5. Follow the documented order exactly.
6. Perform post-verification.
7. Record the outcome if the runbook changes operational state.
