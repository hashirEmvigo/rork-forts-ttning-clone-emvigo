# UI Filter Spec

## Scope

Filters for Automation & AI Center front-end shell.

## Global filters

- search text
- module
- action status
- risk level
- execution mode
- approval requirement
- supports AI
- AI enabled
- integration status
- owner domain
- latest execution status
- tag

## Auto Actions table filters

### Search

Search fields:

- name
- key
- description
- module
- tags

### Module

Allowed values:

- schedule
- cases
- chat
- notifications
- keys_alarm
- customer_card
- work_orders
- invoices
- media
- time_bank
- agreements
- employees
- system

### Status

- draft
- planned
- active
- disabled
- deprecated

### Risk

- low
- medium
- high
- critical

### Execution mode

- observe_only
- auto_execute_with_log
- auto_execute_with_notification
- requires_admin_review
- requires_company_admin_approval
- requires_super_admin_approval
- blocked

### Approval

- no_approval_required
- admin_review
- company_admin_approval
- super_admin_approval
- blocked

### AI

- supports_ai_true
- supports_ai_false
- ai_enabled_true
- ai_enabled_false

## Module Coverage filters

- integration status: not_started, planned, partial, ready, active
- quick review: none, planned, available
- module group
- missing integration points present yes/no

## Execution Log filters

- action key
- module
- execution status
- risk level
- AI used yes/no
- date range
- source entity type
- error only

## Approval Queue filters

- status
- risk
- module
- AI used
- required role
- assigned to
- created date range

## Behavior

All filters in Slice 1 operate on mock data only.

Do not implement backend filtering in Slice 1. Filters operate on mock/static data only.

## Runtime safety filters

Additional filter targets:

- `runtime_guard_policies`
- `runtime_limits`
- `runtime_incidents`
- `feature_flags`
- `module_health`
- `performance_budgets`

Required additional filters:

- `incidentSeverity`
- `incidentStatus`
- `guardAction`
- `runtimeState`
- `healthStatus`
- `performanceBudgetStatus`
- `limitType`
- `guardPolicyStatus`

Runtime safety filters should use the same component conventions as the existing Automation & AI Center tables.

## Runtime Guard Policies filters

- search
- module
- scope
- trigger type
- risk level
- guard action
- runtime flag present yes/no
- incident severity
- alert target
- status

Slice 1 filters operate on mock `runtime-guard-policies.seed.json` only.
