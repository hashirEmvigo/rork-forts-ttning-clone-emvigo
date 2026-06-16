# Governance Documentation Index

## Purpose

This folder contains the governing documentation for CleanOps.

Governance documents define the non-negotiable principles, data authority rules, migration constraints and development boundaries that all architecture, implementation and validation work must follow.

Use this folder before making decisions that affect system architecture, data ownership, Supabase authority, migration strategy, operational workflows, permissions, tenant handling or long-term product direction.

---

## Documents

### 01-project-constitution.md

Defines the non-negotiable architectural principles of CleanOps.

All future design, implementation and migration decisions must remain compatible with this document.

Read this document before introducing any new system concept, module boundary, data model, migration strategy, authority model, role structure or operational workflow.

This document should be treated as the highest-level governing source for CleanOps architecture.

---

### 02-data-authority-and-test-data-policy.md

Defines the data authority rules for the current development and demo phase.

This document establishes that Supabase is the source of truth, while localStorage is legacy, cache or fallback only.

Read this document before building features on, migrating, deleting, resetting or cleaning up any business entity, including:

- customers
- employees
- companies
- work orders
- schedules
- requests
- keys
- agreements
- payroll-related data
- invoice-related data

It governs:

- Supabase authority
- legacy/localStorage handling
- local-only versus Supabase-backed data
- delete and soft-delete policy
- test-data cleanup
- readiness tooling
- migration safety
- tenant-related data handling

---

## Governance Rules

All CleanOps development must follow these rules:

1. Read `/docs/00-master-index.md` before starting major work.
2. Read the Project Constitution before changing architecture, module boundaries or system concepts.
3. Read the Data Authority and Test Data Policy before changing data ownership, migrations, delete behavior, Supabase repositories or test-data handling.
4. Do not introduce architectural decisions that conflict with the Project Constitution.
5. Do not bypass Supabase authority rules for migrated or Supabase-backed domains.
6. Do not treat localStorage as a source of truth for business-critical data.
7. Do not perform tenant deletion, data reset or migration cleanup without following the relevant runbook or approved policy.
8. Document governance-impacting decisions before implementation.
9. Update relevant architecture, implementation and Development Center documentation when governance-sensitive scope changes.

---

## When to Update Governance Documentation

Update this folder when a change affects:

- source-of-truth rules
- Supabase authority
- localStorage fallback behavior
- tenant deletion or reset policy
- migration safety
- protected admin behavior
- role or permission boundaries
- system-wide architectural principles
- data ownership
- compliance-sensitive operational workflows
- Development Center requirements for major features

---

## Related Documentation

- `/docs/00-master-index.md`
- `/docs/architecture/`
- `/docs/implementation/`
- `/docs/dev-center/`
- `/docs/runbooks/`
- `/docs/proposals/`
