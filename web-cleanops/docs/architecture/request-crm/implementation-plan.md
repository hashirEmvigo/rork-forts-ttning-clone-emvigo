# REQUEST CRM — Technical Implementation Plan

Version: v0.2-automation-ai-center-aligned
Status: PLANNING ONLY — no product code, routes, UI, migrations, live automation or live AI in this document
Wave / Ticket: WAVE-002 · TICKET-002 — REQUEST CRM Implementation Plan
Source package: `docs/architecture/request-crm/00-index.md` (canonical, supersedes `docs/architecture/requests/`)

> This plan is the Phase 0 / "Architecture validation" deliverable required by
> `22-implementation-phases.md` and `29-rork-assignment.md`. It analyzes the saved
> REQUEST CRM v0.2 package together with the current `web-cleanops` codebase and the
> Automation & AI Center alignment standard, then proposes a phased build that starts
> with Slice 0 (frontend shell + mock data only). It does **not** implement anything.

---

## 0. Documentation paths confirmed

All REQUEST CRM v0.2 package material is present and was inspected:

- Architecture docs: `web-cleanops/docs/architecture/request-crm/00-index.md` … `30-anti-patterns.md` (31 files)
- ADRs: `web-cleanops/docs/adr/ADR-0001..ADR-0006` (6 files)
- UI specs: `web-cleanops/docs/ui/request-crm/01-request-crm-navigation-and-routes.md`, `02-filter-sort-spec.md`, `03-request-detail-layout.md`
- JSON schemas: `web-cleanops/schemas/request-crm/` — `request-automation-candidate.schema.json`, `request-domain-event.schema.json`, `request-feature-flag.schema.json`, `request-mock-entity.schema.json`, `request-settings-shell.schema.json`
- Mock/seed data: `web-cleanops/mock-data/request-crm/` — `request-categories`, `request-types`, `request-list`, `request-detail`, `request-dashboard`, `notifications`, `chat-sessions`, `domain-events`, `automation-candidates`, `settings-shell`, `feature-flags`, `runtime-safety-mock` (12 `*.seed.json` files)
- TypeScript contracts: `web-cleanops/contracts/typescript/request-crm/request-crm-contracts.ts`
- RORK prompts / review gates: `web-cleanops/rork/request-crm/00_START_HERE.md` … `05_REQUEST_CRM_IMPLEMENTATION_PLAN_REVIEW_CHECKLIST.md` + provenance under `_package/`
- Automation & AI Center integration **standard**: captured inside the REQUEST CRM package — `25-automation-ai-center-alignment.md`, `26-runtime-safety-performance-alignment.md`, `ADR-0002`, `ADR-0004`, `ADR-0006`, plus contracts `AutomationQuickReview` / `RuntimeSafetyMockStatus` and seeds `automation-candidates.seed.json` / `runtime-safety-mock.seed.json`.

### Documentation findings (gaps / conflicts / deviations)

- **External package not in-repo (important):** There is **no standalone "Automation & AI Center Runtime Safety v3" architecture package folder** anywhere in `web-cleanops` (no `automation*/`, `ai-center*/`, or `runtime-safety*/` directory; broad search returns only REQUEST CRM references). The canonical index (`00-index.md`) and `docs/00-master-index.md` (line ~171) explicitly state it is the single source of truth and must be **treated as an external dependency**. The **integration standard** REQUEST needs for planning is present (docs 25/26 + ADRs + contracts + schemas + seeds), so this is recorded as a **documentation/dependency note**, not a planning blocker. See §15 (Risks) R-1.
- **Superseded docs handled correctly:** `docs/architecture/requests/00-requests-index.md` and `01-request-management-architecture.md` carry explicit "SUPERSEDED by REQUEST CRM v0.2" markers. The master index also marks the older `33-request-management-architecture.md` family as superseded. No conflicting canonical duplicate exists.
- **Legacy AI notes:** `docs/architecture/ai/00-ai-overview.md` … `05-ai-agent-actions-future.md` predate this package and describe an AI assistant concept. They are not part of REQUEST CRM v0.2 and should be reconciled later; for Slice 0, treat REQUEST CRM docs 11/12 as authoritative for chat/AI intake.
- **No path deviations:** the package layout matches the intake request exactly (architecture / adr / ui / schemas / mock-data / contracts / rork). No file had to be moved to write this plan.

---

## A. Current repo findings

The target app is `web-cleanops` — a Vite + React 18 + TypeScript SPA (react-router-dom v6, Tailwind, shadcn/ui under `src/components/ui/`). Files inspected and the observations that shape this plan:

