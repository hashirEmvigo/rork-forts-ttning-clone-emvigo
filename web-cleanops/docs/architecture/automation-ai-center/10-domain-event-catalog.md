# Initial Domain Event Catalog

This catalog defines likely future events. It is not a complete production event bus specification.

## Schedule

- `schedule.employee_late_detected`
- `schedule.employee_on_time_recorded`
- `schedule.delay_impact_detected`
- `schedule.employee_delay_confirmation_requested`
- `schedule.employee_confirmed_no_delay_impact`
- `schedule.employee_confirmed_delay_impact`
- `schedule.employee_delay_confirmation_timeout`
- `schedule.eta_updated`
- `schedule.customer_delay_notification_sent`
- `schedule.negative_customer_impact_detected`
- `schedule.admin_review_required`
- `schedule.schedule_conflict_detected`
- `schedule.assignment_started`
- `schedule.assignment_completed`

## Cases

- `cases.case_created`
- `cases.case_updated`
- `cases.case_status_changed`
- `cases.customer_replied`
- `cases.admin_replied`
- `cases.unhandled_case_risk_detected`
- `cases.priority_changed`
- `cases.case_escalated`
- `cases.case_resolved`
- `cases.customer_reopened_case`

## Chat

- `chat.customer_message_received`
- `chat.employee_message_received`
- `chat.admin_message_received`
- `chat.unanswered_message_detected`
- `chat.complaint_signal_detected`
- `chat.booking_request_detected`
- `chat.cancellation_request_detected`
- `chat.payment_question_detected`
- `chat.handoff_to_human_required`

## Notifications

- `notifications.internal_notification_created`
- `notifications.customer_notification_created`
- `notifications.customer_notification_sent`
- `notifications.delivery_failed`
- `notifications.notification_acknowledged`
- `notifications.notification_expired`
- `notifications.customer_opted_in`
- `notifications.customer_opted_out`

## Keys & Alarm

- `keys.access_info_created`
- `keys.access_info_updated`
- `keys.missing_key_info_detected`
- `keys.missing_alarm_code_detected`
- `keys.high_risk_access_note_added`
- `keys.access_instruction_conflict_detected`
- `keys.access_info_verified`

## Customer Card

- `customer.profile_created`
- `customer.profile_updated`
- `customer.cleaning_protocol_missing`
- `customer.cleaning_protocol_updated`
- `customer.preference_changed`
- `customer.risk_note_added`
- `customer.communication_preference_changed`

## Work Orders

- `work_orders.created`
- `work_orders.assigned`
- `work_orders.missing_required_info_detected`
- `work_orders.started`
- `work_orders.completed`
- `work_orders.completion_missing_media`
- `work_orders.customer_feedback_received`
- `work_orders.quality_issue_detected`

## Invoices

- `invoices.created`
- `invoices.sent`
- `invoices.overdue_detected`
- `invoices.payment_received`
- `invoices.payment_status_changed`
- `invoices.customer_invoice_question_detected`
- `invoices.rut_status_changed`

## Media

- `media.uploaded`
- `media.required_media_missing`
- `media.cleaning_photo_uploaded`
- `media.damage_photo_uploaded`
- `media.media_review_required`

## Time Bank

- `time_bank.balance_changed`
- `time_bank.low_balance_detected`
- `time_bank.negative_balance_detected`
- `time_bank.manual_adjustment_requested`

## Agreements

- `agreements.created`
- `agreements.updated`
- `agreements.renewal_due_detected`
- `agreements.cancellation_requested`
- `agreements.price_change_required`

## Employees

- `employees.employee_created`
- `employees.employee_status_changed`
- `employees.availability_changed`
- `employees.absence_reported`
- `employees.shift_conflict_detected`

## Event use rule

Events are facts. They should not contain hidden business decisions.

Bad:

`customer_should_be_refunded`

Good:

`work_orders.quality_issue_detected`

The decision to refund is a policy/action/approval process, not a raw domain event.

## System and runtime safety events

Runtime safety events are facts about system behavior. They must not hide business decisions.

- `system.runtime.rate_limit_exceeded`
- `system.runtime.resource_quota_exceeded`
- `system.runtime.frontend_loop_detected`
- `system.runtime.retry_storm_detected`
- `system.runtime.realtime_reconnect_storm_detected`
- `system.runtime.circuit_breaker_opened`
- `system.runtime.circuit_breaker_half_opened`
- `system.runtime.circuit_breaker_closed`
- `system.runtime.feature_flag_changed`
- `system.runtime.kill_switch_activated`
- `system.runtime.module_health_degraded`
- `system.runtime.module_health_restored`
- `system.runtime.slow_query_detected`
- `system.runtime.background_job_backlog_detected`
- `system.runtime.ai_quota_exceeded`
- `system.runtime.ai_provider_failure_detected`
- `system.runtime.media_upload_limit_exceeded`
- `system.runtime.session_quarantined`
- `system.runtime.incident_created`
- `system.runtime.incident_resolved`

Bad:

`system_should_disable_schedule`

Good:

`system.runtime.schedule_error_rate_threshold_exceeded`

The decision to disable, limit, or recover the module is a guard action/policy decision, not the raw event itself.
