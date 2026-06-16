# CleanOps Master Index

## Purpose

This document is the entry point for all architecture, governance and development documentation within CleanOps.

All future architecture, implementation and validation work should begin here.

The purpose of this index is to make sure all development follows the same structure:

Project Constitution → Architecture Documents → Build Backlog → Analysis → Implementation → Validation

---

## Governing Documents

### 00-project-operating-mode-and-test-data-policy.md

Defines the current pre-production / test-data-only operating mode for CleanOps / Städportalen.

Read this before planning implementation phases, validation, runbooks or manual QA. It confirms that all current work uses demo/test data only until a separate explicit go-live/import approval is granted, while still preserving Supabase authority, RLS correctness, migration quality and localStorage regression safeguards.

---

### 01-project-constitution.md

Defines the non-negotiable architectural principles of CleanOps.

All future design, implementation and migration decisions must remain compatible with this document.

Before introducing any new system concept, module boundary, data model or migration strategy, verify that it does not conflict with the Project Constitution.

---

### 02-data-authority-and-test-data-policy.md

Defines the data authority rules for the current development/demo phase: Supabase is the source of truth, localStorage is legacy/cache/fallback only.

Read this before building features on, or making migration/cleanup decisions for, any business entity such as Customers, Employees, and future migrated domains.

It governs local-only vs Supabase-only data handling, delete/soft-delete policy, readiness tooling expectations, and test-data cleanup rules.

---

## Architecture Documents

### 10-core-operations-build-spec.md

Defines the core operations foundation and the main operational build specification.

Use this document when working with the existing operational base, including core workflow structure, operations logic and foundational build decisions.

---

### 30-operational-execution-architecture.md

Defines the operational execution architecture.

This document covers the separation between:

* Mission Log
* Time Reporting
* Payroll Basis
* Invoice Basis
* Operational Flags
* Notification Center
* Incident Management
* Action Center
* Time Quality Analytics

Use this document before implementing or changing execution-related workflows, time reporting, check-in/check-out logic, operational deviations, notifications, incidents, payroll basis or invoice basis.

---

### docs/architecture/schedule/00-schedule-index.md

Defines the canonical Schedule Module documentation package and implementation-safety guardrails.

Phase 0 status: schedule docs are target architecture only unless a later ADR and implementation approval says otherwise.

Read this before any schedule-related work. It separates current implementation surfaces from future target concepts:

* Current: Work Orders, WorkOrder service rows, Booking Queue, Schedule Core and occurrence exceptions.
* Future/documentation-only: Assignment, ScheduleSeries, RecurrenceRule, planned schedule occurrence, ScheduleChangeSet, ScheduleLock and StaffAvailability.

### docs/architecture/schedule/01-schedule-module-architecture.md

Defines the architecture for the Schedule Module.

This document covers the deterministic scheduling foundation for:

* recurring schedule series
* recurrence rules
* generated schedule occurrences
* occurrence overrides / variations
* manual admin scheduling
* forward preview
* future conflict detection
* solvable schedule conflicts
* customer preferences and approved deviations
* staff availability
* schedule locking
* history protection
* future AI-assisted scheduling on top of the same validation engine

Use this document before implementing or changing scheduling logic, recurring customer planning, one-off bookings, assignment/AO variations, schedule preview, conflict resolution or AI-assisted scheduling.

Important principle:

A visible empty slot in one week must not automatically be treated as a recurring available slot. The schedule engine must evaluate future occurrences before allowing a recurring booking to be created.

---

### docs/architecture/schedule/02-service-level-scheduling-packages.md

Defines the target architecture for future Service Level Policy Packages and how they may influence scheduling, operational priority and future customer service differentiation.

A Service Level Policy Package is a future scheduling/customer-priority policy concept, not the existing service package/catalog template.

This document covers the policy model for:

* service level package definitions
* customer-facing package tiers
* internal scheduling priority
* time-window flexibility
* same-staff continuity rules
* approved substitute pools
* minimum staff qualification levels
* AI scheduling optimization freedom
* conflict-resolution priority
* customer agreement integration
* future support/SLA extensions
* premium customer handling beyond scheduling

Use this document before implementing or changing package-based scheduling rules, customer service levels, premium/priority customer logic, staff qualification matching, support priority, SLA behavior or AI optimization policies.

Important principle:

Service level packages must not be implemented as hard-coded UI labels. They should be modeled as policy-driven configuration that can later extend beyond scheduling into customer support, communication priority, SLA handling, quality controls and other premium service capabilities.



