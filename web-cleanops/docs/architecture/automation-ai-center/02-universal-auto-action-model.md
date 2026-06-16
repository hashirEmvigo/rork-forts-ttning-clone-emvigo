# Universal Auto-Action Model

## Goal

Every automation must follow the same model.

Do not implement a separate logic pattern for each event.

The calculator failure pattern must not repeat here: no separate special solution per oven, window, pet, bathroom, key, delay, complaint, runtime guard, kill switch, or AI decision.

## Core entity

`AutomationAction`

A registered auto-action is a developer-defined automation entry with stable metadata.

## Required fields

```ts
type AutomationAction = {
  id: string;
  key: string;
  name: string;
  description: string;
  module: AutomationModuleKey;
  ownerDomain: AutomationModuleKey;

  trigger: AutomationTriggerDefinition;
  conditions: AutomationConditionDefinition[];
  actions: AutomationActionStepDefinition[];

  status: AutomationActionStatus;
  riskLevel: AutomationRiskLevel;
  executionMode: AutomationExecutionMode;
  approvalPolicy: AutomationApprovalPolicy;

  supportsAi: boolean;
  aiEnabled: boolean;

  resourceProfile?: 'light' | 'medium' | 'heavy' | 'critical';
  safetyLimitKeys?: string[];
  runtimeGuardPolicyKeys?: string[];
  featureFlagKey?: string | null;
  circuitBreakerKey?: string | null;
  timeoutMs?: number | null;
  maxRetries?: number | null;

  version: number;
  tags: string[];
  latestRunAt?: string | null;
  createdAt: string;
  updatedAt: string;
};
```

## Stable action key format

Use dot notation.

Pattern:

`{module}.{domain_area}.{event_or_action}`

Examples:

- `schedule.delay.impact_detected`
- `schedule.delay.employee_confirmation_requested`
- `cases.sla.unhandled_case_risk`
- `chat.message.complaint_detected`
- `keys.access.missing_alarm_code`
- `customer.profile.missing_cleaning_protocol`
- `invoices.payment.overdue_detected`

Keys must be stable. Do not rename keys after production use without migration/version handling.

## Modules

Allowed initial module keys:

- `schedule`
- `cases`
- `chat`
- `notifications`
- `keys_alarm`
- `customer_card`
- `work_orders`
- `invoices`
- `media`
- `time_bank`
- `agreements`
- `employees`
- `system`

## Action status

```ts
type AutomationActionStatus =
  | 'draft'
  | 'planned'
  | 'active'
  | 'disabled'
  | 'deprecated';
```

## Risk level

```ts
type AutomationRiskLevel = 'low' | 'medium' | 'high' | 'critical';
```

Risk can be business risk and/or operational runtime risk.

Examples:

- internal log: `low`
- ETA notification: `medium`
- negative customer impact: `high`
- financial/access/salary/delete action or platform-wide runtime risk: `critical`

## Execution mode

```ts
type AutomationExecutionMode =
  | 'observe_only'
  | 'auto_execute_with_log'
  | 'auto_execute_with_notification'
  | 'requires_admin_review'
  | 'requires_company_admin_approval'
  | 'requires_super_admin_approval'
  | 'blocked';
```

## Trigger definition

A trigger describes what starts evaluation.

```ts
type AutomationTriggerDefinition = {
  type: 'domain_event' | 'scheduled_check' | 'manual_test' | 'state_change' | 'webhook' | 'system_health';
  eventKey?: string;
  schedule?: string;
  sourceEntityTypes: string[];
};
```

Examples:

- domain event: `schedule.employee_late_detected`
- scheduled check: every 15 minutes for unresolved cases
- state change: `case.status` from `open` to `pending_customer`
- system health: `system.runtime.frontend_loop_detected`

## Condition definition

Conditions define when the automation applies.

```ts
type AutomationConditionDefinition = {
  key: string;
  description: string;
  type:
    | 'threshold'
    | 'boolean'
    | 'state_match'
    | 'time_window'
    | 'customer_preference'
    | 'data_missing'
    | 'custom_domain_check';
  config: Record<string, unknown>;
};
```

Conditions must be inspectable. If a condition requires domain logic, the condition can call a domain-owned function, but the condition must still be represented centrally.

## Action step definition

