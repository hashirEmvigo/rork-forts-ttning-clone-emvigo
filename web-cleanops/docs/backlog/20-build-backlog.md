# CleanOps First Build Backlog v1.0

## Purpose

This document defines the first operational development backlog for CleanOps.

All implementation work should align with:

- 01-project-constitution.md

---

# Cross-Cutting Initiative — Browser Storage Source-of-Truth Remediation

## Goal

Supabase is the source of truth for CleanOps domain data. App-owned browser-persistent storage must not be used as a source, fallback, seed, migration bridge, tenant cache, or revival layer for domain data.

## Current status

- **Phase 1 — Immediate safety:** completed and accepted.
- **Phase 2A — Remaining unsafe-empty read seams:** completed and accepted.
- **Phase 2B — Legacy Browser-Domain Runtime Quarantine:** technical verification/quarantine pass completed; awaiting final review acceptance.

## Phase 2B implementation note

Phase 2B is a **technical quarantine patch**, not a store-layer rewrite. The verification pass keeps the legacy store layer in place while preventing normal app runtime from invoking browser-domain migration, backout, soak, DevTools, or browser-origin mirror paths that could read, revive, seed, migrate, mirror, or write tenant/domain data from app-owned browser storage.

Validation recorded: `runChecks({ appPath: "web-cleanops" })` passed.

Changed files in the Phase 2B technical quarantine implementation:

- `web-cleanops/src/lib/data/runtimeQuarantine.ts`
- `web-cleanops/src/main.tsx`
- `web-cleanops/src/context/AppContext.tsx`
- `web-cleanops/src/pages/superadmin/EmployeeMigration.tsx`
- `web-cleanops/src/pages/superadmin/SystemPerformance.tsx`

## Next recommended scope — Phase 2C

Do not begin Phase 2C until explicitly approved. Recommended Phase 2C scope:

- Replace or retire remaining domain-specific `localStorage` stores module-by-module.
- Start with execution/checklist stores.
- Then address media, payroll, and supporting utilities.
- Preserve only explicitly reviewed non-authoritative cache patterns.

---

# EPIC-001 Mission Foundation

## Goal

Create the operational core object used throughout CleanOps.

### Features

- Mission entity
- Mission status lifecycle
- Assignment support
- Customer linkage
- Object linkage

### Acceptance Criteria

- Mission can be created
- Mission can be assigned
- Mission has lifecycle states
- Mission history can be tracked

---

# EPIC-002 Mission Log Foundation

## Goal

Create the operational history layer.

### Features

- Status history
- Decision log
- Comments
- Customer contact log
- Follow-up tracking

### Acceptance Criteria

- Every important event is logged
- Mission history is traceable
- Operational decisions are visible

---

# EPIC-003 Ready Validation

## Goal

Prevent missions from appearing executable when they are not.

### Features

- Missing Assignment detection
- Resource validation
- Access validation
- Ready blocking

### Acceptance Criteria

- Missing Assignment blocks Ready
- Missing access blocks Ready
- Ready status is explainable

---

# EPIC-004 Operations Center

## Goal

Create the primary operational decision surface.

### Features

- Decision Required
- Missing Assignment
- Key Missing
- Resource Unavailable
- Requires Review
- Follow-up Required

### Acceptance Criteria

- Operations Center only shows actionable items
- Each item has owner and next action

---

# EPIC-005 Requests Foundation

## Goal

Create traceable operational change management.

### Features

- Customer Change Request
- Complaint
- Extra Service Request
- Internal Request

### Acceptance Criteria

- Requests are traceable
- Requests can affect Missions
- Requests remain visible through resolution

---

# EPIC-006 Keys Foundation

## Goal

Create operational access management.

### Features

- Key status
- Key ownership
- Access instructions
- Key Missing

### Acceptance Criteria

- Key Missing blocks Ready
- Key issues appear in Operations Center
- Key events are logged

---

# Future Epics

The following areas are intentionally postponed:

- Notification System — internal in-app notifications (see EPIC-007 / `NOTIF-001` below)
- AI Automation
- Advanced Statistics
- Route Optimization
- Customer Portal
- External Integrations
- Advanced Capacity Planning

---

# EPIC-007 Notification System (Planned)

> **Status: Planned — documentation/planning only.** This backlog item does **not**
> authorise any implementation. No notification table, UI, unread badge, Edge
> Function notification insert, email/SMS, push, or notification settings are to be
> built from this entry until a dedicated, separately approved implementation slice
> exists. Adding this item changes no runtime code and no database schema.

## Backlog item

```text
Title:               Notification System (Internal In-App Notifications)
Ticket ID:           NOTIF-001
Module:              Platform / Cross-cutting (first consumer: Price Calculator)
Status:              Planned (not started)
Priority:            Medium-High (pre-launch dependency for broad public calculator use)
Risk level:          Medium (cross-cutting; must reconcile with existing Notification Center add-on)
Owner:               Unassigned
Dependencies:        Notification Center add-on (architecture §16); Request Management
                     notification integration (RM-090); Price Calculator quote submit flow
Architecture doc:    To be authored when the slice is approved (this item is the placeholder)
Implementation doc:  None yet
Dev Center link:     None yet
```