- **Routing — `src/App.tsx` (450 LOC).** One flat `<BrowserRouter><Routes>` tree. Every authenticated screen is wrapped in `<ProtectedRoute requirePermission="x" allow={[roles]}>`. Dynamic groups are produced by mapping a registry (e.g. `CHECKLIST_SETTINGS_MODULES.map(... <Route/> )`) and by `/modules/:moduleId` → `ModulePage`. `SmartRoute` renders a public view for visitors vs. an app view for authed users; `PublicOnly` bounces authed users away from auth pages. Provider order: `QueryClientProvider` → `AppProvider` → `TooltipProvider` → `BrowserRouter` → `ErrorBoundary`.
- **Roles & permissions — `src/types/index.ts`, `src/lib/permissions.ts`.** `UserRole = "super_admin" | "company_admin" | "employee" | "customer"`. Permissions are string keys `"<module>.<action>"` built by `buildModule(id, label, desc, actions[])` into `PERMISSION_MODULES`; `DEFAULT_ROLE_PERMISSIONS` maps role → keys. `PermissionAction` includes `view|create|edit|delete|archive|approve|assign|manage|access`. `useApp().hasPermission(key)` is the gate used by `ProtectedRoute` and nav.
- **Global state — `src/context/AppContext.tsx` (~7k LOC).** Single large context-hook via `AppProvider` / `useApp()`. Already exposes an **audit trail** (`auditEvents`, writes carry `actorRole`, super-admin sees all) — REQUEST audit events should append here rather than invent a parallel log. Server state uses `@tanstack/react-query` (`QueryClient` at the root).
- **Navigation — `src/components/layout/DashboardLayout.tsx`.** Role-aware sidebar built from `NavItem { label, to, icon, permission }` grouped into sections; `src/components/navigation/PageMenuTiles.tsx` renders tiled sub-navigation; `src/components/settings/NavigationMenuPanel.tsx` configures menu visibility. A CRM section is added by introducing one new nav group gated by a permission + flag.
- **Settings — `src/pages/Settings.tsx` + ~44 `src/components/settings/*Panel.tsx`.** Settings is a panel host. The closest precedent for a "shell of future config tabs" is `src/lib/checklistSettingsModules.ts`: a typed registry (`{ id, path, title, description, placeholder, icon }`) mapped to placeholder routes `/settings/checklists/:module` rendered by `src/pages/settings/ChecklistSettingModule.tsx`. **The Settings shell (§J) should copy this exact registry-driven placeholder pattern.**
- **Feature flags — `src/lib/featureFlags.ts` (800+ LOC).** Canonical pattern: each flag is an exported `const` boolean read from `import.meta.env.EXPO_PUBLIC_*` via `envFlag()` (default **OFF**) or `cutoverFlag()` (ON in app builds, OFF under vitest). Heavy JSDoc per flag, instant data-free rollback by env flip. **REQUEST CRM flags must follow this file/pattern and default OFF.**
- **Tests — `vitest.config.ts`, `src/test/setup.ts`, colocated `*.test.tsx`/`*.test.ts`.** jsdom + `@testing-library/react`, `ResizeObserver`/`matchMedia` stubbed. Tests are colocated next to source (e.g. `Settings.menu-tiles.test.tsx`, `pages/admin/*.test.tsx`). Flags intentionally behave differently under `MODE === "test"`. **Slice 0 follows colocated RTL conventions.**
- **Persistence authority — `docs/00-project-operating-mode-and-test-data-policy.md` + `supabase/` (76 migrations, edge `functions/`).** Supabase is the source of truth; localStorage is legacy/cache/fallback only. **New domains must not introduce local-first authority, local mirrors, or offline queues.** App is in **test-data-only** mode; test entities must be marked `TEST`/`DEMO`/`QA`/`CTSE`/`example.test`. Protected domains (Booking Queue, WorkOrders/service rows, Mission Log, Time Reporting) must not change unless explicitly in scope.
- **Contracts already shipped — `contracts/typescript/request-crm/request-crm-contracts.ts`.** `RequestStatus`, `RequestPriority`, `RequestSeverity`, `ActorType`, `ThreadType`, `RequestListItem`, `RequestDomainEvent` (carries `isTestData`/`testBatchId`), `AutomationQuickReview`, `RuntimeSafetyMockStatus`. Slice 0 types should extend these, not redefine them.
- **Mock data lives outside `src` — `mock-data/request-crm/*.seed.json`.** Vite only bundles assets imported from `src`. Slice 0 needs an in-`src` fixture layer (`src/lib/requestCrm/mockData/`) that mirrors these seeds (or a typed loader), so the shell can import them without changing build config.

**Net:** the repo already provides every primitive REQUEST CRM needs — permission registry, route guard, audit log, react-query, a registry-driven settings-shell precedent, and a documented feature-flag convention. The plan reuses them rather than introducing new infrastructure.

---

## B. Proposed route / page structure

