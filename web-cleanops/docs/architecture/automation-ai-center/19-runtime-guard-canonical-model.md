# Runtime Guard Canonical Model

## Status

Architecture standard. Slice 1 is mock-data visibility only. Production enforcement is deferred until repository inspection, implementation planning, and explicit approval.

## Purpose

Runtime safety must follow the same universal pattern as deterministic automation and AI extensions.

A runtime guard is not a hidden module-specific exception. It is a registered, inspectable policy that connects an abnormal technical signal to a bounded guard action, a runtime state, logs/incidents, alerts/follow-up, and resolution.

## Canonical lifecycle

Every runtime guard policy must be representable through this lifecycle:

```text
Trigger
  -> Condition evaluation
  -> Risk level classification
  -> Guard action selection
  -> Runtime flag / circuit / limited-mode state update when applicable
  -> Execution log and/or runtime incident record
  -> Alert / follow-up task when threshold requires it
  -> Resolution / rollback / regression evidence
```

This lifecycle applies to rate limits, resource quotas, frontend loop protection, circuit breakers, kill switches, limited mode, read-only mode, AI budgets, exports, uploads, background jobs, and public-surface abuse controls.

## Required model fields

```ts
type RuntimeGuardPolicy = {
  id: string;
  key: string;
  name: string;
  description: string;

  module?: AutomationModuleKey | null;
  scope: RuntimeGuardScope;
  triggerType: RuntimeGuardTriggerType;

  conditions: AutomationConditionDefinition[];
  riskLevel: AutomationRiskLevel;

  guardActions: RuntimeGuardActionType[];

  safetyLimitKeys: string[];
  runtimeFlagKey?: string | null;
  circuitBreakerKey?: string | null;

  incidentPolicy: {
    createIncident: boolean;
    updateExisting: boolean;
    dedupeWindowSeconds?: number | null;
    severity: RuntimeIncidentSeverity;
  };

  alertPolicy: {
    alertTargets: string[];
    alertOnSeverities: RuntimeIncidentSeverity[];
    createFollowUpTask: boolean;
    followUpOwner?: string | null;
  };

  resolutionPolicy: {
    requiredForSeverities: RuntimeIncidentSeverity[];
    requiresResolutionNotes: boolean;
    requiresRegressionCheck: boolean;
    rollbackPlanRequired: boolean;
  };

  status: RuntimePolicyStatus;
  createdAt: string;
  updatedAt: string;
};
```

## Field mapping to the required architecture model

| Required concept | Canonical field/source |
|---|---|
| Trigger | `triggerType`, domain/runtime event, route, endpoint, action key, or job signal |
| Condition | `conditions[]`, `RuntimeSafetyLimit`, quota threshold, error/latency/retry counters |
| Risk level | `riskLevel` and incident `severity` |
| Guard action | `guardActions[]` and applied `RuntimeGuardActionType` |
| Runtime flag | `runtimeFlagKey`, feature state, circuit breaker key, module runtime state |
| Execution/incident log | `AutomationExecution`, `RuntimeIncident`, trace/log reference, correlation id |
| Alert/follow-up | `alertPolicy`, assigned owner, incident status, follow-up task |
| Resolution | `resolutionPolicy`, `resolvedAt`, `resolutionNotes`, regression/performance evidence |

## Source-of-truth rule

Automation & AI Center is the source of truth for guard policy visibility, runtime flag state, incident history, module health, and follow-up status.

Implementation may still live in the correct technical layer:

- CDN/WAF
- API layer
- Supabase Edge Functions
- app/domain services
- Postgres functions/policies
- background workers
- realtime/subscription layer
- frontend hooks/components

However, the policy, state, incident, and follow-up must be centrally discoverable.

## No special-case guard logic

Invalid pattern:

```text
BookingList component locally counts requests and silently disables itself with an unregistered boolean.
```

Valid pattern:

```text
BookingList emits/report frontend_loop_detected or endpoint counters exceed threshold.
RuntimeGuardPolicy runtime.guard.booking_list_frontend_loop evaluates conditions.
Guard action throttles/quarantines the session.
Feature runtime flag for booking list auto-refresh enters limited_mode if needed.
Runtime incident is created/updated with correlation id.
Automation & AI Center displays policy, flag, incident, module health, and follow-up.
```

## Guard action rules

Guard actions must be least-disruptive first.

Recommended escalation order:

1. `log_only`
2. `throttle`
3. `limit_data`
4. `block_request`
5. `quarantine_session`
6. `set_read_only`
7. `open_circuit`
8. `disable_feature`
9. `notify_it_team` / `notify_super_admin`
10. `require_manual_review`

The chosen order may vary by risk and module sensitivity, but it must be explicit and logged.

## Runtime flag rules

A runtime flag or kill switch state change must include:

- feature key
- previous state
- new state
- actor or system guard
- reason
- timestamp
- linked incident id when relevant
- rollback/review path

Slice 1 must show these fields as mock/read-only data only.

## Incident and follow-up rules

High and critical guard events must create or update a runtime incident.

The incident must include enough data for a developer to diagnose the issue:

- module
- route
- endpoint
- user id if available
- company id if available
- session id if available
- trigger type
- guard action
- counters/latency/error counts
- release version
- correlation id
- trace/log reference
- assigned owner
- resolution notes when resolved

## Resolution rules

A guard incident is not resolved just because the symptom stopped.

Resolution must record one of:

- code fix
- test case
- adjusted limit
- adjusted query/index
- performance budget update
- kill switch rollback
- accepted no-action reason with approval

High/critical incidents require regression or performance evidence unless explicitly waived.

## Relationship to Auto Actions and AI Extensions

Runtime guards can attach to an AutomationAction through:

- `resourceProfile`
- `safetyLimitKeys`
- `runtimeGuardPolicyKeys`
- `featureFlagKey`
- `circuitBreakerKey`
- `timeoutMs`
- `maxRetries`

AI extensions must reference request/token budgets, timeout, retry policy, and provider circuit breaker when relevant.

## Slice 1 behavior

Slice 1 may render:

- runtime guard policies table
- linked runtime limits
- linked runtime flags
- linked incidents
- linked module health
- linked performance budgets
- non-live warning

Slice 1 must not enforce:

- production rate limits
- production kill switches
- production circuit breakers
- production alert routing
- live throttling
- live session quarantine
- live AI provider circuit breaking
