# 18 - Settings and Configuration

## First implementation rule

Start with a settings shell. Do not build a full rule builder.

## REQUEST settings shell owns

- request categories and subcategories
- hard-coded and admin-created request types
- status labels
- priority/severity labels
- SLA defaults per category/type
- owner/support routing defaults as metadata
- internal post types
- email policy labels
- visibility defaults
- local quick-review links to Automation & AI Center

## REQUEST settings shell must not own

- global automation registry
- hidden notification rules
- AI automation policy
- runtime guard policy
- kill switches
- circuit breaker policy
- rate limiting policy
- execution/incident source-of-truth

## Notification settings shell

Can show notification type labels and linked automation candidates. Automated creation rules must link to Automation & AI Center.

## AI settings shell

Can show AI mode/status badges and references to central AI extensions. REQUEST must not maintain a separate AI policy engine.

## UI expectation

Each settings section should display:

- local domain setting
- future/current Automation & AI Center link
- status: not connected | planned | registered | active | disabled
- risk level if centrally known
- Slice 0 mock data only
