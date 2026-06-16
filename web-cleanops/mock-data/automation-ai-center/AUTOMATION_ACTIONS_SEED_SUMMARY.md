# Seed Auto Actions

This mock registry contains 50 seed auto-actions for Slice 1 UI evaluation.

| Key | Module | Risk | Status | AI |
|---|---|---|---|---|
| `schedule.delay.employee_late_detected` | schedule | medium | active | false |
| `schedule.delay.impact_detected` | schedule | medium | planned | true |
| `schedule.delay.employee_confirmation_requested` | schedule | medium | planned | false |
| `schedule.delay.no_customer_impact_logged` | schedule | low | planned | false |
| `schedule.delay.eta_updated` | schedule | medium | planned | false |
| `schedule.delay.customer_app_notification_sent` | schedule | medium | planned | false |
| `schedule.delay.negative_customer_impact_detected` | schedule | high | planned | true |
| `schedule.conflict.assignment_overlap_detected` | schedule | high | planned | true |
| `schedule.route.travel_time_risk_detected` | schedule | medium | planned | true |
| `cases.lifecycle.case_created_log` | cases | low | planned | false |
| `cases.priority.initial_priority_suggested` | cases | medium | planned | true |
| `cases.sla.unhandled_case_risk` | cases | medium | planned | true |
| `cases.routing.owner_suggestion_created` | cases | medium | planned | true |
| `cases.reply.customer_reply_received` | cases | low | planned | false |
| `cases.escalation.complaint_case_escalated` | cases | high | planned | true |
| `chat.message.customer_received` | chat | low | planned | false |
| `chat.message.unanswered_detected` | chat | medium | planned | true |
| `chat.message.complaint_detected` | chat | high | planned | true |
| `chat.request.booking_detected` | chat | medium | planned | true |
| `chat.request.cancellation_detected` | chat | high | planned | true |
| `notifications.delivery.failed_detected` | notifications | medium | planned | false |
| `notifications.escalation.critical_unacknowledged` | notifications | high | planned | false |
| `notifications.preference.customer_opt_out_logged` | notifications | low | planned | false |
| `keys.access.missing_key_info` | keys_alarm | medium | planned | true |
| `keys.access.missing_alarm_code` | keys_alarm | high | planned | true |
| `keys.access.high_risk_note_added` | keys_alarm | high | planned | false |
| `keys.access.instruction_conflict` | keys_alarm | high | planned | true |
| `customer.profile.cleaning_protocol_missing` | customer_card | medium | planned | true |
| `customer.profile.communication_preference_changed` | customer_card | low | planned | false |
| `customer.profile.risk_note_added` | customer_card | high | planned | false |
| `work_orders.data.missing_required_info` | work_orders | medium | planned | true |
| `work_orders.completion.missing_media` | work_orders | medium | planned | false |
| `work_orders.quality.issue_detected` | work_orders | high | planned | true |
| `work_orders.assignment.unassigned_risk` | work_orders | high | planned | false |
| `invoices.payment.overdue_detected` | invoices | high | planned | false |
| `invoices.question.customer_invoice_question` | invoices | medium | planned | true |
| `invoices.rut.status_changed` | invoices | high | planned | false |
| `media.required.missing_detected` | media | medium | planned | false |
| `media.review.damage_photo_uploaded` | media | high | planned | true |
| `media.review.media_review_required` | media | medium | planned | false |
| `time_bank.balance.low_detected` | time_bank | medium | planned | false |
| `time_bank.balance.negative_detected` | time_bank | high | planned | false |
| `time_bank.adjustment.manual_requested` | time_bank | critical | planned | false |
| `agreements.renewal.due_detected` | agreements | medium | planned | false |
| `agreements.cancellation.requested` | agreements | critical | planned | true |
| `agreements.price.change_required` | agreements | critical | planned | false |
| `employees.availability.changed` | employees | low | planned | false |
| `employees.absence.reported` | employees | high | planned | true |
| `employees.shift.conflict_detected` | employees | high | planned | true |
| `system.health.automation_failure_detected` | system | high | planned | false |

## Runtime safety mock datasets

Additional Slice 1 mock datasets now exist:

| File | Purpose |
|---|---|
| `runtime-safety-limits.seed.json` | Mock rate limits, quotas, timeout/resource limits, and guard actions. |
| `runtime-incidents.seed.json` | Mock incidents for frontend loop, AI quota, invoice export timeout, and media upload burst. |
| `feature-runtime-flags.seed.json` | Mock feature flags and kill switch states. |
| `module-health.seed.json` | Mock module health, p95 latency, error rate, circuit state, and runtime state. |
| `performance-budgets.seed.json` | Mock performance budgets for routes, endpoints, jobs, bundles, database queries, and AI features. |

Some automation actions also include optional runtime safety metadata such as `resourceProfile`, `safetyLimitKeys`, `timeoutMs`, and `maxRetries`.

## Runtime guard policy mock dataset

`runtime-guard-policies.seed.json` adds the canonical guard-policy layer for Slice 1 UI evaluation.

This dataset explicitly represents the scalable runtime-safety lifecycle:

```text
Trigger -> Condition -> Risk level -> Guard action -> Runtime flag -> Execution/incident log -> Alert/follow-up -> Resolution
```

Seed guard policies:

| Key | Module | Trigger | Risk | Primary guard |
|---|---|---|---|---|
| `runtime.guard.booking_list_frontend_loop` | schedule | frontend_loop_detected | high | throttle/quarantine_session |
| `runtime.guard.schedule_grid_bounded_reads` | schedule | resource_quota_exceeded | medium | limit_data |
| `runtime.guard.ai_chat_request_budget` | chat | ai_quota_exceeded | medium | throttle |
| `runtime.guard.invoice_export_timeout_circuit` | invoices | timeout_threshold_exceeded | high | block_request/open_circuit |
| `runtime.guard.media_upload_concurrency` | media | resource_quota_exceeded | medium | throttle |
| `runtime.guard.automation_runner_action_concurrency` | system | concurrent_limit_exceeded | critical | open_circuit/block_request |
| `runtime.guard.public_pricing_calculator_session_cap` | system | rate_limit_exceeded | medium | throttle |
| `runtime.guard.customer_card_reload_loop` | customer_card | frontend_loop_detected | medium | quarantine_session |
