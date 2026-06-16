# TICKET-003G-R — Super Admin Request Settings Foundation

## Status

READY

## Wave

WAVE-003G-R — Super Admin Request Settings Foundation

## Goal

Create the first frontend/mock foundation for **Super Admin Settings → Request**.

This wave is **Super Admin-only** and **configuration/governance-only**.

## Product context

The previous correction wave established the correct Admin Requests service/catalogue identity:

- `admin_requests`
- Display name: `Admin Requests`
- Affects only module: `admin-requests`
- `employee_customer_requests` is deferred and must remain separate

This wave creates the Super Admin global/settings foundation for Request governance.

## Non-goals

Do **not** build:

- operational request handler
- Company Admin request settings
- customer or employee request surfaces
- backend
- migrations
- Supabase tables
- runtime automation
- Notification Center
- Auto-Action / Action Center
- `/crm/*` route gating changes
- Service → Module runtime bridge
- `admin_requests` entitlement behavior changes beyond displaying/organizing the new settings surface

Do not modify unrelated existing flows.

## Required implementation scope

### 1. Inspect existing Super Admin settings structure

Before changing anything, inspect the current settings/navigation/page patterns for Super Admin settings.

Find the existing pattern for:

- Super Admin settings navigation
- Settings categories/tabs
- Routes/pages for settings areas
- Existing global template/settings pages, if present

Reuse the existing pattern.

Do **not** create a parallel settings framework.

### 2. Add Super Admin Settings → Request entry

Add a new Super Admin settings category/surface:

**Name:** `Request`

**Purpose:** Global/system Request configuration and governance.

This must be clearly separate from Company Admin local request settings.

It should be visible only in the Super Admin settings/admin context according to the existing role/permission pattern.

If the app has a Super Admin settings menu/sidebar:

- Add `Request` as a category/item there.

If the app uses route-based settings:

- Add the minimal route/page needed using the existing route convention.

Do not conflict with the future Company Admin route:

- Future Company Admin local settings may use `/settings/request`.
- If the current route model cannot clearly separate Super Admin and Company Admin settings, stop and report BLOCKED instead of creating an ambiguous route.

### 3. Create the Super Admin Request Settings page

Create a frontend/mock page or panel for Super Admin global Request settings.

The page should clearly show this scope:

#### A. Global/system request types

- Placeholder/list/card for locked system request types.
- Example categories may be shown as mock data only.
- Clearly mark system/locked items.

#### B. Locked default statuses

- Placeholder/list/card for global statuses.
- Example: New, Open, Waiting, Resolved, Closed.
- Mark as global defaults / system-controlled.

#### C. Locked default priorities

- Placeholder/list/card for global priority defaults.
- Example: Low, Normal, High, Urgent.
- Mark as global defaults / system-controlled.

#### D. SLA templates

- Placeholder cards for SLA templates.
- Example: Standard SLA, Urgent SLA, Internal Admin SLA.
- No real SLA engine.

#### E. Global request templates / system templates

- Placeholder cards for global templates.
- Show that Company Admin may later copy/use allowed templates.
- Show that locked/system templates cannot be edited locally.

#### F. Governance / audit placeholder

- Placeholder area explaining that changes to global request configuration should later be logged/audited.
- No real audit system needs to be built in this wave.

#### G. Future integration references

Add non-functional reference cards/section for:

- Notification templates
- Auto-Action templates
- Automation & AI Center

Clearly mark them as future/linked systems.

Do **not** build these systems here.

### 4. UX requirements

Keep the UI clean and consistent with the existing Super Admin design.

Recommended structure:

- Header: `Request Settings`
- Subtitle: `Global system configuration for Admin Requests`
- Warning/info card: `This is not the operational request inbox. Company Admin handles day-to-day requests.`
- Sections/cards for the areas above
- Badges such as:
  - `System`
  - `Locked`
  - `Global default`
  - `Future`
  - `Admin Requests`

The page should make the ownership boundary obvious.

Super Admin owns:

- global/system request types
- locked defaults
- global templates
- governance/audit policy
- future links to Notification/Auto-Action templates

Company Admin later owns:

- local request settings
- local editable variants where allowed
- operational request dashboard/list/inbox

### 5. No operational behavior

Do not add:

- request creation
- request list/inbox
- request detail view
- assignment
- status transitions
- comments/messages
- customer/employee request submission
- notification delivery
- auto-actions
- AI decisions

This is only the global configuration/governance placeholder foundation.

### 6. Documentation updates

Update relevant handoff and architecture docs to record:

- Super Admin Settings → Request foundation exists
- It is global/system/governance-only
- It is tied to Admin Requests as the first request product
- Company Admin Settings → Request remains future scope
- operational request handler remains future scope
- Employee & Customer Requests remains future scope
- Notification Center and Auto-Action Center remain separate systems

### 7. Verification

Run the narrowest relevant checks:

- typecheck/build if routes/components/types changed
- focused tests if settings navigation/page tests exist
- otherwise document that no targeted tests exist for this frontend/mock page

If full static checks still show the known unrelated baseline TypeScript errors, document them separately and do not fix unrelated domains.

## Expected final report

RORK must report:

- exact files changed
- route/path added, if any
- navigation/menu item added, if any
- confirmation this is Super Admin-only
- confirmation no Company Admin settings were built
- confirmation no operational request handler was built
- confirmation no backend/migrations/runtime bridge were added
- checks/tests run
- unrelated baseline failures, if any
- recommended next smallest wave

## Stop conditions

Stop and report BLOCKED if:

- the existing settings structure cannot clearly separate Super Admin settings from Company Admin settings
- adding the page would require backend/migrations/Supabase changes
- adding the page would require operational request handling
- adding the page would require Service → Module runtime bridge
- adding the page would require Notification Center or Auto-Action Center implementation
- the implementation would create a parallel settings framework
