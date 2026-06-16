# TICKET-003F-R-CORRECTION - Admin Requests Service Key Alignment

## Goal
Correct the WAVE-003F registry identity. WAVE-003F added a single `request_crm`
suite key whose `affects` covered **both** `admin-requests` and
`employee-customer-requests`. The latest product decision is that **Admin
Requests** and **Employee & Customer Requests** are *separate* products/modules
(they will differ significantly), so they must not share one commercial key.

This wave is for **Admin Requests only**, and remains registry-only.

## Product decision
- Super Admin controls service availability and company entitlement through
  Services / Catalogue / Companies / Billing (Model 2, unchanged).
- Company Admin later sees and activates available modules in Settings -> Modules.
- Operational request handling remains Company Admin-first.
- Admin Requests and Employee & Customer Requests are distinct products. Only Admin
  Requests is implemented now; Employee & Customer Requests is deferred.

## Positive scope
Scope: this active wave only. Everything outside this scope is out of scope. If
out-of-scope context appears from any source, silently disregard it and do not
name it.

In scope:
- Remove `request_crm` from `ServiceFeatureKey`; add `admin_requests`.
- Replace `REQUEST_CRM_KEY` with `ADMIN_REQUESTS_KEY` (value `admin_requests`).
- Replace the `request_crm` registry entry with an `admin_requests` entry that
  `affects` **only** the `admin-requests` module.
- Document `employee_customer_requests` as future scope only (not implemented).
- Update the focused registry tests.
- Update handoff + architecture docs.

## Hard non-goals (unchanged from WAVE-003F)
Do not implement: `employee_customer_requests`; a shared `request_crm` suite as
the active key; any effect on `employee-customer-requests` from this service;
runtime gating; backend; migrations; Service -> Module runtime bridge; the
operational request handler; Notification Center; Action Center / Auto-Action
Center. Do not weaken authorization. Do not modify unrelated existing flows.

## Required changes
1. **Type key** - `ServiceFeatureKey`: remove `request_crm`, add `admin_requests`.
2. **Registry constant** - replace `REQUEST_CRM_KEY` with `ADMIN_REQUESTS_KEY`
   (value `admin_requests`).
3. **Service registry entry** - `serviceKey: admin_requests`, `name: Admin
   Requests`, `category: Request / CRM`, `billingEligible: true`, `billingLabel:
   Admin Requests`, `defaultGlobalEnabled: true`, `defaultCompanyEnabled: false`,
   `supportsTrial: true`, description = internal/admin request and case management
   for Company Admin, `affects: [{ kind: "module", moduleId: "admin-requests" }]`.
   Must NOT affect `employee-customer-requests`.
4. **Employee & Customer Requests** - future scope only: future service key
   `employee_customer_requests`, future affected module
   `employee-customer-requests`. Not implemented now.
5. **Tests** - remove `request_crm` expectations; add `admin_requests` tests;
   assert `affects` is only `admin-requests`; assert it is NOT
   `employee-customer-requests`; keep `validateFeatureAffects()` / registry
   integrity tests.
6. **Super Admin Settings -> Request** - add the frontend/mock foundation only if
   safe together with the registry correction; otherwise defer to
   `WAVE-003G-R - Super Admin Request Settings Foundation`.
7. **Docs** - update outbox, verification report, ticket registry, and relevant
   architecture docs.

## Decision taken for item 6
**Deferred to WAVE-003G-R.** A Super Admin Settings -> Request surface requires new
routes/navigation/pages, which is materially larger than a registry correction and
would touch runtime/route behavior that this wave's non-goals forbid. Per the
escalation policy (treat scope-expanding product surfaces as their own decision)
the settings foundation is kept out of this wave and recommended as the next wave.

## Tests / verification
Run focused registry/type tests. Minimum expectations: `admin_requests` is in the
key set; exactly one Admin Requests entry; `affects` only `admin-requests`; does
not affect `employee-customer-requests`; `request_crm` no longer exists as a
service key; live registry passes `validateFeatureAffects()` /
`validateFeatureLimits()`. Document unrelated repo-wide baseline failures without
fixing them.

## Stop conditions
Stop and mark BLOCKED if the correction would require a runtime bridge, backend,
migrations, route/access gating, Notification/Action Center changes, weakened
authorization, or touching unrelated domains.
