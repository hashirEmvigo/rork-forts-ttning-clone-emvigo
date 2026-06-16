# PR Description Template - Automation & AI Center Relevant Work

## Summary

Describe what changed.

## Automation & AI Center readiness

### Domain events

List events or state transitions.

### Automation candidates

List future or current auto-actions.

### AI-extension candidates

List possible AI summaries, suggestions, drafts, or approval preparation.

### Risk level

Low / Medium / High / Critical with reason.

### Approval requirements

Describe approval behavior.

### Quick review impact

Does the source module need a local quick review view?

### Central discoverability

Where will the action/config/log be visible centrally?

### Hidden automation logic

Confirm none was added.

## Runtime Safety & Performance

### Heavy routes/endpoints

List affected routes/endpoints.

### Data limits

Describe pagination, max rows, selected fields, and large relation behavior.

### Rate limits/quotas

Describe per-session/user/company/module/endpoint limits or why not applicable.

### Runtime guard policies

List guard policy keys or planned guard policies using Trigger -> Condition -> Risk level -> Guard action -> Runtime flag -> Execution/incident log -> Alert/follow-up -> Resolution.

### Timeout/retry policy

Describe timeout and retry behavior.

### Frontend loop protection

Describe debounce, abort, cleanup, submit locking, polling cleanup, and subscription cleanup.

### Kill switch / limited mode

Describe feature flag, read-only mode, limited mode, or why not applicable.

### Runtime incident/logging path

Describe what is logged if abnormal behavior occurs.

### Alert/follow-up and resolution

Describe alert targets, follow-up owner, resolution notes, rollback path, and regression/performance evidence.

### Performance budget/test evidence

Include load/flow/manual evidence where relevant.

### Hidden unbounded behavior

Confirm none was added.

## Tests

List tests or manual verification.

## Explicitly not implemented

List intentionally deferred behavior.
