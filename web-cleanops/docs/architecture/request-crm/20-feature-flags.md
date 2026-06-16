# 20 - Feature Flags and Environment Strategy

## Candidate flags

- enable_request_platform
- enable_request_manager
- enable_notification_center
- enable_chat
- enable_ai_mock
- enable_ai_provider_openai
- enable_ai_suggestion_mode
- enable_ai_auto_create_request
- enable_email_outbound
- enable_email_inbound_reply
- enable_request_snooze
- enable_request_handle_self
- enable_locked_requests
- enable_emergency_popup
- enable_test_mode
- enable_request_crm_frontend_shell
- enable_request_crm_settings_shell
- enable_request_crm_automation_quick_review

## Flag scope

Feature flags should support environment, tenant and role scoping where relevant.

## Safety

New automatic actions must be disableable without deploy. In the global model this should be represented as runtime flags/kill switches in Automation & AI Center.

Slice 0 must not implement production runtime flag enforcement. It may render static/mock flag state.