## Goal / Purpose

Provide a reusable internal notification capability so that important events across
the platform can surface to the right admin without each module hand-rolling its own
alerting. It must be designed as a platform capability, **not** a calculator-only
feature.

The first known concrete use case is:

```text
When a customer submits a quote request through the public price calculator,
Super Admin / relevant admin should receive an internal notification.
```

## Relationship to the existing Notification Center add-on

A **Notification Center Add-on** already exists in the architecture
(`docs/architecture/core-operations/02-operational-execution-architecture.md` §16).
That concept is **outbound-delivery focused**: it consumes events and sends messages
to `admin` / `employee` / `customer` recipients over `in_app` / `push` / `email` /
`sms` channels, gated by the `notification_center` entitlement, company settings,
opt-in and threshold rules (`NotificationEvent`, `CompanyNotificationSettings`,
`NotificationRepository`).

The Notification System described here is the **internal in-app notification layer** —
an internal inbox/feed for admins about platform events. The two are complementary,
not competing:

- The internal in-app feed is effectively the `in_app` surface an event-driven
  system writes to.
- The Notification Center governs outbound channels, recipient settings, opt-in and
  entitlements on top of those events.

**Open architectural decision:** when implemented, these must be reconciled into one
coherent model (a single shared notification event store consumed by both the
in-app feed and the outbound center) rather than two parallel notification systems.
Resolving this belongs to the future architecture slice, not this backlog entry.

Related existing references:

- Request Management notification model / integration —
  `docs/architecture/requests/01-request-management-architecture.md` §11 and
  dev-center `RM-090` in `docs/dev-center/requests/01-request-management-dev-center.md`.
- Price Calculator pre-launch blocker #1 ("no alert to staff") —
  `docs/runbooks/03-price-calculator-prelaunch-and-qa-runbook.md` §2.
- CRM-deferred "Notifications and reminders" —
  `docs/architecture/price-calculator/09-crm-preparation-deferred.md`.

## Planned future use cases

The system should be reusable across modules. Candidate event sources include:

- new calculator quote request submitted (first candidate — see below)
- new customer request / message (Request Management)
- employee late report or schedule issue (Operational Execution / Time Reporting)
- important booking / work-order change
- invoice / payment issue
- customer uploaded media / document
- admin task requiring review (Operations Center / Action Center)
- system warning / configuration issue (e.g. calculator config health warnings)

## Proposed MVP direction (Phase 1)

Start small and internal:

- internal **in-app** notifications first
- **company-scoped** (respect `company_id` / `company_legacy_id` scoping + RLS)
- unread / read state
- notification badge / count
- link / deep-link to the relevant module or item
- `created_at` timestamp
- actor / source (who or what triggered the event) when available
- severity / type (e.g. info / warning / blocking, or a per-module type) when useful

Later phases (out of MVP): email, SMS, and push, delivered through the Notification
Center add-on channels (§16), entitlement- and opt-in-gated.

## First candidate implementation — Calculator quote request notification

Documented here as the first concrete consumer for the future slice:

- **Trigger:** a successful `quote_request` insert from the `public-calculator`
  submit flow (server-side, in or after the Edge Function submit path).
- **Recipient:** Super Admin / relevant admin, company-scoped.
- **Link target:** `/calculator` → Quote Requests tab (or directly to the quote
  detail once detail routing exists).
- **Scope:** `public_slug = rakna-ut-ditt-pris`, `company_legacy_id = cmp_o2f6orw29m`.
- **Why first:** it addresses the internal-staff-alert portion of Price Calculator
  pre-launch blocker #1. A customer-facing confirmation email/SMS remains a separate
  later phase.

## Acceptance criteria (for the future slice, not this entry)

- Company-scoped internal notifications can be created from a platform event without
  coupling each module to delivery details.
- Admin sees an unread count/badge and a notification list.
- Each notification deep-links to its source item.
- Read/unread state persists in Supabase (no localStorage as source of truth).
- RLS prevents cross-company access; no public/anon client writes.
- Reconciled with §16 Notification Center (no duplicate competing systems).

## Validation requirements (future slice)

- Targeted notification tests + access-control tests.
- Calculator regression (submit + Quote Requests inbox unchanged).
- `runChecks` green.

## Open questions

- Single shared notification event store, or an internal in-app feed plus a separate
  outbound center layered on top?
- Who is a "relevant admin" (role/permission targeting — e.g. reuse `calculator.manage`
  for calculator notifications)?
- Where is the notification written: Edge Function, DB trigger, or app-side?
- Per-user vs per-company read state.
- Retention / archival policy for read notifications.

## Explicit non-goals for this backlog entry

This entry is documentation/planning only. It does **not** authorise building any of:

- notification table / migration
- notification UI / unread badge
- Edge Function notification insert
- email / SMS / push delivery
- notification settings

No runtime code and no database/migration changes are made by adding this item.
