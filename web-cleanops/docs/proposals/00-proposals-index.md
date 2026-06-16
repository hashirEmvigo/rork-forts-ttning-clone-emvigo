# Proposals Documentation Index

## Purpose

This folder contains proposals, draft architecture notes and unapplied migration ideas.

Documents in this folder are not automatically approved architecture.

They must be reviewed, accepted and promoted before implementation or migration.

---

## Documents

### 01-tenant-deletion-schema-hardening-proposal.md

Analysis and options for making tenant deletion an explicit, intentional routine rather than emergent foreign-key behavior.

Read this before designing any tenant-deletion migration.

### proposed-migrations/

Contains unapplied draft migrations and related test plans.

Draft migrations in this folder must not be auto-applied.

---

## Rules

Proposal documents are not implementation approval.

Before promoting a proposal:

1. Review the proposal.
2. Resolve open decisions.
3. Confirm compatibility with the Project Constitution.
4. Confirm compatibility with the Data Authority and Test Data Policy.
5. Create or update the implementation plan.
6. Validate on staging or controlled test data before production use.
