# ADR: Temporary Scheduling Exceptions

## Status

Accepted for architecture review as Phase 2A direction; pending implementation approval.

This ADR is documentation only. It does not authorize implementation, migration, table creation, Supabase policy creation, UI work, repository/adapters, tests or runtime behavior changes.

## Context

CleanOps needs a safe way to record customer/admin date-bound scheduling wishes without treating those wishes as guaranteed schedule changes.

Current constraints:

- Supabase remains the source of truth.
- localStorage is legacy/cache/fallback only.
- Booking Queue is not final schedule authority and its local backout bridge is temporary technical debt.
- Work Orders and WorkOrder service rows remain the current work/service model and must not be automatically mutated by this ADR.
- Occurrence exceptions are not approved for automatic creation from temporary wishes.
- Mission Log and Time Reporting are downstream execution/financial records and must remain immutable from schedule planning changes.
- Temporary Scheduling Exceptions are warning/guidance inputs only in V1.

## Decision summary

Temporary Scheduling Exceptions should be modeled as a separate Supabase table, not embedded in Customer JSON.

Recommended future table name:

`customer_temporary_scheduling_exceptions`

Reasons for a separate table:

- supports tenant/customer-scoped RLS without exposing broad Customer JSON writes;
- supports overlap enforcement, indexes, audit fields and status transitions;
- avoids growing Customer JSON into a mixed preference/workflow store;
- allows Customer Portal self-service permissions to be narrower than customer profile permissions;
- creates a clear boundary between recurring customer preferences and date-bound temporary wishes.

This remains a proposed schema direction only. No migration is authorized by this ADR.

## Non-goals and explicit no-mutation contract

This ADR does not authorize:

- migration;
- table creation;
- RLS policy creation;
- Booking Queue sync;
- dependency on Booking Queue local fallback;
- WorkOrder mutation;
- WorkOrder service-row mutation;
- occurrence exception creation;
- recurring series mutation;
- Planning Mode publish;
- capacity compression or holiday compression;
- AI scheduling;
- Customer Portal schedule mutation;
- Mission Log integration;
- Time Reporting integration;
- payroll, invoice or completed execution history mutation.

Temporary Scheduling Exceptions V1 is read-only planning guidance only.

## Recommended data model

### Proposed table

`customer_temporary_scheduling_exceptions`

### Proposed columns

| Column | Type | Required | Notes |
|---|---:|---:|---|
| `id` | uuid | yes | Primary key. |
| `company_id` | uuid | yes | Tenant/company scope. |
| `customer_id` | uuid | yes | Customer the wish applies to. |
| `source` | text | yes | Recommended values: `customer_portal`, `admin`, `system`. Used for origin and idempotency. |
| `status` | text | yes | Stored workflow status: `submitted`, `accepted_for_planning`, `cancelled`. |
| `start_date` | date | yes | Inclusive local date start. |
| `end_date` | date | yes | Inclusive local date end. Must be on/after `start_date`. |
| `windows` | jsonb | yes | Array of optional time windows. Empty array means date-bound guidance without a specific time window. |
| `reason_code` | text | yes | Structured reason category. |
| `customer_note` | text | no | Optional customer-provided note. May contain sensitive information. |
| `admin_note` | text | no | Optional internal/admin note. May contain sensitive information. |
| `created_by_actor_type` | text | yes | `customer`, `admin` or `system`. |
| `created_by_user_id` | uuid | no | User account that created the row when available. Nullable for system or customer flows without a user id. |
| `created_by_customer_id` | uuid | no | Customer actor that created the row when the Customer Portal actor is customer-scoped. |
| `client_request_id` | text | no | Client-generated idempotency key. Required for idempotent create requests. |
| `accepted_for_planning_at` | timestamptz | no | Set when an admin/system review accepts it as planning guidance. |
| `accepted_for_planning_by_user_id` | uuid | no | Admin/system user that accepted it, when applicable. |
| `cancelled_at` | timestamptz | no | Set when cancelled. |
| `cancelled_by_actor_type` | text | no | `customer`, `admin` or `system`. |
| `cancelled_by_user_id` | uuid | no | User account that cancelled the row when available. |
| `cancelled_by_customer_id` | uuid | no | Customer actor that cancelled the row when customer-scoped. |
| `created_at` | timestamptz | yes | Audit timestamp. |
| `updated_at` | timestamptz | yes | Audit timestamp. |

