# AI Extension Model

## Core principle

AI actions must attach to registered auto-actions.

No standalone AI action may exist without a parent AutomationAction.

## Why

AI must be governed by the same structure as deterministic automation:

- source action
- module
- trigger
- conditions
- risk level
- approval policy
- execution history
- auditability
- enabled/disabled state

This prevents invisible AI behavior across the product.

## AI extension entity

```ts
type AiActionExtension = {
  id: string;
  automationActionKey: string;
  assistantKey: string;
  aiMode: AiMode;
  allowedOutputs: AiAllowedOutput[];
  requiredContext: AiContextRequirement[];
  approvalPolicy: AutomationApprovalPolicy;
  enabled: boolean;
  modelConfigKey?: string;
  promptVersion?: string;
  createdAt: string;
  updatedAt: string;
};
```

## AI modes

```ts
type AiMode =
  | 'none'
  | 'summarize_only'
  | 'suggest_only'
  | 'draft_only'
  | 'prepare_approval'
  | 'limited_auto_execute';
```

## Allowed outputs

```ts
type AiAllowedOutput =
  | 'summary'
  | 'risk_assessment'
  | 'recommended_next_step'
  | 'customer_message_draft'
  | 'employee_message_draft'
  | 'admin_note'
  | 'case_creation_proposal'
  | 'schedule_solution_proposal'
  | 'approval_request_payload'
  | 'classification';
```

## Context requirements

```ts
type AiContextRequirement = {
  source: 'schedule' | 'cases' | 'chat' | 'keys_alarm' | 'customer_card' | 'work_orders' | 'invoices' | 'employees' | 'system';
  fields: string[];
  required: boolean;
  piiRisk: 'none' | 'low' | 'medium' | 'high';
};
```

## Permission levels

AI may:

- read allowed context
- summarize
- classify
- propose
- draft
- prepare approval item

AI must not directly:

- permanently change booking time
- delete data
- change invoices or payment status
- change salary/time-reporting data
- blame or penalize employees
- send sensitive customer communication without policy approval
- mutate domain data outside approved domain services

## AI output structure

AI output must be structured, not free-form only.

Example:

```json
{
  "summary": "Team A is likely to arrive 15 minutes late to the next assignment.",
  "riskLevel": "medium",
  "recommendedNextStep": "Notify admin and prepare customer message draft.",
  "customerMessageDraft": "We currently estimate arrival approximately 15 minutes later than planned.",
  "requiresApproval": true,
  "confidence": 0.82,
  "references": [
    { "type": "work_order", "id": "wo_123" },
    { "type": "schedule_event", "id": "evt_456" }
  ]
}
```

## AI proposal lifecycle

```text
Automation execution detects condition
  -> AI extension eligible
  -> AI receives approved context
  -> AI returns structured proposal
  -> proposal stored
  -> approval queue item created if required
  -> admin approves/rejects/edits
  -> domain service executes approved action
  -> audit log records result
```

## AI audit requirements

Every AI proposal must log:

- parent automation action key
- parent execution id
- assistant key
- AI mode
- prompt version
- context references, not full unbounded raw context unless permitted
- structured output
- approval requirement
- admin decision
- final action taken

## Example: Schedule delay

Parent auto-action:

`schedule.delay.negative_customer_impact_detected`

AI extension:

- summarize impact
- suggest schedule solution
- draft customer message
- prepare approval request

Execution mode:

`requires_admin_review`

AI must not directly reschedule or contact customer in the initial version.

## Example: Case complaint

Parent auto-action:

`chat.message.complaint_detected`

AI extension:

- classify complaint category
- summarize message history
- recommend priority
- draft internal case note
- draft customer response

Approval:

Customer response requires admin approval.

## No AI in Slice 1

Slice 1 only displays AI extension metadata and mock states.

No provider calls.
No model integration.
No prompt execution.
No real AI actions.

## AI runtime safety requirements

AI features must have explicit runtime protection.

Every AI extension must define or reference:

- request limit
- token budget
- timeout
- retry policy
- provider circuit breaker
- fallback behavior
- incident logging behavior
- approval behavior for generated output

AI must not be allowed to loop, recursively call itself, repeatedly re-draft without user action, or keep retrying provider calls without a hard stop.

If an AI provider fails repeatedly, the AI feature must enter limited mode or open circuit while non-AI parts of the product continue operating.