Placement decision: the CRM is an **internal admin operations surface** (Request Manager, Notification Center, Chat intake, Settings). It is **not** a customer/employee portal in Slice 0 (`27-slice-0-frontend-shell.md` forbids external exposure). Therefore it belongs under **shared admin** routes available to `super_admin` **and** `company_admin`, gated by a new permission plus the master feature flag — mirroring how `/customers`, `/schedule`, `/teams` are guarded today.

Nested routes under `/crm` (package target IA from `27-slice-0-frontend-shell.md` and `ui/request-crm/01`):

| Route | Screen | Guard (Slice 0) |
|---|---|---|
| `/crm` | redirect → `/crm/dashboard` | flag + `requests.view` |
| `/crm/dashboard` | CRM dashboard shell | flag + `requests.view` |
| `/crm/requests` | Request list | flag + `requests.view` |
| `/crm/requests/:id` | Request detail (3-column) | flag + `requests.view` |
| `/crm/notifications` | Notification Center shell | flag + `requests.view` |
| `/crm/chat` | Chat inbox shell | flag + `requests.view` |
| `/crm/chat/:sessionId` | Chat session shell | flag + `requests.view` |
| `/crm/settings` | Settings shell (tabbed) | flag + `requests.settings.view` |

Conventions to keep:
- Register routes in `src/App.tsx` exactly like existing admin routes: `<ProtectedRoute allow={["super_admin","company_admin"]} requirePermission="requests.view">`.
- Gate the whole group behind `ENABLE_REQUEST_CRM_FRONTEND_SHELL` (new flag, default OFF) so an unflipped build renders nothing new — like the `ENABLE_USER_CREATION` conditional route already in `App.tsx`.
- Add one CRM nav group in `DashboardLayout.tsx` (`{ label: "Requests / CRM", to: "/crm/dashboard", icon: Inbox, permission: "requests.view" }`), only visible when the flag is on.

---

## C. Frontend component architecture

Proposed structure under `src/` (Slice 0 — presentation + mock data only):

```text
src/pages/crm/
  CrmDashboard.tsx            // KPI/exception cards from request-dashboard.seed
  RequestList.tsx            // table + read-only filters (ui/request-crm/02 spec)
  RequestDetail.tsx          // 3-column orchestrator (ui/request-crm/03 spec)
  NotificationCenter.tsx     // list + status chips
  ChatInbox.tsx              // session list + transcript pane
  CrmSettings.tsx            // tabbed settings shell host

src/components/crm/
  shell/        CrmLayout.tsx, CrmNav.tsx, MockDataNotice.tsx
  request/      RequestTable.tsx, RequestRow.tsx, RequestFilters.tsx,
                RequestDetailInternalColumn.tsx,   // left: posts/tasks/notes/AI summary/phone
                RequestDetailThreadsColumn.tsx,     // middle: customer/employee/shared/internal/ai_intake tabs + recipient preview
                RequestDetailMetaColumn.tsx         // right: status/priority/severity/SLA/owner/links/snooze/lock + quick-review
  posts/        InternalPostList.tsx, InternalTaskCard.tsx, TaskAcknowledgementChips.tsx
  threads/      ThreadTabs.tsx, ThreadMessageList.tsx, MessageComposer.tsx (disabled in Slice 0), RecipientPreview.tsx
  notifications/ NotificationList.tsx, NotificationRow.tsx, NotificationStatusBadge.tsx
  chat/         ChatSessionList.tsx, ChatTranscript.tsx, ChatStateBadge.tsx
  settings/     CrmSettingsTabs.tsx, CrmSettingRow.tsx (read-only row from settings-shell.seed)
  automation/   AutomationQuickReviewCard.tsx, AIExtensionStatusBadge.tsx, RuntimeSafetyMockBadge.tsx
  badges/       RequestStatusBadge.tsx, PriorityBadge.tsx, SeverityBadge.tsx,
                RequestOwnerBadge.tsx, ThreadVisibilityBadge.tsx, LinkedObjectChip.tsx, EmptyState.tsx
```

- Shared badge/quick-review components match the list in `ui/request-crm/01`.
- The 3-column detail is a CSS grid (`md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_320px]`) that stacks on small screens; build with shadcn primitives already in `components/ui/`.
- `AutomationQuickReviewCard` / `RuntimeSafetyMockBadge` are **display-only**, rendering `AutomationQuickReview` / `RuntimeSafetyMockStatus` from the contracts file with a visible "source of truth: Automation & AI Center" link-out.
- All write affordances (composer, snooze, lock, acknowledge) render **disabled** with a "mock / Slice 0" tooltip.

---

## D. Data / domain model proposal (logical only — NO migrations now)

Logical entities from `05-domain-model.md`, with proposed future physical tables. All tenant-scoped (`company_id`) to match the multi-company model, all carrying `is_test_data` + `test_batch_id` for the test-data policy, Supabase-authoritative (no localStorage authority).

