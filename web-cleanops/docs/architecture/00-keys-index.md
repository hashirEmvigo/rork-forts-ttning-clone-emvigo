# KEYS Architecture Documentation Index

## Purpose

This folder contains the complete architecture documentation for the KEYS / Access Management module in CleanOps.

KEYS covers operational access management for:

- physical keys
- tags
- access codes
- customer entry / customer opens the door
- key custody
- temporary key holders
- permanent key ownership
- schedule-based access analysis
- key transfer plans
- admin-controlled and policy-controlled automation
- future AI-assisted access administration
- incident handling
- auditability and traceability

Use this folder before implementing or changing any access-related behavior.

---

## Documents

### 01-keys-access-management-architecture.md

Main architecture document for KEYS.

Read this before changing core access, custody, key transfer, employee visibility or admin workflow logic.

---

### 02-keys-schedule-access-analysis.md

Defines how KEYS integrates with Schedule.

Covers access validation for recurring bookings, one-off bookings, short-notice bookings, schedule changes, revalidation, temporary key needs and visible change notifications.

---

### 03-keys-automation-ai-governance.md

Defines automation levels, admin approval, auto/confirmation, exception handling and future AI autonomy.

---

### 04-keys-admin-dashboard-architecture.md

Defines the admin dashboard for key status, active processes, pending confirmations, broken plans, risk visibility and admin override actions.

---

### 05-keys-data-model-and-status-model.md

Defines the recommended data model, status model, process states, custody events, transfer plans, process locks and audit events.

---

### 06-keys-risk-analysis.md

Defines operational, security, automation, schedule and UX risks for KEYS.

---

### 07-keys-api-and-services-contract.md

Defines recommended backend services, TypeScript contracts, API boundaries, domain events and invariants.

---

### 08-keys-state-machines.md

Defines state machines for access requirements, key custody, transfer plans, employee confirmations, revalidation and incidents.

---

## Canonical Principles

1. KEYS is not only a key register. It is an operational access readiness system.
2. Access readiness is evaluated against future schedule needs.
3. Physical custody must be separated from permanent responsibility.
4. Temporary key carriers must not become permanent key owners by accident.
5. A schedule change must revalidate any affected access process.
6. A broken or changed access process must be visible to admin and affected employees.
7. Automation must be policy-controlled per process type.
8. Admin must always be able to override, replace or stop an active key process.
9. Future AI autonomy must use the same policy engine, risk model and audit trail as manual/automatic flows.
10. All key movements, confirmations and overrides must be auditable.

---

## Related Documentation

- `/docs/00-master-index.md`
- `/docs/governance/01-project-constitution.md`
- `/docs/governance/02-data-authority-and-test-data-policy.md`
- `/docs/architecture/schedule/00-schedule-index.md`
- `/docs/implementation/keys/00-keys-implementation-index.md`
- `/docs/dev-center/keys/00-keys-dev-center-index.md`
