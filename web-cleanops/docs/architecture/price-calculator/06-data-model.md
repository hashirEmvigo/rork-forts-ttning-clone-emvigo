# Data Model - Price Calculator

**Audience:** RORK / GPT-5.5 High  
**Project:** CleanOps / Stadportalen / Price Calculator  
**Instruction level:** Treat this as implementation guidance for repository analysis, architecture validation, and phased build planning. The human project owner does not need explanatory simplification. Be precise, conservative, and repo-grounded.

---
## Purpose

This is the target data model. RORK must map this to the existing schema before proposing migrations.

## Tables / entities

### `calculator_settings`

Company-level calculator behavior.

Fields:

- `id`
- `company_id`
- `enabled`
- `public_slug`
- `embed_key`
- `show_price_before_contact_details`
- `price_display_mode` (`exact`, `range`, `hidden_until_submit`)
- `quote_validity_days`
- `manual_review_threshold_amount`
- `currency`
- `rut_display_mode`
- `created_at`
- `updated_at`

### `calculator_services`

Enabled services and service-level configuration.

Fields:

- `id`
- `company_id`
- `service_key`
- `display_name`
- `description`
- `enabled`
- `pricing_model`
- `sort_order`
- `settings_json`
- `created_at`
- `updated_at`

### `calculator_questions`

Dynamic questions per service.

Fields:

- `id`
- `company_id`
- `calculator_service_id`
- `question_key`
- `label`
- `help_text`
- `input_type`
- `required`
- `options_json`
- `validation_json`
- `sort_order`
- `active`

### `cleaning_plans`

Operational pricing plans with hourly rates.

Fields:

- `id`
- `company_id`
- `name`
- `description`
- `hourly_rate`
- `flexibility_level`
- `customer_day_time_control`
- `same_staff_preference_level`
- `booking_priority`
- `cancellation_terms_summary`
- `is_default`
- `active`
- `sort_order`
- `created_at`
- `updated_at`

### `pricing_rules`

Configurable pricing values and add-ons.

Fields:

- `id`
- `company_id`
- `calculator_service_id`
- `rule_key`
- `rule_type`
- `value_numeric`
- `value_json`
- `condition_json`
- `active`
- `sort_order`
- `created_at`
- `updated_at`

### `quote_requests`

Submitted quote request.

Fields:

- `id`
- `company_id`
- `prospect_id` or `customer_id`
- `user_id` if applicable
- `calculator_service_id`
- `selected_cleaning_plan_id`
- `status`
- `source`
- `source_url`
- `customer_email`
- `customer_phone`
- `customer_name`
- `address_json`
- `estimated_hours`
- `calculated_price`
- `min_price`
- `max_price`
- `currency`
- `pricing_snapshot_json`
- `valid_until`
- `requires_manual_review`
- `created_at`
- `updated_at`

### `quote_request_answers`

Answer snapshots.

Fields:

- `id`
- `quote_request_id`
- `question_key`
- `question_label_snapshot`
- `answer_value_json`
- `created_at`

## Existing model integration

RORK must inspect whether existing tables already cover customers, prospects, services, quotes, or requests.

If existing concepts exist, prefer extending or mapping rather than duplicating.

## Snapshot rule

Quote requests must snapshot:

- selected plan name and hourly rate.
- pricing rule values.
- question labels and answers.
- calculated totals.

This prevents historical quotes from changing when settings are later edited.