| Logical entity | Future table | Key columns (proposal) |
|---|---|---|
| Request | `requests` | id, request_number, company_id, title, description, category_id, subcategory_id, status, priority, severity, owner_admin_id, customer_id, source, source_event_id, linked_chat_session_id, sla_due_at, requires_attention, is_locked, handled_by_owner_only, is_system_locked_thread, closed_at, created_by_user_id, created_by_actor_type, timestamps |
| RequestCategory | `request_categories` | id, company_id, name, is_system, default_owner_strategy, default_priority, default_sla_minutes, email_policy, visibility_policy_id, `automation_policy_ref` (nullable, **external ref**), `ai_extension_ref` (nullable, **external ref**), active |
| RequestType | `request_types` | id, company_id, category_id, name, is_system, default_priority/severity, active |
| RequestThread | `request_threads` | id, request_id, type (`customer\|employee\|shared_customer_employee\|internal\|ai_intake`), participant scope |
| RequestMessage | `request_messages` | id, thread_id, actor_type, author_id, body, external_visibility (immutable post-send), created_at |
| InternalPost | `internal_posts` | id, request_id, post_type (`task\|phone_call\|note\|ai_summary\|system_note`), body, due_at?, status |
| InternalPostAssignee | `internal_post_assignees` | id, post_id, assignee_id, assignment_role, ack_state, unread_state |
| Notification | `notifications` | id, company_id, type, severity, status (`unread\|read\|acknowledged\|handled\|dismissed`), linked_object_type/id, created_at |
| ChatSession | `chat_sessions` | id, company_id, state, customer_id?, summary, transcript_ref, linked_request_id? |
| AIActionLog | `ai_action_logs` | id, request_id?, kind, mock_status, **central_proposal_ref** (nullable), created_at |
| RequestSnooze | `request_snoozes` | id, request_id, scope (`personal\|global`), snoozed_by, until_at, reason |
| AccessRequest | `access_requests` | id, request_id, requested_by, state (`pending\|approved\|denied\|expired\|overridden`), decided_by?, decided_at? |
| RequestReadState | `request_read_states` | id, request_id, user_id, last_read_at |
| EmailOutboxJob | `email_outbox_jobs` | id, request_id, thread_id, status, attempts, last_error (later phase) |
| DomainEvent | `request_domain_events` | id, type, source_module, company_id, linked_object_type/id, correlation_id, payload_json, is_test_data, test_batch_id, created_at |

Notes:
- `automation_policy_ref`, `ai_extension_ref`, `central_proposal_ref` are **references into Automation & AI Center**, never local policy tables (`25-automation-ai-center-alignment.md`).
- Physical migration order is proposed in §N (later slices), not executed here.

---

## E. API / service boundary proposal