### Actor audit model

Use explicit actor fields instead of relying on one nullable user field.

Admin-created rows:

- `source = 'admin'`;
- `created_by_actor_type = 'admin'`;
- `created_by_user_id` is the admin user id;
- `created_by_customer_id` is null.

Customer-created rows:

- `source = 'customer_portal'`;
- `created_by_actor_type = 'customer'`;
- `created_by_user_id` is set when the portal session has a user id;
- `created_by_customer_id` is set to the customer actor/customer id when the portal is customer-scoped.

System-created rows:

- `source = 'system'`;
- `created_by_actor_type = 'system'`;
- `created_by_user_id` is nullable;
- `created_by_customer_id` is null unless the system action is explicitly on behalf of a customer.

The actor model must preserve who submitted or changed guidance without implying that the actor changed the schedule.

### Reason model

Use structured reason fields:

- `reason_code text not null`;
- `customer_note text null`;
- `admin_note text null`.

Recommended initial `reason_code` examples:

- `customer_vacation`;
- `school_holiday`;
- `public_holiday`;
- `renovation`;
- `temporary_work_from_home`;
- `customer_requested_temporary_window`;
- `capacity_issue`;
- `admin_planning_note`;
- `other`.

Free text notes must not be used for AI learning by default. `customer_note` and `admin_note` may contain sensitive information and must be excluded from AI learning unless a later privacy/product ADR explicitly approves otherwise.

### Windows JSON contract

`windows` is a JSON array.

Minimum expected shape:

```json
[
  {
    "start_time": "09:00",
    "end_time": "12:00"
  }
]
```

Contract:

- `windows` must be an array;
- each window must include `start_time` and `end_time`;
- times use `HH:mm` 24-hour format;
- `start_time` must be before `end_time`;
- times are interpreted in the company/customer local timezone;
- an empty array means date-bound guidance without a specific time window;
- no validation is implemented by this ADR.

Future validation should reject malformed windows before persistence and should be duplicated server-side.

### Idempotency strategy

Do not rely only on `unique(company_id, created_by_user_id, client_request_id)` because `created_by_user_id` may be null for customer portal submissions.

Preferred strategy:

- require `client_request_id` for create requests that need idempotency;
- enforce a partial unique index for non-null request ids:
  - `unique(company_id, customer_id, source, client_request_id) where client_request_id is not null`.

This supports customer and admin submissions without relying on nullable user ids.

Open implementation detail: whether admin-created requests should also include a separate admin operation id, or whether `source + client_request_id` is sufficient.

### Recommended indexes

Proposed indexes for later migration review:

- `company_id, customer_id, start_date, end_date` for customer/date lookups;
- `company_id, status, start_date, end_date` for admin planning views;
- `company_id, customer_id, status` for customer portal lists;
- partial unique index on `company_id, customer_id, source, client_request_id` where `client_request_id is not null`;
- overlap protection for non-cancelled date ranges, using one of the strategies below.

## Status and derived state model

Stored workflow statuses should remain minimal:

- `submitted`;
- `accepted_for_planning`;
- `cancelled`.

Temporal states should be derived at read time:

- `upcoming` when the current local date is before `start_date`;
- `active` when the current local date is between `start_date` and `end_date`, inclusive;
- `expired` when the current local date is after `end_date`.

Do not store `active` or `expired` as primary workflow statuses. Storing temporal status risks stale state.

UI meaning:

- `submitted` means visible as an unreviewed customer-submitted planning request;
- `accepted_for_planning` means reviewed planning guidance;
- `cancelled` means no longer active guidance and should not be used for warnings except in historical/audit views.

Approval/acceptance must never imply schedule mutation or customer guarantee.

## Overlap policy

Recommended policy:

- a customer should not have more than one non-cancelled Temporary Scheduling Exception overlapping the same date range within the same company;
- `cancelled` rows are historical and should not block new exceptions;
- overlapping prevention must be enforced server-side or database-side;
- client-only validation is not acceptable.

