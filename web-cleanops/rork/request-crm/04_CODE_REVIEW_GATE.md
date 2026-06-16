# Code Review Gate - REQUEST/CRM

A PR must not be accepted if it violates any item below.

## Architecture gate

- No hidden automation logic inside REQUEST.
- No notification rule engine implemented locally unless it is explicitly central-compatible and approved.
- No direct AI provider calls.
- No AI policy engine inside REQUEST screens.
- No production kill switch/rate limit/circuit breaker enforcement in Slice 0.
- No external customer/employee exposure unless explicitly in scope.

## Event/readiness gate

Every new feature must document:

- domain events emitted
- automation candidates
- risk levels
- audit events
- feature flags
- central Automation & AI Center references

## UI gate for Slice 0

- mock/static data only
- disabled live actions
- clear mock notices
- no destructive actions
- no real notifications/emails/messages sent

## Test gate

- Type/lint tests pass according to repo standards.
- Mock data is isolated.
- Feature flag default safe/off if applicable.
- No test data leakage path introduced.
