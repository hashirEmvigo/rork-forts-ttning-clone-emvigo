# Data Authority & Test Data Policy — Supabase as Source of Truth

## Purpose

This document defines the data authority rules for CleanOps during the current
development/demo phase.

It exists so future developers and agents do not keep treating `localStorage` /
`store.ts` as a valid long-term data authority. Supabase is the intended source
of truth. `localStorage` is legacy, seed, cache, fallback, or temporary backout
state only.

This document is a governing policy. It has the same standing as the
`01-project-constitution.md` for data ownership decisions and must be checked
before building features or making migration decisions on any business entity.

---

## 1. Current Phase

* The system is currently in **development/demo mode**.
* We do **not** have real production customer data in this environment.
* Data **can** be reset, reconciled, backfilled, or cleaned when required to fix
  architecture and migration issues.
* This policy remains valid until it is **explicitly replaced** by a production
  data protection policy (see [Section 9 — End Condition](#9-end-condition)).

---

## 2. Data Authority Principle

* **Supabase is the intended source of truth.**
* `localStorage` / `store.ts` is **legacy, seed, cache, fallback, or temporary
  backout copy only**.
* `localStorage` **must not** be treated as the long-term authoritative data
  source for business entities (Customers, Employees, and all future migrated
  domains).

---

## 3. When Local-Only Data Is Found

If data exists **only in `localStorage`** but not in Supabase:

* Treat it as a **migration/readiness defect**, not normal application behavior.
* Do **not** build new features that depend on local-only data.
* Resolve it by one of:
  * migrate/backfill it into Supabase, or
  * reconcile it through a readiness tool, or
  * intentionally discard it **if confirmed** as test/demo residue.
* Do **not** silently preserve local-only data as if it were valid production
  state.

---

## 4. When Supabase-Only Data Is Found

If data exists **in Supabase** but not in `localStorage`:

* Treat it as the **expected direction of travel**, unless shadow validation
  reports it as stale/extra/deleted residue.
* In authoritative modules, **Supabase should win** unless a specific
  migration/readiness process marks the row as stale.
* For stale rows created by old bugs, use **controlled soft-delete/tombstone
  cleanup** rather than hard delete.

---

## 5. Delete Policy

* Prefer **soft-delete/tombstone** semantics for business entities
  (e.g. `deleted_at`, consistent with employees, work orders, teams, and the
  customer soft-delete added in migration `0033`).
* **Hard delete should generally be avoided** unless explicitly approved.
* Deleted records **must not reappear** through Supabase authoritative reads.
* If a module cannot represent delete in Supabase, delete must either be:
  * blocked, or
  * converted to archive, or
  * the schema must be fixed (add soft-delete + read filtering) **before** the
    feature is considered complete.

---

## 6. Migration / Readiness Tools

* Each migrated domain should have, or move toward, a **Super Admin readiness
  surface**.
* Readiness surfaces should support:
  * preflight inspection
  * dry-run
  * per-company backfill
  * shadow validation
  * telemetry
  * sanitized diagnostics
* These tools should **avoid PII** wherever possible (no names, emails, phone,
  org numbers, addresses, or notes — sanitized ids/counts only).
* **Destructive actions must be avoided or require explicit confirmation.**
* In the current test/demo phase, **controlled cleanup of test residue is
  acceptable** when it is clearly labeled, scoped per company, dry-run first,
  and reversible by re-upsert/backfill.

---

## 7. Feature Development Rule

Before building new features on a domain:

* Confirm the domain's current state: **local-only, dual-write, Supabase-read,
  or Supabase-authoritative**.
* Do **not** add new `localStorage`-only write paths.
* Do **not** bypass the central **AppContext / repository seam**.
* Do **not** introduce new data models without a Supabase migration/readiness
  plan.

---

## 8. Current Practical Rule — Customers & Employees

* **Customers** are already **Supabase-authoritative** in real builds.
* **Employees** have Supabase reads and now a **write mirror**, but
  rollout/backfill validation is still **pending**.
* Any customer/employee data inconsistency between `localStorage` and Supabase
  should be treated as a **migration defect**, not normal application behavior.

---

## 9. End Condition

This document applies until **all** of the following are true:

* A real **staging/production split** exists, and
* **Production data protection rules** are defined, and
* The system has a **formal migration/cutover policy** for live customer data.

When that condition is met, replace this policy with the production data
protection policy and update `00-master-index.md` accordingly.