### Option A: database exclusion constraint

Use a DB-level exclusion strategy for overlapping date ranges, such as a GiST exclusion constraint over:

- `company_id` equality;
- `customer_id` equality;
- date range overlap for `[start_date, end_date]`;
- partial predicate excluding `status = 'cancelled'`.

This may require a Postgres extension such as `btree_gist` or an equivalent approved strategy for uuid/text equality inside a GiST exclusion constraint.

Pros:

- strongest centralized protection;
- works across all clients;
- less dependent on application correctness.

Cons:

- requires extension/constraint review;
- implementation details can be database-specific;
- migration needs careful testing.

### Option B: Supabase RPC with transaction-level locking

Use a Supabase RPC for create/update/cancel flows that:

- validates tenant/customer access;
- acquires transaction-level lock for `(company_id, customer_id)`;
- checks for non-cancelled overlapping rows server-side;
- writes only if no overlap exists;
- returns a safe conflict error if overlap is detected.

Pros:

- flexible validation and product-specific errors;
- can handle nuanced future update/cancel rules;
- avoids immediate reliance on a GiST exclusion constraint.

Cons:

- all writes must go through the RPC;
- direct table writes must be restricted;
- must be carefully tested for concurrency.

Final overlap implementation strategy remains an open technical decision before migration.

## Permissions and RLS model

No policies are implemented by this ADR.

Future RLS should enforce company/tenant scoping and least privilege.

Admin permissions:

- admins can view Temporary Scheduling Exceptions for customers in their company;
- admins can create exceptions for customers in their company;
- admins can review/accept customer-submitted exceptions as planning guidance;
- admins can cancel exceptions in their company;
- admin access must not cross company boundaries.

Customer Portal permissions:

- customers can only view their own exceptions;
- customers can only create exceptions for their own customer record/company scope;
- customers can only cancel permitted exceptions for their own customer record;
- customers must not access other customers' exceptions;
- customers must not update admin-only fields such as `admin_note`, `accepted_for_planning_at` or `accepted_for_planning_by_user_id`;
- customer-created rows must be distinguishable through `source` and actor fields.

Company/tenant scoping:

- every read/write must be scoped by `company_id`;
- customer identity must be resolved through an approved customer portal identity model;
- RLS must not trust client-provided customer/company ids without verifying session membership.

## Customer Portal policy

Recommended V1 customer capabilities:

| Action | Recommendation |
|---|---|
| Create upcoming exception | Allowed, subject to cutoff and overlap policy. |
| Cancel upcoming exception | Allowed when it is customer-created and not already operationally acted on. |
| Edit upcoming exception | Prefer create-new/cancel-old or request-change flow; direct free edit needs approval. |
| Edit active exception | Not freely allowed. Active changes should require admin review or contact/request-change flow. |
| Cancel active exception | Not normal self-service. Should use contact/request wording or admin review. |

Rationale:

- active exceptions may already be influencing planning conversations;
- customer self-service must not imply guaranteed schedule mutation;
- cancelling or editing active guidance may require human review.

Final customer edit/cancel policy remains a product decision before implementation.

## Approval policy

Recommended V1 behavior:

- customer-created exceptions are immediately visible as `submitted` planning guidance in admin surfaces;
- admin warnings can show submitted guidance with clear “unreviewed” language;
- admins may mark a row `accepted_for_planning` after review;
- acceptance means “reviewed as planning guidance,” not schedule mutation and not a guarantee;
- any actual schedule movement must require a later explicit admin scheduling action outside this ADR.

Alternative for review:

- require admin approval before any customer-created exception appears in admin warnings.

Recommended direction is immediate visibility as unreviewed guidance, because hiding customer wishes until approval increases planning blind spots. UI must clearly distinguish `submitted` from `accepted_for_planning`.

## Cutoff policy

Recommended default cutoff for customer-created exceptions: 72 hours before affected planned service date.

This exact cutoff window remains a product decision before implementation.

Date resolution fallback:

- if the affected planned service date can be safely resolved, use that service date for cutoff evaluation;
- otherwise use `exception.start_date`;
- if neither can be safely resolved, customer UI should avoid normal self-service mutation language and use contact/request wording.