Boundaries follow `21-api-contract-candidates.md`, implemented later as Supabase edge functions under `supabase/functions/` (the repo's existing server surface) behind a `RequestCrmService` client seam in `src/lib/requestCrm/`. **In Slice 0 these are mock adapters returning fixtures — no network, no mutations.**

- `RequestService` — `GET/POST /requests`, `GET/PATCH /requests/{id}`, threads + messages, internal posts/comments/assignees/acknowledge, `snooze`, `handle-self`, `lock`, `access-requests` (+approve/deny).
- `NotificationService` — `GET /notifications`, `acknowledge|handle|dismiss|create-request`, `GET /notification-types`. **No local `/notification-rules` source of truth** — any future rule endpoint must proxy Automation & AI Center.
- `ChatService` — sessions, messages, `convert-to-request`, `admin-takeover`.
- `InternalAIService` — namespaced `/internal-ai/*` (classify, summarize, suggest-reply, create-request-draft, approve/reject-proposal). **Never call a provider route directly** (`ADR-0003`). Slice 0 ships a `MockAiAdapter`.
- `SettingsShellService` — read-only config reads for the settings shell.
- `DomainEventService` — append-only emit; events are **inputs** to Automation & AI Center, which owns evaluation (`17-event-driven-design.md`).
- `EmailOutboxService` — later phase only.

Client seam shape (proposal): `src/lib/requestCrm/services/*.ts` with a `MockRequestCrmService` (Slice 0) and a future `SupabaseRequestCrmService`, selected behind feature flags exactly like the Customers/WorkOrders repository seams already in the repo.

---

## F. Permissions / access strategy

Layered model per `16-security-permissions-audit.md`, mapped onto the repo's existing primitives:

- **RBAC (coarse)** — add a `requests` permission module via `buildModule("requests", "Requests / CRM", ..., ["view","create","edit","assign","manage","access"])` and a `requests.settings` view/manage pair, registered in `PERMISSION_MODULES` and granted to `super_admin` + `company_admin` in `DEFAULT_ROLE_PERMISSIONS`. `employee`/`customer` get nothing in Slice 0.
- **ABAC (request-specific)** — implement the `can_read_request(user, request)` resolver (doc §16) as a pure function `src/lib/requestCrm/access/canReadRequest.ts` taking owner, support membership, category assignment, participant relationship, locked/handled-self/sensitivity, and override policy. Pure + unit-tested; **no enforcement wired in Slice 0** (mock data already pre-resolved).
- **Locked request → metadata-only preview** — list/detail render a `LockedRequestPreview` (number, title, category, masked body) + a disabled "Request access" button.
- **Access workflow** — `AccessRequest` state machine (`pending→approved|denied|expired|overridden`) modeled in types now; UI is mock in Slice 0.
- **Super admin override** — allowed only `if policy.allow_superadmin_override` and **always audited** (reuse `AppContext` audit with `actorRole`).
- **Customer/employee visibility separation** — enforced at the thread layer (§7): customer and employee threads never cross by default; composer shows a recipient preview before send.
- **Audit** — append REQUEST audit events (doc §16 list) into the existing audit trail rather than a new store.

---

## G. Event / domain-event strategy

REQUEST is an **event emitter**; Automation & AI Center owns evaluation (`17-event-driven-design.md`, `ADR-0002`).

- **Envelope** (already typed as `RequestDomainEvent` in the contracts file): `{ key, sourceModule, tenantId, linkedObjectType, linkedObjectId, correlationId?, payload, isTestData?, testBatchId?, createdAt }` — validated against `schemas/request-crm/request-domain-event.schema.json`.
- **Catalog** (doc §17): `request.created`, `request.customer_message_received`, `request.employee_message_received`, `request.status_changed`, `request.priority_changed`, `request.severity_changed`, `request.sla_due_soon`, `request.sla_overdue`, `request.snoozed`, `request.auto_unsnoozed`, `request.handle_self_enabled`, `request.owner_inactive_detected`, `request.locked`, `request.access_requested`, `request.access_request_expired`, `request.emergency_created`, `internal_task.assigned`, `internal_task.acknowledged`, `internal_task.comment_created`, `chat.ai_unable_to_resolve`, `chat.converted_to_request`, `notification.acknowledged`, `notification.handled`, `email.delivery_failed`.
- **Becoming automation candidates without an engine:** each event maps to a **read-only** `request-automation-candidate.schema.json` record (Trigger → Condition → Risk → Guard → Runtime flag → Log → Alert → Resolution, per doc §25). Slice 0 ships these as `automation-candidates.seed.json` fixtures rendered in the quick-review panel. REQUEST performs the resulting domain mutation only after **central** policy approval — never inline.

---

## H. Notification Center v1 plan

Owns notification **objects + UI only**, never a rule engine (`10-notification-center.md`, `ADR-0004`).

- **Object model:** `Notification { id, type, severity, status, linkedObjectType/id, title, body, createdAt }`.
- **Types:** `information | prio | emergency | access_request | ai_recommendation | system_warning` + configurable labels.
- **Status model:** `unread → read → acknowledged → handled → dismissed`.
- **Behavior:** acknowledge / handle / dismiss are explicit user actions; opening a list never auto-acknowledges. "Create request from notification" pre-fills a request draft and links the source object.
- **Linked-object behavior:** clicking a `LinkedObjectChip` deep-links to the request/customer/employee/booking/work_order/invoice.
- **Stays future Automation & AI Center responsibility:** trigger registration, condition policy, risk level, runtime flag, guard action, AI extension, execution/incident logs, approval policy. The Notification Center may **display** status but must not **decide** creation.
- **Slice 0:** render `notifications.seed.json`; all status transitions are local mock/disabled.

---

## I. Chat + mock-AI plan

Chat v1 is structured intake, not autonomous resolution (`11-chat-ai-intake.md`, `12-ai-layer-internal-service.md`, `ADR-0003`).

- **Session states:** `open → ai_handling → waiting_for_admin → admin_takeover → converted_to_request → closed`.
- **Mock AI:** `MockAiAdapter` returns scripted clarifying questions + a structured summary (subject, summary, suggested category/priority, suggested tasks). No provider, no key, no network.
- **Create request from chat:** "convert to request/draft" carries subject, summary, transcript, suggested category/priority/tasks and links the session; allow conversion into an **existing** request to avoid duplicates.
- **Admin takeover:** placeholder button + state badge only in Slice 0.
- **Transcript/summary:** stored on the session, linked to the request on conversion.
- **Future AI extension linkage:** real provider arrives only as an **AI extension registered in Automation & AI Center** behind `enable_ai_provider_openai` / `enable_ai_suggestion_mode`; `AIActionLog` cross-references the central proposal/execution record.
- **Slice 0:** `chat-sessions.seed.json` only.

---

## J. Settings shell plan

A **shell**, not a rule builder (`28-settings-shell.md`, `18-settings-configuration.md`). Reuse the repo's `checklistSettingsModules` registry precedent.

- **Implementation pattern:** a typed `REQUEST_CRM_SETTINGS_TABS` registry (`{ id, path, title, description, status, icon }`) → routes under `/crm/settings/:tab` rendered by a single `CrmSettingModule` placeholder host, exactly like `CHECKLIST_SETTINGS_MODULES` → `ChecklistSettingModule`.
- **Tabs:** Request Categories, Request Types, Status/Priority/Severity, SLA Defaults, Visibility Defaults, Internal Post Types, Email Policy, Notification Type Labels, AI Policy Placeholders, Automation & AI Center Links, Runtime Safety Links.
- **Each row shows (read-only):** name/key, scope, status (`planned | mock | active later`), local domain effect, central automation key (if any), risk-level candidate, AI extension candidate, requires-approval candidate, feature flag — sourced from `settings-shell.seed.json` and validated by `request-settings-shell.schema.json`.
- **Prohibited:** visual rule builder, hidden rule persistence, live automation/AI toggles, production runtime-guard toggles. All controls render **disabled** with an implementation-status label.

---

## K. Feature flag plan

Add to `src/lib/featureFlags.ts` using the existing `envFlag()` convention (default **OFF**, `EXPO_PUBLIC_*`, JSDoc + rollback note per flag). Proposed exports (names map to `20-feature-flags.md` candidates):

- Shell/master: `ENABLE_REQUEST_CRM_FRONTEND_SHELL`, `ENABLE_REQUEST_CRM_SETTINGS_SHELL`, `ENABLE_REQUEST_CRM_AUTOMATION_QUICK_REVIEW`
- Platform/domain: `ENABLE_REQUEST_PLATFORM`, `ENABLE_REQUEST_MANAGER`, `ENABLE_NOTIFICATION_CENTER`, `ENABLE_CHAT`
- AI: `ENABLE_AI_MOCK`, `ENABLE_AI_PROVIDER_OPENAI`, `ENABLE_AI_SUGGESTION_MODE`, `ENABLE_AI_AUTO_CREATE_REQUEST`
- Email: `ENABLE_EMAIL_OUTBOUND`, `ENABLE_EMAIL_INBOUND_REPLY`
- Behavior: `ENABLE_REQUEST_SNOOZE`, `ENABLE_REQUEST_HANDLE_SELF`, `ENABLE_LOCKED_REQUESTS`, `ENABLE_EMERGENCY_POPUP`
- Exposure/test: `ENABLE_TEST_MODE`, `ENABLE_REQUEST_EXTERNAL_CUSTOMER_EXPOSURE`, `ENABLE_REQUEST_EXTERNAL_EMPLOYEE_EXPOSURE`

Slice 0 renders **mock/static** flag state only (no production runtime-flag enforcement, per doc §20). Real kill-switch/runtime-flag enforcement is Automation & AI Center's, never local.

---

## L. Test strategy

vitest + RTL, colocated, jsdom (matches `src/test/setup.ts`). Slice 0 test targets:

- **Frontend shell render** — each `/crm/*` page mounts behind its flag; renders nothing when the flag is OFF.
- **Mock-data rendering** — fixtures load and map to types from the contracts file without runtime errors.
- **List/detail navigation** — clicking a row routes to `/crm/requests/:id`; back returns to filtered list.
- **3-column layout** — all three columns present on desktop; stacks on narrow viewport.
- **Visibility indicators** — `ThreadVisibilityBadge` + `RecipientPreview` show correct copy per thread type; customer/employee threads never merge.
- **Notification shell** — status chips render; transitions are mock/disabled.
- **Chat shell** — session states + transcript render; takeover is placeholder.
- **Settings shell** — tabs render disabled rows with status labels.
- **Feature-flag behavior** — flag OFF hides routes/nav; ON reveals shell.
- **Pure access resolver** — `canReadRequest` unit tests (owner/support/category/locked/override).
- **Guard tests (negative):** no live automation executes; no external customer/employee exposure; no runtime-guard enforcement; no network/mutation calls from Slice 0 adapters.

---

## M. Seed / mock-data strategy

- **Authoring source:** the package seeds in `mock-data/request-crm/*.seed.json` (validated by `schemas/request-crm/*.schema.json`).
- **Runtime fixtures:** mirror them into `src/lib/requestCrm/mockData/` as typed modules (so Vite bundles them) — `requestCategories`, `requestTypes`, `requestList`, `requestDetail`, `requestDashboard`, `notifications`, `chatSessions`, `domainEvents`, `automationCandidates`, `settingsShell`, `featureFlags`, `runtimeSafety`. Keep a one-line note that the package JSON is the spec and the `src` modules are the importable copy.
- **Test-data discipline:** every fixture entity marked `isTestData: true` + a shared `testBatchId` (e.g. `RC-DEMO`), names use `TEST`/`DEMO`/`QA` (operating-mode policy). No real names/emails/addresses.
- **Isolation:** fixtures imported only by `/crm/*` and only when the shell flag is ON; never touch Booking Queue / WorkOrders / Mission Log / Time Reporting stores.

---

## N. Implementation slices

**Slice 0 — Frontend shell + mock data only (first approved build).**
Includes: CRM nav entry, dashboard shell, request list shell, request detail 3-column shell, notification center shell, chat inbox shell, settings shell, automation/AI + runtime-safety quick-review placeholders, feature-flag gating, mock data, documentation links.
Excludes (hard non-goals — `27-slice-0`, `26-runtime-safety`, `30-anti-patterns`): live backend automation, real AI provider, production notification engine, production email outbox, inbound email, real rule engine, real runtime guards / kill switches / circuit breakers, customer/employee external release, irreversible domain mutations, production migrations.
Exit criteria: full shell navigable, mock data renders consistently, every section visibly aligns to Automation & AI Center, no hidden automation, frontend behind flag, mock data isolated.

Later slices (build order from `22-implementation-phases.md`):
1. **Domain schema** — `requests`, categories/types, audit, feature-flag + test-mode tables (Supabase migrations, RLS).
2. **Request core** — create/list/open, metadata, 3-column admin wiring.
3. **Threads & visibility** — customer/employee/shared/internal threads + recipient preview + immutable external visibility.
4. **Internal posts/tasks** — task posts, assignees, comments, acknowledgement + read state.
5. **Notification Center v1** — objects + status + create-request-from-notification (central-ready, no local rule engine).
6. **Chat v1 + mock AI** — sessions, mock AI, convert-to-request, transcript summary.
7. **Snooze / handle-self / locked requests** — list filtering vs. work allocation vs. access control kept separate; access-request workflow + audit.
8. **Email outbound** — outbox jobs + delivery states (flagged).
9. **AI provider suggestion mode** — provider as a centrally-registered AI extension; suggestion-only.
10. **Inbound email reply** — inbound parsing/threading.
11. **Hardening / regression** — telemetry for central runtime-guard visibility, performance, accessibility, full regression.

---

## O. Risk and blocker review

- **R-1 (dependency/doc):** The standalone **Automation & AI Center Runtime Safety v3 package is not present in-repo**; only its integration standard is (REQUEST CRM §25/§26 + ADRs + contracts + seeds). Planning is safe because the package is explicitly an external dependency and the alignment contract is sufficient. **Mitigation:** treat as external; when that package lands, re-verify `automation_policy_ref` / `ai_extension_ref` / `runtimeFlagRef` shapes against its real registry before any wiring slice. Not a Slice 0 blocker.
- **R-2 (architecture):** Hidden automation creep — REQUEST accidentally deciding actions (auto-unsnooze, escalation, notification creation). **Mitigation:** ADR-0002/0004/0006 boundary; Slice 0 ships only display-only quick-review; no engine.
- **R-3 (access/visibility):** Customer/employee thread leakage or premature external exposure. **Mitigation:** thread-type separation + recipient preview; `ENABLE_REQUEST_EXTERNAL_*` flags OFF; Slice 0 admin-only.
- **R-4 (persistence authority):** Violating Supabase-authority by introducing localStorage state for the new domain. **Mitigation:** Slice 0 is read-only fixtures in `src`; later slices use Supabase + RLS via the existing repository-seam pattern; no local-first authority.
- **R-5 (runtime safety):** Implementing rate limiting / kill switches / circuit breakers locally. **Mitigation:** doc §26 — display mock badges only; enforcement is central.
- **R-6 (data cleanup):** Test fixtures leaking into real flows. **Mitigation:** `isTestData`/`testBatchId` markers, isolated imports, `ENABLE_TEST_MODE`.
- **R-7 (repo blockers):** `App.tsx` is a single flat route file and `AppContext.tsx` is very large; careless edits risk regressions. **Mitigation:** additive routes/nav behind a flag, isolated `src/pages/crm` + `src/lib/requestCrm` trees, colocated tests; reuse existing audit/permission/flag seams rather than modifying core flows.
- **R-8 (doc reconciliation):** Legacy `docs/architecture/ai/*` and superseded `requests/*` could confuse future agents. **Mitigation:** REQUEST CRM v0.2 is canonical; superseded markers already present; reconcile AI notes in a later slice.

### Open questions (for Sebastian / ChatGPT — not blocking Slice 0)
1. Confirm CRM lives under **shared admin** (`super_admin` + `company_admin`) and is hidden from `employee`/`customer` in Slice 0.
2. Confirm route base `/crm` (vs. embedding under an existing admin namespace).
3. When will the **Automation & AI Center Runtime Safety v3** package be added to the repo so refs can be validated (R-1)?
4. Confirm the new permission keys `requests.*` / `requests.settings.*` and their default role grants.
5. Confirm super-admin override default (`policy.allow_superadmin_override`) for locked requests.

---

## P. Recommended next prompt (Slice 0 implementation — send only after this plan is approved)

```text
Implement REQUEST CRM Slice 0 — frontend shell with mock data only. Planning is approved
(see web-cleanops/docs/architecture/request-crm/implementation-plan.md and 27-slice-0-frontend-shell.md).
Do NOT implement backend, migrations, live AI, live automation, notification/email runners, or runtime guards.

Scope (web-cleanops, all behind feature flags defaulting OFF):
1. Feature flags — add to src/lib/featureFlags.ts using the existing envFlag() pattern (default OFF, EXPO_PUBLIC_*, JSDoc + rollback note):
   ENABLE_REQUEST_CRM_FRONTEND_SHELL, ENABLE_REQUEST_CRM_SETTINGS_SHELL, ENABLE_REQUEST_CRM_AUTOMATION_QUICK_REVIEW.
2. Permissions — add a "requests" module via buildModule() in src/lib/permissions.ts (view/create/edit/assign/manage/access) plus requests.settings.view/manage; grant to super_admin + company_admin in DEFAULT_ROLE_PERMISSIONS.
3. Routes — register /crm, /crm/dashboard, /crm/requests, /crm/requests/:id, /crm/notifications, /crm/chat, /crm/chat/:sessionId, /crm/settings(/:tab) in src/App.tsx with <ProtectedRoute allow={["super_admin","company_admin"]} requirePermission="requests.view">, the whole group gated by ENABLE_REQUEST_CRM_FRONTEND_SHELL (mirror the ENABLE_USER_CREATION conditional route).
4. Nav — add a "Requests / CRM" group in src/components/layout/DashboardLayout.tsx (NavItem { label, to:"/crm/dashboard", icon, permission:"requests.view" }), visible only when the flag is on.
5. Pages + components — build the shell under src/pages/crm/ and src/components/crm/ per the plan's §C tree: CRM dashboard, request list + read-only filters (ui/request-crm/02), request detail 3-column (ui/request-crm/03: internal | threads | metadata), notification center, chat inbox, settings shell. Use shadcn/ui primitives. All write affordances render disabled with a "mock" tooltip.
6. Settings shell — copy the CHECKLIST_SETTINGS_MODULES registry pattern: a typed REQUEST_CRM_SETTINGS_TABS registry → /crm/settings/:tab placeholder pages rendering read-only rows from the settings-shell fixture.
7. Quick-review — AutomationQuickReviewCard, AIExtensionStatusBadge, RuntimeSafetyMockBadge are DISPLAY ONLY, rendering AutomationQuickReview/RuntimeSafetyMockStatus from contracts/typescript/request-crm/request-crm-contracts.ts, with a visible "source of truth: Automation & AI Center" note. No enforcement.
8. Mock data — mirror mock-data/request-crm/*.seed.json into typed modules under src/lib/requestCrm/mockData/ (so Vite bundles them); every entity isTestData:true + testBatchId "RC-DEMO". Reuse the shipped types from the contracts file; do not redefine them.
9. Tests — colocated *.test.tsx (vitest + RTL): routes hidden when flag OFF / shown when ON; fixtures render; list→detail navigation; 3-column present on desktop & stacks narrow; thread visibility copy; settings tabs render disabled; canReadRequest pure unit tests; negative guards (no network/mutation, no external exposure).

Constraints: additive only — do not modify Booking Queue, WorkOrders/service rows, Mission Log, Time Reporting, or other existing flows. No localStorage authority for the new domain. Keep everything behind the flags. After coding, run runChecks({ appPath: "web-cleanops" }) and fix all TypeScript/lint/build/test failures before finishing.
```

---

## Appendix — Files expected to be created / modified in Slice 0 (forecast, not done here)

- New: `src/pages/crm/*`, `src/components/crm/**`, `src/lib/requestCrm/**` (services mock adapters, access resolver, mockData), `src/lib/requestCrmSettingsTabs.ts`, colocated `*.test.tsx`.
- Modified (additive, flag-gated): `src/App.tsx` (routes), `src/components/layout/DashboardLayout.tsx` (nav), `src/lib/featureFlags.ts` (flags), `src/lib/permissions.ts` (permission module), `src/lib/permissions` default-role grants.
- Untouched: all existing domain flows, Supabase migrations, protected operational domains.
