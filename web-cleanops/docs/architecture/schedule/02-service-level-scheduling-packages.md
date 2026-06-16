# Service Level Scheduling Packages Architecture

## Status

Draft v2 for technical review.

Phase 0 cleanup status: target architecture only. This document does not authorize code, migrations, schema changes, package enforcement or runtime behavior changes.

## Owner

Product / Scheduling / Customer Operations

## Review Target

RORK

## Related Documents

- `/docs/architecture/schedule/00-schedule-index.md`
- `/docs/architecture/schedule/01-schedule-module-architecture.md`
- `/docs/architecture/schedule/03-schedule-module-ux-architecture.md`
- `/docs/architecture/keys/`
- `/docs/dev-center/`
- `/docs/backlog/20-build-backlog.md`

## Scope

Package-based scheduling priority, staff eligibility, customer service entitlements, support priority, SLA extensions and future AI scheduling constraints.

---

# 1. Purpose

This document defines the architecture for future Service Level Policy Packages in CleanOps.

A Service Level Policy Package is a future scheduling/customer-priority policy layer. It is not the existing service package/catalog template and must not be implemented by reusing catalog labels as scheduling authority without an approved mapping.

The immediate use case is the Schedule Module:

- customers can buy different levels of flexibility, continuity and scheduling priority
- the scheduling engine can use package rules as deterministic constraints and weights
- manual admin scheduling and future AI-assisted scheduling can use the same rules

The long-term use case extends beyond scheduling:

- prioritized customer support
- response-time targets
- escalation rules
- customer success workflows
- quality follow-up cadence
- pricing and plan entitlements
- staff qualification rules
- premium customer handling

Core principle:

> A package is not just a label or price. It is a typed rule set that defines what the customer is entitled to and how the platform is allowed to move, staff, support and prioritize that customer.

Service Level Packages should be implemented as a reusable entitlement/policy model, not as hardcoded schedule flags. This remains documentation-only until the policy model, WorkOrder service-row to future Assignment mapping and data authority are approved.

---

# 2. Problem Statement

Customers may pay similar base prices while receiving materially different operational value.

Examples:

- one customer gets a very experienced cleaner
- another customer gets a newer approved cleaner
- one customer gets the same person every week
- another customer gets different staff depending on schedule capacity
- one customer has a fixed day and time
- another customer is flexible and can be placed where capacity exists

If all customers are treated the same, the system has no commercial basis for deciding:

- who can be moved
- who should keep a fixed slot
- who requires senior staff
- who only needs approved staff
- who gets priority support
- who gets the most stable continuity
- which customer should absorb schedule optimization changes

This becomes more important with AI scheduling.

An AI scheduler should not only optimize travel time and empty slots. It must also optimize according to the commercial service level the customer has bought.

---

# 3. Architecture Position

This document belongs next to the Schedule Module architecture.

Recommended location:

```text
docs/architecture/schedule/02-service-level-scheduling-packages.md
```

This should not be implemented as a scheduling-only enum.

The concept should be modeled as a broader policy/entitlement layer that can be consumed by:

- Schedule Module
- Support / Customer Service
- SLA handling
- Quality follow-up
- Customer agreement logic
- AI optimization
- Future pricing/plan logic

---

# 4. Naming Strategy

Internal package keys may use simple names:

```ts
type ServiceLevelKey =
  | 'basic'
  | 'flexible'
  | 'normal'
  | 'strict'
  | 'pro';
```

Customer-facing names should be more positive and less hierarchical:

```text
Flex Basic
Flex Plus
Standard
Priority
Premium
```

Avoid customer-facing language like:

- worse staff
- better staff
- low competence
- new staff as a negative promise
- B-team / A-team

Use language based on:

- flexibility
- continuity
- scheduling priority
- approved staff level
- dedicated team
- substitute continuity
- premium support

---

# 5. Recommended Package Tiers

The values below are product-policy defaults. They should be configurable where possible.

## 5.1 Flex Basic

Purpose:

High scheduling flexibility and lowest operational priority.

Customer profile:

- wants cleaning performed
- accepts variation
- price-sensitive
- does not require same staff

Rules:

