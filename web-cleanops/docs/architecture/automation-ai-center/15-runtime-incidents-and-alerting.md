# Runtime Incidents and Alerting

## Status

Architecture standard. Slice 1 uses mock data only.

## Purpose

Give IT/dev team fast visibility when a function, user session, endpoint, module, automation, AI action, or dependency starts behaving abnormally.

## Incident definition

A runtime incident is created when the system detects abnormal or dangerous behavior, usually through a registered `RuntimeGuardPolicy`, such as:

- frontend request loop
- retry storm
- rate limit exceeded
- resource quota exceeded
- endpoint error spike
- circuit breaker opened
- feature kill switch activated
- slow query pattern
- AI provider failure
- upload failure spike
- automation execution failure spike
- background job backlog
- module health degradation

## Severity levels

| Severity | Meaning | Example |
|---|---|---|
| `info` | guard acted normally, no user impact | single session throttle |
| `warning` | limited user/company/module impact | repeated endpoint errors for one company |
| `high` | active feature degradation or repeated failures | schedule read endpoint circuit open |
| `critical` | platform-level or sensitive operation risk | database saturation, payment mutation failure, access/security risk |

## Required incident fields

```ts
RuntimeIncident = {
  id,
  severity,
  status,
  title,
  description,
  module,
  route,
  endpoint,
  companyId,
  userId,
  sessionId,
  actionKey,
  triggerType,
  guardAction,
  requestCount,
  errorCount,
  latencyMs,
  startedAt,
  lastSeenAt,
  resolvedAt,
  correlationId,
  traceRef,
  releaseVersion,
  assignedTo,
  resolutionNotes
}
```

## Incident lifecycle

```text
Detected
  -> Guard action applied
  -> Incident created or existing incident updated
  -> Alert routed if threshold requires it
  -> Developer/admin acknowledges
  -> Mitigation applied
  -> Root cause reviewed
  -> Resolution recorded
  -> Regression test or guard adjustment added if needed
```

## Incident statuses

- `open`
- `acknowledged`
- `investigating`
- `mitigated`
- `resolved`
- `false_positive`

## Alert routing

Initial recommendation:

- `info`: log only
- `warning`: visible in Automation & AI Center dashboard
- `high`: notify IT/dev channel
- `critical`: notify IT/dev and Super Admin/on-call path if such process exists

## What IT/dev must see quickly

- What happened?
- Which user/session/company was involved?
- Which module/route/endpoint?
- Which release/version?
- How many requests/errors?
- When did it start?
- Is it still happening?
- Which runtime guard policy applied?
- What guard action was applied?
- Did any other user/company get affected?
- What trace/log/session replay reference exists?
- What feature flag or circuit breaker changed?

## Developer follow-up requirements

Every high/critical incident should produce one of:

- bug fix
- test case
- performance test
- new guard rule
- adjusted limit
- query/index optimization
- documentation update
- accepted no-action reason with approval

## Canonical linkage

Runtime incidents should link back to:

- `RuntimeGuardPolicy.key` when applicable
- `RuntimeSafetyLimit.key` when applicable
- feature runtime flag key when state changed
- circuit breaker key when opened/closed
- automation action key when automation-related
- performance budget key when budget failure triggered the incident

## Customer/admin messaging

The message must be controlled and non-technical unless the user is a technical admin.

Recommended generic message:

```text
This action was temporarily stopped to protect the system. Our team has been notified. Please try again later.
```

Admin variant:

```text
This function has been temporarily limited due to abnormal activity. Incident ID: {incidentId}.
```