### docs/architecture/schedule/04-customer-scheduling-preferences-and-temporary-exceptions.md

Defines the customer scheduling preference and temporary exception architecture for the Schedule Module.

Covers preferred recurring cleaning times, acceptable recurring cleaning times, acceptable temporary cleaning times, temporary rescheduling priority, date-bound temporary scheduling exceptions, Customer Portal self-service boundaries, Customer Card admin scope, WorkOrderDetails planning guidance, Add Service Status Preview, Booking Queue implications and AI/scheduling semantics.

Use this before implementing or changing customer Cleaning Days & Times, temporary scheduling exceptions, Customer Portal scheduling self-service, WorkOrderDetails customer preference warnings or Add Service customer-fit logic.

Temporary Scheduling Exceptions are warning/guidance only until a later ADR approves storage, permissions and write behavior. They must not create occurrence exceptions, move WorkOrder service rows, write Booking Queue, mutate recurring series, affect Mission Log or affect Time Reporting.

### docs/architecture/schedule/05-schedule-planning-mode-capacity-compression-and-decision-learning.md

Defines Planning Mode, capacity analytics, Schedule Compression Mode, Holiday Compression Mode and AI decision-learning boundaries.

Covers draft ScheduleChangeSets, change basket, reason capture, AI learning company settings, booked vs bookable capacity, fragmentation, compression objectives, compression scenarios, customer communication and quality review.

Use this before implementing planning-mode workflows, schedule compression, holiday-week planning, capacity analytics, AI learning or publish/review flows.

Planning Mode, persistent ScheduleChangeSet, capacity analytics, compression, AI scheduling and schedule-driven Mission Log/Time Reporting integration remain documentation-only until later ADR approval.

---

### docs/architecture/request-crm/00-index.md  (REQUEST CRM v0.2 - canonical)

The **REQUEST CRM Communications Platform v0.2 (Automation & AI Center aligned)** package is now the canonical planning source for the REQUEST / CRM communication domain.

Start at `/docs/architecture/request-crm/00-index.md`, which links every document in reading order. Related package material: `/docs/adr/` (ADR-0001..0006), `/docs/ui/request-crm/`, `/schemas/request-crm/`, `/mock-data/request-crm/`, `/contracts/typescript/request-crm/` and `/rork/request-crm/`.

Status: implementation-planning-ready. No product code yet; RORK/Claude must return a reviewed implementation plan first, and the first approved build is Slice 0 (frontend shell with mock data only). Automation & AI Center Runtime Safety v3 remains the single source of truth for automation registry, AI extensions, risk levels, runtime guards, kill switches, circuit breaker visibility, execution/incident logs and approval policy.

---

### docs/architecture/automation-ai-center/00-automation-ai-center-index.md  (Automation & AI Center Runtime Safety v3 - canonical)

The **Automation & AI Center Runtime Safety v3** package (`v3-runtime-safety-master-review`) is the single source of truth for the automation action registry, AI extension registry, risk levels, execution/approval policy, runtime guard policy, runtime flags & kill switches, circuit breaker visibility, execution/incident logs, performance/resilience gates and module health.

Start at `/docs/architecture/automation-ai-center/00-automation-ai-center-index.md`, which links every document (`00`–`19`) in reading order. Related material: `/docs/adr/` (ADR-0001..0007 automation decisions), `/schemas/automation-ai-center/`, `/mock-data/automation-ai-center/`, `/contracts/typescript/automation-ai-center/`, `/filters/automation-ai-center/`, `/rork/automation-ai-center/` and provenance in `/rork/automation-ai-center/_package/`.

Status: documentation/architecture only. No live automation, live AI, runtime enforcement, kill switch/circuit breaker enforcement or implementation plan is authorized by this package. The first approved build is Slice 1 (frontend shell with mock/read-only data only). REQUEST CRM depends on this package as its external automation / runtime-safety source of truth.

---

### 33-request-management-architecture.md  (superseded by REQUEST CRM v0.2)

Earlier v0.1 communication and request management notes for CleanOps. **Superseded by the REQUEST CRM v0.2 package above**; retained for history only.

Covers:

- Internal communication
- Customer communication
- Employee communication
- Supplier communication
- Emergency requests
- Inbox Zero workflows
- Confirmation workflows
- Linked requests
- Ratings and feedback
- Notification integration
- Reporting and KPI architecture

---

## Operational Runbooks