- available Monday-Friday
- wide time window, for example 08:00-17:00
- no same-staff guarantee
- can be placed where capacity exists
- can be moved with shorter notice if agreement allows
- can be performed by any approved staff member
- low scheduling priority
- high optimization freedom for AI and manual planning

System interpretation:

```ts
const flexBasicPolicy = {
  schedulingPriority: 10,
  timeWindowFlexibility: 'wide',
  sameStaffRequirement: 'none',
  substituteRule: 'any_approved',
  minimumStaffLevel: 'approved',
  shortNoticeMoveAllowed: true,
  aiOptimizationFreedom: 'high'
};
```

## 5.2 Flex Plus

Purpose:

Customer has preferences but accepts optimization.

Rules:

- 2 optimal days
- 2 acceptable days
- wide time window, for example 08:00-16:00 or 09:00-17:00
- no hard same-staff guarantee
- regular staff may be used but not guaranteed
- can be moved within policy
- medium-low scheduling priority
- high optimization freedom

System interpretation:

```ts
const flexPlusPolicy = {
  schedulingPriority: 20,
  optimalDayCount: 2,
  acceptableDayCount: 2,
  timeWindowFlexibility: 'wide',
  sameStaffRequirement: 'none',
  substituteRule: 'any_approved',
  minimumStaffLevel: 'approved_or_regular',
  shortNoticeMoveAllowed: true,
  aiOptimizationFreedom: 'high'
};
```

## 5.3 Standard

Purpose:

Default balanced package.

Rules:

- 2 optimal days
- 1 acceptable day
- normal time window, for example 08:00-16:00 or 09:00-17:00
- ordinary staff prioritized
- approved substitute allowed
- move allowed within preferences
- medium scheduling priority
- medium optimization freedom

System interpretation:

```ts
const standardPolicy = {
  schedulingPriority: 40,
  optimalDayCount: 2,
  acceptableDayCount: 1,
  timeWindowFlexibility: 'medium',
  sameStaffRequirement: 'preferred',
  substituteRule: 'approved_substitute',
  minimumStaffLevel: 'regular',
  shortNoticeMoveAllowed: false,
  aiOptimizationFreedom: 'medium'
};
```

## 5.4 Priority

Purpose:

Higher continuity and tighter planning rights.

Rules:

- 1 optimal day
- 1 acceptable day
- narrower time window, for example 08:00-15:00 or 09:00-16:00
- high priority on same ordinary staff
- high priority on same substitute pool
- requires experienced or specially approved staff
- lower schedule flexibility
- higher price

System interpretation:

```ts
const priorityPolicy = {
  schedulingPriority: 70,
  optimalDayCount: 1,
  acceptableDayCount: 1,
  timeWindowFlexibility: 'narrow',
  sameStaffRequirement: 'strongly_preferred',
  substituteRule: 'same_substitute_pool',
  minimumStaffLevel: 'experienced',
  minimumExperienceMonths: 24,
  shortNoticeMoveAllowed: false,
  aiOptimizationFreedom: 'low'
};
```

## 5.5 Premium

Purpose:

Premium continuity, fixed planning rights and highest priority.

Rules:

- fixed day
- fixed time
- small approved deviation only
- dedicated regular staff where possible
- named or approved substitute pool
- highest scheduling priority
- requires senior/top-approved staff
- very low moveability
- highest price
- candidate for prioritized customer support and SLA handling

System interpretation:

```ts
const premiumPolicy = {
  schedulingPriority: 100,
  fixedDay: true,
  fixedTime: true,
  timeWindowFlexibility: 'fixed',
  sameStaffRequirement: 'required_or_named_substitute_pool',
  substituteRule: 'named_substitute_pool',
  minimumStaffLevel: 'senior',
  shortNoticeMoveAllowed: false,
  aiOptimizationFreedom: 'very_low',
  supportPriority: 'premium'
};
```

Important customer-language guardrail:

Do not promise absolute same-staff continuity in a way that is impossible during sick leave, vacation or employment changes.

Better customer-facing language:

```text
Dedicated regular cleaner, with approved substitute continuity when needed.
```

---

# 6. ServiceLevelPackage Model

Recommended model:

