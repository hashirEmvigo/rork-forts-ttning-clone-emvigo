# Settings and Tenant Configuration Architecture - Price Calculator

**Audience:** RORK / GPT-5.5 High  
**Project:** CleanOps / Stadportalen / Price Calculator  
**Instruction level:** Treat this as implementation guidance for repository analysis, architecture validation, and phased build planning. The human project owner does not need explanatory simplification. Be precise, conservative, and repo-grounded.

---
## Objective

Company admins must be able to configure their own calculator without code changes.

## Required settings categories

### Calculator general settings

- Enabled/disabled.
- Public calculator slug or embed key.
- Show price directly or only after contact details.
- Show exact price or price range.
- Quote validity period.
- Manual review threshold.
- Default currency.
- Tax/RUT display mode.

### Service settings

For each supported service:

- Enabled/disabled.
- Display name.
- Description.
- Input questions enabled.
- Required fields.
- Pricing model.
- Add-ons.
- Manual review rules.

### Cleaning plan settings

Cleaning plans are operational pricing plans.

Fields:

- `name`
- `description`
- `hourly_rate`
- `is_default`
- `flexibility_level`
- `customer_day_time_control`
- `same_staff_preference_level`
- `booking_priority`
- `cancellation_terms_summary`
- `active`
- `sort_order`

### Content settings

- FAQ items.
- Helper text.
- CTA labels.
- Quote-created message.
- Contact/help text.

## Default configuration

The system should ship default settings for fast onboarding. Company admins can override.

## Permissions

- Super admin can define global defaults and inspect company settings.
- Company admin can configure their own calculator.
- Staff should not edit pricing settings unless existing permission model explicitly allows it.

## Implementation note

Use existing settings architecture and permission patterns. Do not create a separate settings subsystem if the app already has a settings convention.