### 42-tenant-test-data-reset-runbook.md

Validated, repeatable procedure for fully removing a single company/tenant and all of its company-scoped data from the live Supabase project, with an optional auth.users orphan cleanup.

Read this before deleting or resetting any company tenant.

It defines the strict delete ordering, the SELECT-only dry-run and post-verification phases, the protected super_admin checks, and the operator lesson about never mixing transaction keywords in the Supabase SQL Editor.

---

### 43-request-management-implementation-plan.md

Implementation roadmap for Request Management.

Defines:

- Database architecture
- Repository layer
- UI implementation
- Permissions
- Feature flags
- Testing strategy

---

### 44-request-management-dev-center.md

Development Center execution plan for Request Management.

Contains:

- Feature breakdown
- Coding tasks
- Acceptance criteria
- Manual validation workflow
- Bug tracking
- Github review checkpoints
- Rork architecture review checkpoints

---

## Proposals / Architecture Notes

### 50-tenant-deletion-schema-hardening-proposal.md

Analysis and options for making tenant deletion an explicit, intentional routine rather than emergent FK behaviour.

Covers profiles.company_id ON DELETE SET NULL vs CASCADE/RESTRICT, an explicit delete_company_tenant routine, and interactions with the protected super_admin, auth.users, RLS, and provisioning flows.

This is a proposal only — no schema changes are authorised by it.

Read it before designing any tenant-deletion migration.

---

### proposed-migrations/0034_tenant_deletion_routine.sql.proposed

Unapplied draft migration implementing the proposal's recommended direction.

It repoints profiles.company_id to ON DELETE RESTRICT and adds an explicit, audited delete_company_tenant(company_id, legacy_id, …) routine that deletes a tenant's company-scoped data in the runbook order, never touches auth.users, and never deletes the protected super_admin.

Accompanied by:

* proposed-migrations/0034_tenant_deletion_routine.test-plan.md

Deliberately kept outside supabase/migrations/ with a `.sql.proposed` extension so it cannot be auto-applied.

Do not promote it until the proposal's open decisions are signed off and the test plan passes on staging.

---

## Development Documents

### 20-build-backlog.md

Defines the current development backlog and implementation priorities.

All implementation work should be checked against this document before coding begins.

If a new feature or module is not represented in the backlog, update or extend the backlog before implementation starts.

---

## Current Architecture Status

The core architecture foundation is established.

Current focus areas:

* Mission Foundation
* Mission Log
* Time Reporting
* Ready Validation
* Operations Center
* Requests
* Keys
* Operational Execution
* Schedule Module
* Service Level Packages
* Development Center tracking

---

## Development Process

All future work should follow this process:

1. Read 01-project-constitution.md
2. Read relevant architecture documents
3. Read relevant backlog items in 20-build-backlog.md
4. Verify compatibility with the current architecture
5. Identify conflicts before implementation
6. Propose an implementation plan
7. Implement in controlled phases
8. Validate with build, static checks and functional verification
9. Update Development Center / documentation when scope or status changes

---

## Instructions for Future Development

Before implementation:

* Read 01-project-constitution.md
* Read the relevant architecture document
* Read relevant backlog items in 20-build-backlog.md
* Verify compatibility with existing module boundaries
* Verify compatibility with current data ownership rules in 02-data-authority-and-test-data-policy.md
* Verify compatibility with Supabase migration strategy
* Report conflicts before implementation
* Do not introduce architectural decisions that conflict with the Project Constitution
* Do not bypass Development Center tracking for major architecture or migration work
* Do not implement large multi-module changes in one uncontrolled pass

For scheduling-related work, read `/docs/architecture/schedule/00-schedule-index.md` and the canonical files under `/docs/architecture/schedule/` before implementing any recurring schedule, occurrence, variation, preview, conflict detection or schedule optimization logic. If the work touches customer preferences, temporary exceptions, planning mode, schedule compression, capacity analytics or AI decision learning, read the corresponding schedule documents first.

For service-level or package-related work, read `/docs/architecture/schedule/02-service-level-scheduling-packages.md` before implementing any package tier, scheduling-priority rule, customer service level, staff qualification matching, support priority, SLA behavior or AI optimization policy.

---

## Documentation Rule

If a new feature changes architecture, data ownership, module boundaries, entitlements, migration strategy or operational workflow, it must be documented before implementation.

Relevant documentation should be updated in the same phase as the implementation plan, not after the system has already diverged.
