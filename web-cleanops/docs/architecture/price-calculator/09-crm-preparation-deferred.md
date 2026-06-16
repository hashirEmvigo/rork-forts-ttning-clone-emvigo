# CRM Preparation - Deferred Scope

**Audience:** RORK / GPT-5.5 High  
**Project:** CleanOps / Stadportalen / Price Calculator  
**Instruction level:** Treat this as implementation guidance for repository analysis, architecture validation, and phased build planning. The human project owner does not need explanatory simplification. Be precise, conservative, and repo-grounded.

---
## Decision

CRM should be prepared structurally but not built in the MVP.

## Why defer CRM

The immediate value is quote acquisition and prospect creation. A full CRM pipeline introduces additional complexity:

- Sales stages.
- Lead ownership.
- Follow-up automation.
- Activity logging.
- Conversion dashboards.
- Pipeline UI.
- Notifications and reminders.

This should not block the calculator MVP.

## What to prepare now

Prepare data fields that make CRM possible later:

- `source`
- `source_url`
- `campaign_source`
- `prospect_status`
- `quote_status`
- `created_from_calculator`
- timestamps
- company relation
- prospect/customer relation

## What not to build now

Do not build:

- CRM navigation.
- Pipeline board.
- Deal stages.
- Lead scoring.
- Sales task reminders.
- CRM dashboards.
- Email/SMS sequences.

## Future CRM direction

A future CRM module can consume quote requests and prospects as inputs.

Possible future entities:

- `crm_leads`
- `crm_pipeline_stages`
- `crm_activities`
- `crm_tasks`
- `crm_notes`
- `crm_conversions`

RORK should avoid locking the MVP into a model that prevents this, but should not implement it now.