```ts
type ServiceLevelPackage = {
  id: string;
  companyId: string;

  key: ServiceLevelKey;
  displayName: string;

  status: 'active' | 'inactive' | 'draft';

  schedulingPolicy: SchedulingPolicy;
  staffingPolicy: StaffingPolicy;
  supportPolicy?: SupportPolicy;
  qualityPolicy?: QualityPolicy;
  aiPolicy?: AiOptimizationPolicy;

  createdAt: Date;
  updatedAt: Date;
};
```

## 6.1 SchedulingPolicy

```ts
type SchedulingPolicy = {
  schedulingPriority: number;

  allowedWeekdayMode:
    | 'any_weekday'
    | 'preferred_and_acceptable_days'
    | 'fixed_day';

  optimalDayCount?: number;
  acceptableDayCount?: number;

  timeWindowFlexibility:
    | 'wide'
    | 'medium'
    | 'narrow'
    | 'fixed';

  maxAllowedDeviationMinutes?: number;

  shortNoticeMoveAllowed: boolean;

  moveability:
    | 'high'
    | 'medium'
    | 'low'
    | 'admin_only';

  recurringSlotProtection:
    | 'low'
    | 'normal'
    | 'high'
    | 'locked';
};
```

## 6.2 StaffingPolicy

```ts
type StaffingPolicy = {
  sameStaffRequirement:
    | 'none'
    | 'preferred'
    | 'strongly_preferred'
    | 'required'
    | 'required_or_named_substitute_pool';

  substituteRule:
    | 'any_approved'
    | 'approved_substitute'
    | 'same_substitute_pool'
    | 'named_substitute_pool';

  minimumStaffLevel:
    | 'trainee_supervised'
    | 'approved'
    | 'regular'
    | 'experienced'
    | 'senior'
    | 'specialist';

  minimumExperienceMonths?: number;

  allowDifferentStaff: boolean;
};
```

## 6.3 SupportPolicy

Support policy is included because the concept should grow beyond scheduling.

```ts
type SupportPolicy = {
  supportPriority:
    | 'standard'
    | 'elevated'
    | 'priority'
    | 'premium';

  targetResponseTimeHours?: number;

  escalationLevel:
    | 'normal'
    | 'priority_queue'
    | 'manager_review'
    | 'dedicated_contact';
};
```

## 6.4 QualityPolicy

```ts
type QualityPolicy = {
  qualityFollowUpCadence:
    | 'standard'
    | 'quarterly'
    | 'monthly'
    | 'after_each_visit'
    | 'custom';

  requiresSeniorQualityReview: boolean;
};
```

## 6.5 AiOptimizationPolicy

```ts
type AiOptimizationPolicy = {
  optimizationFreedom:
    | 'high'
    | 'medium'
    | 'low'
    | 'very_low';

  mayMoveAutomaticallyWithinPreferences: boolean;
  maySuggestStaffReplacement: boolean;
  maySuggestTimeWindowShift: boolean;
  requiresAdminApprovalForMove: boolean;
};
```

---

# 7. Staff Qualification Model

Do not expose staff ranking directly to customers in a harmful or simplistic way.

Internal staff qualification levels should be professional and growth-oriented.

Recommended internal levels:

```ts
type StaffQualificationLevel =
  | 'trainee'
  | 'approved'
  | 'regular'
  | 'experienced'
  | 'senior'
  | 'specialist';
```

Possible model:

```ts
type StaffQualification = {
  id: string;
  companyId: string;

  staffId: string;

  level: StaffQualificationLevel;

  approvedServiceTypes: string[];

  experienceMonths?: number;

  qualityScore?: number;
  customerFeedbackScore?: number;

  canWorkPremiumCustomers: boolean;
  canWorkPriorityCustomers: boolean;

  validFrom: Date;
  validTo?: Date;
};
```

Guardrails:

- Do not call employees "basic staff".
- Do not expose internal scoring directly to customers.
- Tie qualification to training, quality assurance, experience and approved responsibilities.
- Make progression between levels possible.

---

# 8. Integration with Assignment / AO

Assignment should reference the package.

```ts
type Assignment = {
  id: string;
  companyId: string;
  customerId: string;

  serviceLevelPackageId?: string;

  serviceType: string;
  defaultDurationMinutes: number;

  assignmentKind: 'recurring' | 'one_off' | 'extra';

  activeFrom: Date;
  activeTo?: Date;
};
```

