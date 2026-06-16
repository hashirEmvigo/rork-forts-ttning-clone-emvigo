# Testing and QA Standard

## Slice 1 front-end shell tests

Minimum checks:

- route loads
- navigation entry appears in correct Super Admin context
- all required tabs/sections render
- mock auto-actions table renders
- filters work on mock data
- action detail opens
- module coverage renders all required modules
- runtime guard policies mock table renders
- approval queue placeholder renders
- execution log placeholder renders
- empty states render
- responsive layout follows existing repo conventions
- no production domain mutations are introduced

## Automation-readiness tests for future modules

For every new feature:

- domain events or state transitions are documented
- no hidden special-case automation is added
- risk conditions are identified
- approval candidates are identified
- future AI-extension candidates are identified
- quick review candidates are identified

## Future engine tests

When the real engine is built later:

- trigger matching tests
- condition evaluation tests
- idempotency tests
- approval requirement tests
- execution log tests
- failed execution tests
- duplicate notification suppression tests
- audit trail tests
- AI proposal tests
- prompt version tracking tests

## Regression test focus

The most important regression risk is hidden special-case logic.

Code review should search for:

- direct customer notification sending in domain UI components
- direct schedule/invoice/customer mutations from automation UI
- AI provider calls outside AI extension pipeline
- hardcoded action behavior not represented in action registry
- one-off booleans that should be status/risk/policy fields

## Manual QA scenarios for Slice 1

1. Open Automation & AI Center.
2. Confirm dashboard cards match mock data totals.
3. Filter by Schedule.
4. Open `schedule.delay.impact_detected` detail.
5. Confirm trigger, conditions, actions, risk, policy, AI extension, and logs are visible.
6. Filter by High risk.
7. Confirm approval-related items are easy to identify.
8. Open Module Coverage and confirm all major modules are listed.
9. Confirm the UI does not imply real live execution if using mock data.
10. Confirm there is no route or UI that lets admin build arbitrary no-code rules.

## Runtime safety and performance tests

For heavy features, QA must include safety behavior:

- repeated API calls are throttled or logged
- failed requests do not retry forever
- polling stops on unmount
- realtime subscriptions are cleaned up
- duplicate form submits are prevented
- large list loads are paginated or bounded
- exports are queued or concurrency-limited
- AI requests have timeout and quota behavior
- controlled error messages are shown
- runtime incidents can be created and inspected in future live implementation; Slice 1 only renders mock incidents
- module can enter limited/read-only/disabled mode if required by policy

## Performance regression tests

Every heavy feature should have a repeatable baseline:

- route load timing
- number of initial API calls
- p95 endpoint latency under test load
- error rate under test load
- database query observations
- first bottleneck found

## Release-blocking performance failures

Block release if:

- a page creates unintended duplicate initial requests
- a list loads unbounded rows
- a retry loop can continue indefinitely
- a polling loop continues after navigation away
- a mutation can be repeatedly submitted
- a heavy operation has no timeout
- performance test shows known severe degradation with no accepted mitigation
