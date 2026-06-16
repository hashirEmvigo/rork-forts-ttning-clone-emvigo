# Performance Testing Standard

## Status

Required standard before heavy modules are considered production-ready.

## Purpose

Measure how many realistic users and workflows the system can handle, and identify which feature fails first under load.

The question is not only:

```text
How many users can the system handle?
```

The better question is:

```text
Which exact user flow, module, endpoint, query, or frontend page becomes slow or unsafe first?
```

## Test layers

### Frontend performance

Measure:

- route load time
- time to usable UI
- route JS size
- number of API calls on initial load
- render cost for large lists/tables
- filter/search behavior
- repeated navigation behavior

Recommended tool family:

- Lighthouse CI or equivalent for budgets
- WebPageTest or equivalent for public-page real-world testing
- Playwright or equivalent for measured user flows

### API/load testing

Measure:

- requests per second
- concurrent users
- p50/p95/p99 latency
- error rate
- timeout rate
- rate-limit behavior
- circuit-breaker behavior
- recovery behavior

Recommended tool family:

- k6 or equivalent for scripted load, stress, spike, and soak tests
- Artillery/Locust/JMeter equivalents are acceptable if the team standardizes on them

### Database performance

Measure:

- slow queries
- missing indexes
- large scans
- RLS policy cost
- row counts returned
- relation expansion
- pagination behavior
- query performance under realistic data volume

### Production observability

Measure:

- real user route timings
- frontend errors
- backend errors
- endpoint latency
- slow queries
- incident frequency
- module health
- user/company/module traffic patterns

## Required test types

| Test type | Purpose |
|---|---|
| Smoke | verify system behaves under tiny load |
| Load | expected normal traffic |
| Stress | push until failure point is identified |
| Spike | sudden traffic increase |
| Soak | long-run stability and memory/resource issues |
| Regression | prevent performance degradation after changes |

## Initial realistic flow groups

Start with these flows:

- Super Admin opens Automation & AI Center
- Company Admin opens dashboard
- Company Admin opens Booking List
- Company Admin opens Schedule
- Company Admin opens Customer Card
- Company Admin opens Work Orders
- Company Admin opens Invoices
- Employee opens daily assignments
- Customer opens customer portal/app
- Public user uses pricing calculator
- Admin uses AI/chat assistant if enabled
- Media upload flow

## Initial performance budget examples

These are not final promises. They are initial engineering targets to calibrate.

| Area | Initial target |
|---|---|
| Standard API p95 | <= 500 ms after warm baseline |
| Heavy API p95 | <= 1500 ms after warm baseline |
| Error rate during normal load | <= 1% |
| Frontend duplicate initial requests | zero unintended duplicates |
| List data | paginated or bounded |
| Exports | queued or concurrency-limited |
| AI requests | budgeted and timeout-limited |
| Realtime subscriptions | capped and cleaned up |

## Required reporting

Every performance test report should include:

- date/time
- environment
- data volume
- test script version
- user mix
- target modules/routes/endpoints
- p50/p95/p99 latency
- error rate
- throughput
- database observations
- frontend observations
- first bottleneck found
- recommended fix
- whether limits/circuit breakers/runtime guard policies behaved correctly

## Release rule

A heavy feature may not be considered production-ready unless it has:

- clear performance budget
- load or flow test evidence
- runtime safety limits
- runtime guard policy where relevant
- timeout/retry policy
- observability/incident path
- rollback or kill switch path
