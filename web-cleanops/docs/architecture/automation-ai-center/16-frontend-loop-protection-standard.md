# Frontend Loop Protection Standard

## Status

Required engineering standard for every feature with data fetching, polling, realtime subscriptions, mutations, or retries.

## Purpose

Prevent frontend bugs from creating backend/database/API overload.

## Common loop causes

- incorrect `useEffect` dependency arrays
- state update triggers fetch, fetch triggers state update, repeat
- polling without cleanup
- polling with too short interval
- retry forever after an error
- repeated query invalidation
- duplicate realtime subscriptions
- websocket/realtime reconnect storms
- component remount creates duplicate requests
- submit button not disabled during mutation
- search/filter input fetches on every keystroke without debounce
- route transition starts new requests without aborting old requests

## Required protections

Every feature with network calls must consider:

- abort/cancel in-flight requests on unmount or parameter change
- bounded retry count
- retry backoff
- no retry on non-retryable 4xx errors
- submit locking for mutations
- debounce or throttle for search/filter input
- stable query keys
- no duplicate realtime subscriptions
- cleanup subscriptions on unmount/logout/company switch
- route-level request budget in development/test
- linked `RuntimeGuardPolicy` for loop-prone/heavy routes
- logging when abnormal request count is detected

## Polling requirements

Polling must define:

- reason for polling
- minimum interval
- maximum active duration
- pause behavior when tab is hidden
- cleanup behavior
- fallback when backend returns throttling/circuit-open response

## Mutation requirements

Every user-triggered mutation must have:

- disabled/loading state
- idempotency key where duplicate submission is possible
- duplicate submission suppression
- error boundary or controlled error state
- no automatic repeat without explicit retry policy

## Realtime requirements

Every realtime integration must have:

- stable channel key
- one subscription per intended scope
- cleanup on scope change
- reconnect cap
- incident/console warning on reconnect storm
- no hidden subscriptions inside deeply nested components unless documented

## Frontend abnormal activity signal

The frontend should be able to report an abnormal client pattern in development/test and later production. The report must be compatible with a central `RuntimeGuardPolicy`:

```text
module=schedule
route=/company/schedule
sessionId=...
requestCount=137
windowSeconds=60
endpoint=/api/schedule/range
component=ScheduleGrid
trigger=frontend_loop_detected
```

## Test requirements

For heavy components, test or manually verify:

- initial render does not issue duplicate requests
- changing filters does not create request storms
- leaving the page aborts/cleans requests
- failed request does not retry forever
- realtime subscription is not duplicated after navigation
- mutation cannot be double-submitted
- throttled response shows controlled UI message

## Code review blockers

Block merge if a feature contains:

- unbounded retry
- unbounded polling
- unbounded subscription creation
- unbounded list load
- mutation without duplicate-submit protection
- fetch in render path
- hidden background loop
- no cleanup on unmount for active listener/subscription
