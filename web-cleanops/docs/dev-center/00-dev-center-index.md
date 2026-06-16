# Development Center Documentation Index

## Purpose

This folder contains documentation for CleanOps Development Center tracking, validation and release readiness.

Development Center is the internal control surface for larger feature work. It should show what is built, what remains, what is blocked, what has been tested, which bugs are open, and whether a feature is ready to release.

Use this folder before implementing, validating or releasing major features.

---

## General Documents

### 01-feature-depth-model.md

Defines the standard feature-depth model for larger or risk-sensitive modules.

This document explains how major features should be broken down inside Development Center, including:

- feature status
- implementation status
- scenario test plans
- manual validation
- bug tracking
- release readiness
- open questions
- linked tickets

This model should be used for all major or operationally sensitive modules, including:

- Keys
- Requests
- Schedule
- Automation
- AI-assisted workflows
- operational execution flows

---

### 10-paused-workstreams-and-handoff-status.md

Cross-cutting status + handoff record for **paused** workstreams. Read this first when returning to the project after a pause to see what is frozen, what is safe to continue, and what must not be resumed without a new explicit instruction.

Currently logs three paused tracks — TypeScript cleanup / strict TS debt, Calculator V2, and Auth / Invite / Admin User Lifecycle — each with current status, latest completed work, blockers/deferred items, per-track resume instructions, and a dated development log.

---

## Module Folders

### requests/

Development Center documentation for Request Management.

Use this folder when tracking Request Management implementation, manual validation, bug testing and release readiness.

Expected documents:

- `00-requests-dev-center-index.md`
- `01-request-management-dev-center.md`

---

### keys/

Reserved for KEYS Development Center documentation.

Use this folder when tracking KEYS implementation, scenario testing, manual validation, key-process bugs and release readiness.

Expected documents:

- `00-keys-dev-center-index.md`
- `01-keys-scenario-test-plan.md`
- `02-keys-manual-validation-workflow.md`

---

### price-calculator/

Development Center documentation for the public Price Calculator.

Use this folder when tracking calculator build slices, the V2 / generic flow, and the current data/baseline status.

Key documents:

- `00-rork-master-prompt.md` … `03-rork-repo-analysis-checklist.md` — original build prompts.
- `04-home-only-baseline-status.md` — **current status**: the Home-only calculator baseline (data delta, Admin default-workspace filtering, public-config Home-only guarantees, known remaining items, risks, next step).

---

## Development Center Rules

Major features must not bypass Development Center tracking.

A feature should have Development Center depth when it:

- affects operational workflows
- affects customer, employee or admin-facing processes
- introduces automation
- changes scheduling logic
- changes access, keys, codes or customer entry logic
- requires manual validation
- contains multiple scenarios or edge cases
- has release risk if implemented incorrectly

---

## Required Tracking for Major Features

For larger features, Development Center should track:

1. What is built.
2. What remains.
3. What is blocked.
4. Which scenarios have been tested.
5. Which scenarios failed.
6. Which bugs are open.
7. Which bugs require retest.
8. Which decisions or questions are unresolved.
9. Whether the feature is ready for release.

---

## Recommended Scenario Statuses

Manual validation scenarios should use clear status values:

- `Not tested`
- `In progress`
- `Passed`
- `Failed`
- `Partially passed`
- `Blocked`
- `Needs retest`
- `Deprecated`

---

## Recommended Bug Statuses

Bugs identified through Development Center testing should use clear status values:

- `Open`
- `In progress`
- `Fixed`
- `Needs retest`
- `Closed`
- `Deferred`

---

## Release Readiness Rule

A major feature should not be considered release-ready if:

- critical scenarios are untested
- critical scenarios have failed
- critical bugs are open
- required manual validation is missing
- Development Center status is not updated
- architecture and implementation documentation are out of sync

---

## Related Documentation

- `/docs/00-master-index.md`
- `/docs/backlog/20-build-backlog.md`
- `/docs/implementation/`
- `/docs/architecture/`