```ts
type AutomationActionStepDefinition = {
  key: string;
  description: string;
  type:
    | 'create_log'
    | 'create_notification'
    | 'update_estimate'
    | 'create_case'
    | 'update_status'
    | 'send_customer_app_notification'
    | 'create_approval_request'
    | 'create_ai_proposal'
    | 'call_domain_service'
    | 'apply_runtime_guard'
    | 'no_op';
  target:
    | 'internal'
    | 'customer'
    | 'employee'
    | 'admin'
    | 'domain_service'
    | 'ai_extension'
    | 'runtime_guard';
  config: Record<string, unknown>;
};
```

Runtime guard action steps must reference central `RuntimeGuardPolicy` or `RuntimeSafetyLimit` metadata. Do not add hidden guard behavior directly inside a module component.

## Execution states

Each automation run must have an execution record.

```ts
type AutomationExecutionStatus =
  | 'detected'
  | 'evaluating'
  | 'skipped'
  | 'pending_approval'
  | 'proposed'
  | 'executed'
  | 'failed'
  | 'cancelled'
  | 'rate_limited'
  | 'blocked_by_guard'
  | 'circuit_open'
  | 'timed_out';
```

## Execution record

```ts
type AutomationExecution = {
  id: string;
  actionKey: string;
  actionVersion: number;
  status: AutomationExecutionStatus;

  sourceEventKey?: string;
  sourceEntityType: string;
  sourceEntityId: string;

  triggerPayload: Record<string, unknown>;
  conditionResults: Array<Record<string, unknown>>;
  resultPayload?: Record<string, unknown> | null;

  riskLevel: AutomationRiskLevel;
  approvalRequired: boolean;
  aiUsed: boolean;

  guardAction?: RuntimeGuardActionType | null;
  runtimeIncidentId?: string | null;
  durationMs?: number | null;

  startedAt: string;
  completedAt?: string | null;
  errorMessage?: string | null;
};
```

## Canonical automation lifecycle

```text
Trigger
  -> Condition evaluation
  -> Risk level and policy lookup
  -> Runtime guard lookup when action is heavy/sensitive
  -> Execute / skip / require approval / create AI proposal / throttle / block
  -> Execution log
  -> Runtime incident if guard or abnormal failure occurs
  -> Optional module quick review
  -> Optional alert/follow-up
  -> Resolution when incident/review is closed
```

## Idempotency

Automations must be idempotent wherever they can run more than once.

Required idempotency inputs:

- action key
- source event id
- source entity id
- relevant time window
- action version

Example:

Do not send the same ETA delay notification to the same customer repeatedly for the same delay event unless a material update occurs.

## Versioning

AutomationAction must have a version.

Execution records must store the action version used at runtime.

If a future implementation changes conditions/actions, increment version.

## No hidden execution

If code performs an automation-relevant behavior, it must be represented in the registry.

Invalid implementation:

```text
In Schedule page component: if late, send customer notification directly.
```

Valid pattern:

```text
Schedule domain detects delay event.
Automation action registry evaluates schedule.delay.impact_detected.
Runtime guard policy suppresses duplicate customer notifications if needed.
Domain Schedule service updates ETA.
Automation execution is logged.
Customer notification action is recorded.
```

## Runtime safety extension rules

An AutomationAction must reference runtime safety metadata when it can consume meaningful resources or trigger downstream effects.

Rules:

- heavy actions must have a safety limit or runtime guard policy
- AI-enabled actions must have AI request/token budgets
- customer-facing notification actions must have duplicate suppression
- export/report/bulk actions must be queued or concurrency-limited
- failed or repeated executions must be visible in execution log or runtime incidents
- guard behavior must never be hidden in module-specific one-off code

## Relationship to RuntimeGuardPolicy

`RuntimeGuardPolicy` is the canonical model for runtime safety controls.

An AutomationAction may link to guard policies through:

- `runtimeGuardPolicyKeys`
- `safetyLimitKeys`
- `featureFlagKey`
- `circuitBreakerKey`

The runtime guard lifecycle is defined in:

`19-runtime-guard-canonical-model.md`

## Minimal first implementation

In Slice 1, this model is represented through TypeScript types and mock data only.

Do not build the live execution pipeline in Slice 1.

Do not build live runtime guard enforcement in Slice 1.