AssignmentPreference still stores customer-specific preferences.

ServiceLevelPackage stores commercial policy.

Both must be evaluated.

Example:

```text
Customer preference:
Wants Monday or Wednesday, 08:00-15:00.

Service package:
Priority, same staff strongly preferred, experienced staff required.

Valid schedule placement must satisfy both.
```

Conflict resolution should fail or require decision if a package policy is violated even if the basic customer preference is satisfied.

---

# 9. Conflict Resolution Integration

When two assignments conflict, the schedule engine should evaluate:

1. Locked state.
2. Existing committed placement.
3. Service-level priority.
4. Fixed vs flexible time.
5. Same-staff requirement.
6. Staff qualification requirement.
7. Customer preferences.
8. One-off vs recurring.
9. Travel/route impact.
10. Key/access risk.

Example:

```text
Premium customer conflicts with Flex Basic customer.
Premium keeps slot.
Flex Basic receives move suggestion.
```

Example:

```text
Priority customer conflicts with Standard customer.
System checks whether Standard can move without breaking preferences.
If yes, propose movement.
If no, require admin decision.
```

---

# 10. AI Scheduling Integration

AI scheduling must treat Service Level Packages as constraints and weights.

AI may optimize:

- route efficiency
- empty slot usage
- workload distribution
- travel time
- conflict resolution
- schedule stability

But AI must obey:

- package scheduling priority
- package staffing rules
- package same-staff continuity
- package moveability
- package time-window flexibility
- package support/escalation promises if relevant

AI should never produce a recommendation that violates the deterministic validation engine.

Recommended AI API boundary:

```ts
type AiScheduleSuggestionRequest = {
  candidateAssignments: Assignment[];
  currentSchedule: ScheduleOccurrence[];
  serviceLevelPackages: ServiceLevelPackage[];
  staffQualifications: StaffQualification[];
  constraints: ValidationConstraint[];
};
```

AI output must still be validated:

```ts
const suggestion = await aiSuggestSchedule(request);
const validation = validateScheduleChange(suggestion.changeSet, {
  includeServiceLevelPolicies: true,
  includeStaffAvailability: true,
  includeCustomerPreferences: true,
  includeKeyAccessRisk: true
});
```

---

# 11. Support and SLA Extension

The package model should support future customer operations beyond scheduling.

Examples:

## Standard customer

```text
Normal support queue
Normal response target
Standard quality follow-up
```

## Priority customer

```text
Higher support queue priority
Manager escalation option
More frequent quality checks
```

## Premium customer

```text
Premium support priority
Possible dedicated contact
Faster response target
High-touch quality follow-up
```

This does not need full implementation in schedule MVP, but the data model should avoid blocking it.

---

# 12. UI / Product Copy Guardrails

Do not describe packages as "better" and "worse" cleaning.

Recommended customer framing:

```text
Choose how much scheduling flexibility, continuity and priority you want.
```

Possible customer-facing table:

| Package | Time | Day | Continuity | Staff eligibility | Moveability |
|---|---|---|---|---|---|
| Flex Basic | Wide | Any weekday | Not guaranteed | Approved | High |
| Flex Plus | Wide | Several days | Not guaranteed | Approved/regular | High |
| Standard | Normal | 2+1 days | Prioritized | Regular | Medium |
| Priority | Narrow | 1+1 days | High priority | Experienced | Low |
| Premium | Fixed | Fixed | Dedicated/substitute pool | Senior/specialist | Very low |

---

# 13. Default Policy Matrix

| Internal key | Customer name | Priority | Flexibility | Same staff | Staff level | AI freedom | Support |
|---|---|---:|---|---|---|---|---|
| basic | Flex Basic | 10 | Wide | None | Approved | High | Standard |
| flexible | Flex Plus | 20 | Wide | None/preferred | Approved/regular | High | Standard |
| normal | Standard | 40 | Medium | Preferred | Regular | Medium | Standard |
| strict | Priority | 70 | Narrow | Strongly preferred | Experienced | Low | Elevated |
| pro | Premium | 100 | Fixed | Required/substitute pool | Senior | Very low | Premium |

