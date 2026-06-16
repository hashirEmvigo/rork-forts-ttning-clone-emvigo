# Runtime Safety and Performance Guard

## Status

Architecture standard. Slice 1 is mock-data visibility only. Production enforcement is deferred until repository inspection and explicit approval.

## Purpose

Protect the platform from runaway user sessions, request loops, retry storms, slow queries, overloaded modules, heavy jobs, failing dependencies, and accidental resource exhaustion.

The goal is controlled degradation:

```text
One user, session, feature, endpoint, job, or module may be limited or disabled.
The rest of the platform must continue operating.
```

## Problem pattern to prevent

The old-system failure pattern is:

```text
A user hits an unusual bug.
A component starts looping.
The loop sends repeated requests.
Requests consume backend/database resources.
The whole system slows down or goes down.
The IT team lacks fast visibility into what happened.
```

The new-system pattern must be:

```text
A user hits an unusual bug.
The system detects abnormal request/error/retry behavior.
The session, endpoint, or feature is throttled or limited.
A controlled error message is shown.
A runtime incident is created.
The IT/dev team sees user, company, route, endpoint, module, release, request count, errors, and trace reference.
Other users continue working.
```

## Ownership model

Automation & AI Center owns the control-plane representation:

- safety limit registry
- runtime guard policy registry
- feature runtime flags
- kill switch state visibility
- incident log visibility
- module health status
- performance budget status
- guard policy documentation
- review and follow-up workflow

Enforcement may live in:

- CDN/WAF layer
- API layer
- Supabase Edge Functions
- application service layer
- background job runner
- Postgres functions/policies
- realtime/subscription layer
- frontend hooks/components

No enforcement layer may become invisible from the control plane.

## Guard scopes

A guard policy may apply to any of these scopes:

- `session`
- `user`
- `company`
- `role`
- `module`
- `route`
- `endpoint`
- `automation_action`
- `background_job`
- `ai_assistant`
- `public_surface`
- `system`

## Guard triggers

A guard may trigger on:

- rate limit exceeded
- resource quota exceeded
- concurrent request limit exceeded
- retry limit exceeded
- frontend loop detected
- polling frequency exceeded
- realtime subscription count exceeded
- timeout threshold exceeded
- error rate threshold exceeded
- p95/p99 latency threshold exceeded
- database slow-query threshold exceeded
- AI token/request budget exceeded
- upload size/count exceeded
- circuit breaker opened
- dependency health check failed
- manual kill switch activated

## Guard actions

Possible guard actions:

- `log_only`
- `throttle`
- `limit_data`
- `set_read_only`
- `disable_feature`
- `open_circuit`
- `quarantine_session`
- `block_request`
- `create_incident`
- `notify_it_team`
- `notify_super_admin`
- `require_manual_review`
- `fallback_to_cached_or_empty_state`

## Runtime states

Feature/module/session runtime states:

- `enabled`
- `limited_mode`
- `read_only`
- `admin_only`
- `maintenance_mode`
- `disabled`
- `quarantined`

## Core entities

### RuntimeGuardPolicy

Defines the canonical Trigger -> Condition -> Risk level -> Guard action -> Runtime flag -> Execution/incident log -> Alert/follow-up -> Resolution model for a safety control.

### RuntimeSafetyLimit

Defines request, quota, concurrency, timeout, retry, and resource limits.

### FeatureRuntimeFlag

Defines runtime availability for a feature/module/action.

### RuntimeIncident

Records a triggered guard, abnormal behavior, or production safety event.

### UserSessionLimit

Represents temporary session quarantine or limitation.

### ModuleHealth

Summarizes whether a module is healthy, degraded, limited, unhealthy, disabled, or under maintenance.

### PerformanceBudget

Defines expected latency, error rate, bundle, request count, query count, or resource usage limits.

## Required incident correlation

Every runtime guard event should preserve or create a correlation id.

At minimum, store:

- incident id
- timestamp
- severity
- module
- route
- endpoint
- user id if available
- company id if available
- session id if available
- source action key if automation-related
- trigger type
- guard action
- request count or error count
- latency if relevant
- release/version if available
- trace/log reference if available

## User-facing behavior

The user must see a controlled message, not a crash or endless loader.

Recommended customer/admin-safe message:

```text
Something went wrong and this action has been temporarily stopped to protect the system. Our team has been notified. Please try again later.
```

For Swedish customer-facing UI:

```text
Nagot gick fel och atgarden har tillfalligt stoppats for att skydda systemet. Vart team har notifierats. Forsok igen senare.
```

If the user is an admin, optionally include:

```text
Incident ID: INC-2026-000142
```

## Slice 1 behavior

Slice 1 must not enforce real runtime safety behavior.

Slice 1 may display:

- mock runtime guard policies
- mock runtime limits
- mock incidents
- mock feature flags
- mock module health
- mock performance budgets
- non-live warnings

The purpose is architectural clarity, not production enforcement.