Inside cutoff:

- customer UI should switch to wording such as “Contact us” or “Request help with this change”;
- the app should not present the action as normal self-service schedule mutation;
- admins may still create or review exceptions without the customer cutoff, subject to internal policy.

No cutoff logic is implemented by this ADR.

## Warning/guidance consumption contract

Allowed V1 consumers:

- WorkOrderDetails warning banner;
- Add Service / Change date-time Status preview;
- Customer Card display;
- Customer Portal list/detail display, if later approved.

Allowed V1 behavior:

- show that a customer has a date-bound temporary wish;
- show whether it is `submitted` or `accepted_for_planning`;
- show derived temporal state (`upcoming`, `active`, `expired`);
- warn that a proposed service date/time may conflict with or match the temporary wish;
- guide admins to contact/review/customer-confirm where needed.

Disallowed V1 behavior:

- no Booking Queue writes;
- no Booking Queue fallback dependency;
- no WorkOrder service-row mutation;
- no occurrence exception creation;
- no recurring series mutation;
- no Mission Log writes;
- no Time Reporting writes;
- no Planning Mode publish;
- no compression action;
- no AI schedule mutation;
- no Customer Portal schedule mutation.

## Safe UX language

Recommended customer-facing wording:

- “This helps us plan.”
- “This is not guaranteed.”
- “We may contact you if confirmation is needed.”
- “Your request will be visible to our planning team.”
- “If your next service is soon, please contact us so we can review it.”

Recommended admin-facing wording:

- “Customer-submitted planning guidance.”
- “Reviewed planning guidance.”
- “Temporary wish; does not automatically move the visit.”
- “Check before changing this service time.”

Avoid wording such as:

- “Your booking has been changed.”
- “Your new time is confirmed.”
- “Guaranteed availability.”
- “This will reschedule your cleaning.”
- “Automatic exception.”

## Required tests for a later implementation phase

Before implementation is accepted, test plans should cover:

- RLS tests for admin/company scope;
- RLS tests for customer portal own-customer access only;
- RLS denial tests for cross-customer and cross-company access;
- overlap creation tests;
- overlap update tests;
- concurrency tests for simultaneous overlapping creates;
- derived temporal state tests for upcoming/active/expired;
- stored workflow status tests for submitted/accepted_for_planning/cancelled;
- windows JSON validation tests;
- idempotency tests for customer portal submissions with nullable user ids;
- idempotency tests for admin submissions;
- cutoff behavior tests;
- dirty-browser/localStorage regression tests;
- no Booking Queue mutation tests;
- no Booking Queue fallback dependency tests;
- no WorkOrder mutation tests;
- no WorkOrder service-row mutation tests;
- no occurrence exception write tests;
- no recurring series mutation tests;
- no Mission Log side-effect tests;
- no Time Reporting side-effect tests;
- audit field tests for admin-created, customer-created and system-created rows.

## Implementation gates

Before any implementation, the following must be explicitly approved:

1. final table schema;
2. final RLS model;
3. final overlap enforcement strategy;
4. cutoff policy;
5. customer edit/cancel policy;
6. submitted vs accepted_for_planning UI behavior;
7. no-localStorage regression test plan;
8. no-mutation test plan.

## Open decisions

- Final overlap enforcement approach: DB exclusion constraint vs Supabase RPC with transaction-level locking.
- Exact customer-created cutoff window; 72 hours is the recommended default only.
- Whether customer-created exceptions are immediately visible in all admin warnings or only selected review surfaces.
- Whether customers can cancel active exceptions or must use contact/request wording.
- Whether upcoming edits are direct edits or cancel-and-recreate/request-change.
- Exact RLS implementation tied to the approved customer portal identity model.
- Whether admin-created rows require a separate admin operation id in addition to `client_request_id`.
- Which `reason_code` values are final for V1.
- Whether `accepted_for_planning` is required for all admin-created rows or admin-created rows can be created already accepted.

## Final recommendation

Ready for ADR approval with restrictions.

Proceed later only after the implementation gates are approved. First implementation should be warning/guidance only and must not mutate Booking Queue, WorkOrder service rows, occurrence exceptions, recurring series, Mission Log or Time Reporting.