---


---

# 14. Temporary Exceptions and Compression Interaction

Service Level Packages constrain how customer scheduling preferences, temporary exceptions and schedule compression may be applied.

Package policy must be evaluated before suggesting or committing:

- use of acceptable temporary cleaning times
- temporary scheduling exception warnings
- occurrence overrides
- holiday compression
- release-staff-day scenarios
- movement outside optimal but inside acceptable windows
- customer communication requirements

Important policy:

> Temporary customer exceptions do not override the customer's package. Package policy remains a constraint/weight in schedule validation.

Default compression policy:

```text
Flex Basic / Flex Plus move first.
Standard can move within acceptable rules.
Priority is protected more strongly.
Premium should generally not be affected.
```

Package policy may define:

- whether customer may be moved at all
- whether movement requires admin approval
- whether customer communication is required
- whether same staff is required
- whether approved substitute pool is required
- how much AI optimization freedom exists
- how strongly the customer is protected during compression

---

# 15. Customer Communication and Support Priority

Schedule changes may trigger customer communication.

Examples:

- time changed within acceptable preference
- time changed outside optimal but inside acceptable
- active temporary exception conflicts with booked visit
- compression scenario affects customer
- holiday week requires adjusted visit

Service-level package should influence:

- whether communication is required
- support queue priority
- manager review/escalation
- quality follow-up
- whether a manual confirmation task should be created

Internal reason and external customer copy should remain separate.

Example internal reason:

```text
schedule_compression
```

Example external copy:

```text
Vi behöver justera din tid denna vecka på grund av planeringsändring.
```

For holiday compression:

```text
På grund av helgdag justeras veckans städtid.
```

---

# 16. MVP Recommendation

MVP should not overbuild pricing/SLA logic.

Implementation remains blocked until ADR approval for whether Service Level Policy Packages are new policy objects, company-scoped configuration, global templates with overrides, or mapped from existing service catalog/package data.

MVP should include:

1. ServiceLevelPackage table/config.
2. Assignment reference to ServiceLevelPackage.
3. SchedulingPolicy subset.
4. StaffingPolicy subset.
5. StaffQualification basic level.
6. Validation hook for service level policy.
7. Conflict priority weighting.
8. AI optimization freedom field reserved.
9. SupportPolicy fields reserved but not fully operational.

MVP can defer:

1. Full customer-facing package purchase flow.
2. Automated support SLA enforcement.
3. Advanced staff scoring.
4. Automated quality follow-up cadence.
5. Complex pricing entitlements.

---

# 17. Suggested Implementation Phases

## Phase 1 - Discovery

- Map existing customer agreements/assignment fields.
- Map existing staff competency/roles if any.
- Map existing AO variation behavior.
- Identify whether packages should be global templates or company-scoped.

## Phase 2 - Policy model

Documentation-only until ADR approval:

- Add ServiceLevelPackage model/config.
- Add package assignment reference after WorkOrder service-row to future Assignment mapping is approved.
- Add package policy interpretation service.

## Phase 3 - Schedule validation integration

- Inject service-level rules into schedule validation.
- Add priority score calculation.
- Add staff qualification validation.

## Phase 4 - UI exposure

- Show package on assignment/customer detail.
- Show schedule constraints in admin planning.
- Show conflict messages caused by package policy.

## Phase 5 - AI integration

- Provide package policy to AI suggestion layer.
- Validate all AI suggestions through deterministic engine.

## Phase 6 - Support/SLA extension

- Add support priority and escalation handling.
- Add quality follow-up cadence if needed.

---

# 18. Review Questions for RORK

Please review with focus on:

1. Should ServiceLevelPackage be company-scoped or global with company overrides?
2. How should packages connect to Assignment/AO and customer agreement?
3. Are there existing staff competency fields that can be reused?
4. Should SupportPolicy be added now as reserved fields or deferred entirely?
5. How should package rules be injected into schedule validation?
6. How should package rules be exposed in admin UI without overcomplicating scheduling?
7. What migrations would be required?
8. What should be included in MVP vs later?
9. How should AI receive and respect package policies?
10. How should Development Center/backlog represent this as a broader entitlement model?

RORK should return a technical review and implementation plan before coding begins.
