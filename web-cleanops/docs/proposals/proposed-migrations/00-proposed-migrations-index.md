# Proposed Migrations Index

## Purpose

This folder contains proposed, unapplied migration drafts.

Files in this folder are intentionally kept outside `supabase/migrations/` so they cannot be auto-applied.

Use this folder for migration proposals that require review, approval and validation before becoming real Supabase migrations.

---

## Current Proposed Migrations

### 0034_tenant_deletion_routine.sql.proposed

Unapplied draft migration for explicit tenant deletion handling.

This migration must not be promoted until the related proposal has been reviewed and the test plan has passed.

### 0034_tenant_deletion_routine.test-plan.md

Test plan for the proposed tenant deletion routine.

---

## Rules

Do not move `.sql.proposed` files into `supabase/migrations/` until:

1. The proposal has been approved.
2. Open decisions have been resolved.
3. The test plan has passed.
4. The migration has been reviewed for protected super admin behavior.
5. The migration has been reviewed against auth.users handling.
6. The migration has been validated in a safe environment.
