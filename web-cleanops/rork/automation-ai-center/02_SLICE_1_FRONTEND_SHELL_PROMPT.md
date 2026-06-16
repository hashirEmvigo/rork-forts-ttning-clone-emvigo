# RORK Prompt - Build Slice 1 Front-End Shell

Use this only after the implementation plan has been approved.

## Objective

Build the first front-end shell for Automation & AI Center using mock/static data only.

## Scope

Super Admin UI shell. No live automation engine. No live AI. No live approval mutations. No live runtime enforcement.

## Route

Preferred route:

`/super-admin/automation-ai-center`

Use repository conventions if different.

## Required UI sections

- Overview
- Auto Actions
- AI Extensions
- Approval Queue
- Execution Log
- Risk & Policies
- Test Mode
- Module Coverage
- Runtime Safety
- Runtime Guard Policies
- Limits & Quotas
- Runtime Incidents
- Feature Flags / Kill Switches
- Module Health
- Performance Budgets
- Settings placeholder if appropriate

## Required components/states

### Overview

Show cards for:

- total auto-actions
- active actions
- planned actions
- AI-capable actions
- AI-enabled actions
- pending approvals
- failed executions
- high-risk actions
- active/planned runtime guard policies
- open runtime incidents
- limited/disabled features
- degraded modules
- failing performance budgets

### Auto Actions

Table columns:

- name
- key
- module
- trigger
- status
- risk
- execution mode
- approval
- supports AI
- AI enabled
- latest run

Filters:

- search
- module
- status
- risk level
- execution mode
- approval required
- supports AI
- AI enabled

### AI Extensions

Show parent action, assistant key, AI mode, allowed outputs, approval requirement, enabled status, prompt version.

### Approval Queue

Read-only mock list. No approve/reject mutation.

### Execution Log

Read-only mock list with status, risk, AI used, timestamp, error.

### Runtime Safety

Read-only mock overview showing:

- active runtime guard policies
- active runtime limits
- recent guard triggers
- session/user/company/module safety scopes
- abnormal activity examples
- non-live warning

### Runtime Guard Policies

Read-only mock table with:

- policy key
- module
- scope
- trigger type
- condition summary
- risk level
- guard actions
- linked runtime flag
- incident policy
- alert/follow-up policy
- resolution policy
- status

### Limits & Quotas

Read-only mock table with:

- limit key
- module
- scope
- limit type
- window
- threshold
- guard action
- status
- severity

### Runtime Incidents

Read-only mock table with:

- incident id
- severity
- status
- module
- route
- endpoint
- trigger type
- guard action
- started at
- last seen
- assigned to

### Feature Flags / Kill Switches

Read-only mock table with:

- flag key
- feature name
- module
- state
- reason
- changed by
- changed at
- linked incident

### Module Health

Show module cards/table:

- module
- health status
- p95 latency mock
- error rate mock
- open incidents
- circuit state
- last checked

### Performance Budgets

Read-only mock table with:

- budget key
- scope type
- module/route/endpoint
- target metric
- target value
- current value
- status
- owner
- last tested

### Module Coverage

Show all required modules and readiness status.

Required modules:

- Schedule
- Cases
- Chat
- Notifications
- Keys & Alarm
- Customer Card
- Work Orders
- Invoices
- Media
- Time Bank
- Agreements
- Employees
- System

### Action Detail

Open row detail through repository-standard drawer/modal/page.

Show:

- summary
- trigger
- conditions
- action steps
- risk and approval
- AI extension
- execution history
- linked runtime safety limits if available
- linked feature flag if available
- test scenarios placeholder
- linked module
- non-live warning

## Data

Use package mock data or translate into local constants.

Recommended mock sources:

- `mock-data/automation-actions.seed.json`
- `mock-data/ai-extensions.seed.json`
- `mock-data/approval-queue.seed.json`
- `mock-data/execution-log.seed.json`
- `mock-data/module-coverage.seed.json`
- `mock-data/runtime-guard-policies.seed.json`
- `mock-data/runtime-safety-limits.seed.json`
- `mock-data/runtime-incidents.seed.json`
- `mock-data/feature-runtime-flags.seed.json`
- `mock-data/module-health.seed.json`
- `mock-data/performance-budgets.seed.json`

## Constraints

- No live mutations.
- No live AI calls.
- No live automation execution.
- No live runtime enforcement.
- No hidden module logic.
- Use existing design system conventions.
- Keep UI clearly marked as architecture shell/mock if appropriate.

## Acceptance criteria

- route loads
- navigation works
- all required sections are visible or intentionally grouped
- mock data renders
- filters work for relevant tables
- action detail opens
- runtime safety mock sections render
- runtime guard policy mock data renders
- incident/feature-flag/module-health/performance-budget mock data renders
- no live production behavior introduced
- no live rate limiting, kill switch mutation, circuit breaker enforcement, session quarantine, or alert routing introduced
- no domain data mutated
- responsive layout follows repository conventions
