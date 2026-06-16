# Front-End Shell Spec - Slice 1

## Goal

Create a Super Admin page that makes the future Automation & AI Center visible and testable with mock data.

## Route

Preferred:

`/super-admin/automation-ai-center`

Use repository conventions if different.

## Layout

Use existing Super Admin layout.

Recommended internal tabs or section navigation:

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
- Settings

## Overview dashboard

Cards:

- Total Auto Actions
- Active Auto Actions
- Planned Auto Actions
- AI-Capable Actions
- AI-Enabled Actions
- Pending Approval
- Failed Executions
- High-Risk Actions

## Auto Actions table

Required columns:

- Name
- Key
- Module
- Trigger
- Status
- Risk
- Execution Mode
- Approval
- Supports AI
- AI Enabled
- Latest Run

Required filters:

- search
- module
- status
- risk level
- execution mode
- approval required
- supports AI
- AI enabled
- integration status

## Action detail

Open by row click. Use drawer, modal, or page according to repo pattern.

Required sections:

- Summary
- Trigger
- Conditions
- Action Steps
- Risk and Approval
- AI Extension
- Execution History
- Test Scenarios placeholder
- Linked Module
- Notes / Non-live warning

## AI Extensions view

Columns:

- Parent action
- Assistant key
- AI mode
- Allowed outputs
- Approval required
- Enabled
- Prompt version mock

## Approval Queue view

Placeholder with mock data.

Columns:

- Queue item
- Source action
- Module
- Risk
- Proposed action
- AI used
- Status
- Created at

No approve/reject mutation in Slice 1.

## Execution Log view

Columns:

- Execution id
- Action key
- Module
- Source event
- Status
- Risk
- AI used
- Started at
- Completed at
- Error

## Risk & Policies view

Show static policy summary:

- low risk policy
- medium risk policy
- high risk policy
- critical risk policy
- customer communication policy
- employee impact policy
- schedule policy
- AI policy

## Test Mode view

Placeholder only.

Show future intent:

- run mock scenario
- inspect trigger
- inspect condition results
- inspect proposed action
- inspect approval requirement
- inspect AI draft

No live runner in Slice 1.

## Module Coverage view

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

Columns/cards:

- module
- integration status
- planned actions
- active actions
- AI-capable actions
- AI-enabled actions
- quick review status
- missing integration points
- last reviewed

## Visual state labels

Use existing badge/status conventions where possible.

If new badges are needed:

- status: draft, planned, active, disabled, deprecated
- risk: low, medium, high, critical
- execution: observe only, auto with log, auto with notification, admin review, company admin approval, super admin approval, blocked
- AI: not supported, supported, enabled, disabled

## Empty states

Include empty states for:

- no actions in filter result
- no approval items
- no execution logs
- no AI extensions enabled

## Mock data

Use package mock data or translate to local constants.

The UI must be realistic enough to evaluate whether important concepts are missing.

## Non-live warning

The page should clearly indicate that Slice 1 is architecture shell / mock data if appropriate to current development environment.

## Runtime safety shell additions

Slice 1 must add read-only mock sections for runtime safety. If the UI becomes large, group these sections under Runtime Safety, but keep the concepts visible.

Recommended additional sections:

- Runtime Safety Overview
- Runtime Guard Policies
- Limits & Quotas
- Runtime Incidents
- Feature Flags / Kill Switches
- Module Health
- Performance Budgets

### Runtime Safety Overview

Cards:

- Open Runtime Incidents
- High/Critical Incidents
- Active Limits
- Limited Features
- Disabled Features
- Degraded Modules
- Circuit Breakers Open
- Performance Budgets Failing

### Runtime Guard Policies table

Columns:

- Key
- Module
- Scope
- Trigger
- Risk
- Guard actions
- Runtime flag
- Incident policy
- Alert/follow-up
- Resolution policy
- Status

### Limits & Quotas table

Columns:

- Key
- Module
- Scope
- Limit type
- Window
- Threshold
- Guard action
- Status
- Severity

### Runtime Incidents table

Columns:

- Incident id
- Severity
- Status
- Module
- Route
- Endpoint
- Trigger
- Guard action
- User/company/session mock reference
- Started at
- Last seen

### Feature Flags / Kill Switches table

Columns:

- Flag key
- Feature
- Module
- State
- Reason
- Changed by
- Changed at
- Linked incident

### Module Health table

Columns/cards:

- Module
- Health status
- p95 latency mock
- Error rate mock
- Open incidents
- Circuit state
- Last checked

### Performance Budgets table

Columns:

- Budget key
- Scope
- Target
- Current mock value
- Status
- Owner
- Last tested

No live toggle or enforcement mutation in Slice 1.
