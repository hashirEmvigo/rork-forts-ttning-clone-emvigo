# Navigation & Menu Design Standard

Status: Active design standard (Slice 11A)
Owners: Platform / Super Admin
Applies to: every navigation, tab, and menu surface in the CleanOps / Städportalen console.

This document is the single reference for how menus, tabs, and configuration
surfaces look and behave across the platform. It also defines the
**Navigation & Menu Registry** that lets Super Admin manage menu presentation
(label, icon, order, visibility) from Settings without code changes, and
prepares the platform for future multi-language support.

---

## 1. Menu design rules (tile menus)

The Customer Card menu is the reference pattern. Every "module / section" menu
should follow it:

- **Icon above, text below.** Each menu item is a vertical tile: an icon on top,
  a short label beneath it.
- **Equal tile sizes.** All tiles in a menu share the same width and height; a
  longer label never makes one tile taller or wider than its neighbours.
- **Consistent icon size.** One icon size and stroke weight per menu (default
  20–24px, 1.75–2px stroke). Icons never render at mixed sizes.
- **Selected / hover / disabled / warning states are consistent:**
  - Selected: filled accent background + accent foreground.
  - Hover: subtle accent tint.
  - Disabled: reduced opacity, no pointer, not focusable.
  - Warning: a small dot/badge or amber accent, never a full restyle.
- **Badges, counts and dots** sit on the top-right of the tile, use tabular
  numbers, and never push the label around.
- **Max label length.** Labels are short (ideally one or two words). Wrapping is
  allowed to a **two-line maximum** (max two lines); beyond that the label is
  truncated with an ellipsis.
- **Tooltip strategy.** When a label is truncated, the full label is available
  via tooltip (and via the collapsed-sidebar `title`).
- **No layout shift from long labels.** Tile dimensions are fixed by the grid,
  not by content, so long names can never distort the menu.
- **No inconsistent icon sizing** between tiles in the same menu.

## 2. Tab / section navigation rules

For pages with internal tabs (e.g. `/calculator`, Settings) tabs use **short
labels + an icon**. Avoid long sentence-like tab labels.

**Page-level tile menus (Slice 11D).** A page's primary module menu renders as
icon-above-label tiles (the §1 Customer Card pattern), via the shared
`PageMenuTiles` / `PageMenuTile` component (`components/navigation/`). It is
built on Radix Tabs, so it drives the existing `<TabsContent>` blocks unchanged
(tile `value` = tab id, label = accessible name, icon `aria-hidden`). Tiles are
fixed-width and wrap (no horizontal scroll, no ultrawide stretch). Applied to
the Settings tabs and Calculator tabs in this slice; the Customer Card menu
remains the canonical reference implementation. Compact, in-panel **filter**
buttons (e.g. the Navigation & Menus category selector) intentionally stay as
small buttons, NOT tiles.

Calculator rename direction (applied in this slice):

- Services & Fields → **Fields** / Fält
- Cleaning Plans → **Plans** / Upplägg
- Pricing Rules → **Pricing** / Priser
- Quote Settings → **Settings** / Inställningar
- Quote Requests → **Requests** / Förfrågningar
- Overview → **Overview** / Översikt

Exact labels follow the surface's language convention (admin console is English;
the public calculator is Swedish).

## 3. Wide-screen row rules

Configuration rows must never stretch label → value → action across a full
ultrawide width.

Bad (action disconnected from its value):

```
Base Hours                                            1,5 h            Edit
```

Good (label, value and action stay visually connected inside a constrained card):

```
Base Hours
1,5 h  [Edit]
```

The edit control belongs next to the value it edits, inside a card with a
reasonable max width — not pinned to the far screen edge.

## 4. Responsive grid rules

- **Mobile:** 1 column.
- **Tablet:** 1–2 columns.
- **Laptop:** 2 columns.
- **Large desktop:** 2–3 columns.
- **Ultrawide:** max 3 columns unless the content is genuinely tabular.

Avoid horizontal scroll except for real data tables.

## 5. Card vs table rules

Use **cards** for: settings, configuration, services, plans, fields, media
slots, customer/employee module tiles.

Use **tables** for: large lists, logs, invoice lines, quote-request lists,
reports.

## 6. Navigation registry rules

Menus are described by a central registry rather than ad-hoc text inside each
component. The registry separates three layers.

### Technical registry (stable internal truth — never user-editable)

```
menu_key          stable identity, e.g. "calculator.pricing"
route             where it goes, e.g. "/calculator"
section           in-page section/tab id, e.g. "pricing"
permission_key    authoritative gate, e.g. "calculator.manage"
default_icon      icon key from the controlled icon set
default_label     fallback label used when no custom label / translation
role_context      which roles the item is relevant to
```

### Customization layer (admin-editable presentation)

```
custom_label      optional Super-Admin override of the label
custom_icon       optional Super-Admin override of the icon (from the safe set)
sort_order        optional ordering override
is_visible        presentation-only show/hide
```

### Translation layer (future)

```
translation_key   stable key, e.g. "calculator.pricing", resolves to a
                  localized label per language; custom_label may override per scope
```

Each registry item therefore carries at minimum:

```
key · group · defaultLabel · translationKey · defaultIcon ·
permissionKey · route · section · sortOrder · roleContext · lockedTechnicalFields
```

## 7. Translation readiness

The registry is the foundation for future localization. A future language engine
resolves a label in this order:

1. `custom_label` override (per scope / language) if present, else
2. `translation_key` → localized string for the active language, else
3. `default_label` (fallback, never blank).

Stable keys (never the visible label) are the join point, e.g.:

```
main.dashboard
customer_card.contact
calculator.pricing
calculator.requests
```

Target languages the design must not block: `sv-SE`, `en-US`, `no-NO`, `da-DK`.
Example resolution for `customer_card.contact`: `sv-SE → "Kontakt"`,
`en-US → "Contact"`. No full translation engine is built in this slice — only the
key-based structure that makes it possible later.

## 8. Safety rules (permission remains authoritative)

Menu customization is **presentation only**. It can never grant or remove access.

- `route` is **not** editable.
- `permission_key` is **not** editable.
- `menu_key` / `module_key` is **not** editable.
- `role_context` is **not** editable.
- Hiding a menu item only removes it from the UI; the underlying route and its
  permission check are unchanged.
- A menu item marked visible still appears **only** if the user already holds the
  required permission. Visibility never bypasses a permission check.
- **The permission system remains authoritative** for all access decisions.
  Navigation settings are layered on top of permissions and are filtered by them.
- Company Admin cannot edit platform-level menu configuration in this slice.

---

## 9. Settings surface layout (Slice 11C)

The **Navigation & Menus** settings page is categorized — it must never show
every group expanded at once:

- **Language selector** (top): `English` is active; `Svenska`, `Norsk`, `Dansk`
  are shown disabled ("Soon"). This is presentation only — it advertises that
  the registry's stable `translationKey`s are the foundation for future
  localized labels. No translation engine is built yet.
- **Category selector**: compact buttons (NOT icon-above-text tiles) — one per
  registered group plus planned groups. Each carries a state badge:
  - **Live** — the group's overrides are consumed by the real UI.
  - **Registered** — in the registry/settings, not yet applied to the live UI.
  - **Coming soon** — planned, not yet in the registry (e.g. Employee Card).
- **Selected category only**: just the active category's item cards render
  (responsive grid: 1 col mobile, 2 cols `md`, 3 cols `2xl`). Planned categories
  render a "coming soon" placeholder.

Default selected category is the first registered group (Main Navigation).

## 10. Navigation surface inventory (Slice 11C)

| Surface | Component | Registry group | Consumes overrides? |
| --- | --- | --- | --- |
| Calculator tabs | `CalculatorControl.tsx` | `calculator` | Yes — label/icon/order/visibility (Slice 11A); icon-above-label tile menu via `PageMenuTiles` (Slice 11D) |
| Customer Card menu | `CustomerCard.tsx` | `customer_card` | Yes — label/icon/order/visibility (Slice 11B). Canonical tile reference; unchanged in 11D |
| Main sidebar | `DashboardLayout.tsx` | `main_navigation` | Yes — label/icon/visibility overlay (Slice 11C). Sort-order deferred (see below) |
| Settings tabs | `Settings.tsx` | — | Tile-standardized + short labels via `PageMenuTiles` (Slice 11D); registry migration still deferred |
| Shared tile component | `components/navigation/PageMenuTiles.tsx` | — | Reusable icon-above-label tile menu (Radix Tabs); consumed by Settings + Calculator (Slice 11D) |
| Employee detail menu | (employee pages) | — | Planned — "Employee Card" coming-soon category |
| Module/admin sub-tabs (work orders, invoices, media, checklist) | various | — | Deferred — migrate module-by-module later |

### Deferred (documented, not silently skipped)

- **Main sidebar sort order.** The sidebar is composed of curated, titled
  sections (Platform / Directory / Operations / Settings, plus a separate
  curated Company Admin layout). A global registry `sortOrder` would break that
  grouping, so the overlay applies label/icon/visibility only and preserves the
  existing section order. Cross-section reordering is a later, dedicated change.
- **Settings tabs & other module sub-tabs.** Settings tabs are now visually
  standardized to the tile pattern (Slice 11D), but their *registry* migration
  (consuming `navigation_menu_overrides`) is deferred to avoid a broad, risky
  rewrite in one slice. Other module sub-tabs (work orders, invoices, media,
  checklist) keep their current style and are migrated module-by-module later.

### Short Settings tab labels (Slice 11D)

Long Settings labels were shortened so tiles stay equal-sized and never distort:
Roles & Permissions → **Roles**, Module Categories → **Categories**,
Navigation & Menus → **Menus**, Audit Log → **Audit**, Entitlement Validation →
**Entitlements**, Customer / Employee Assignment → **Assignment**, Company Setup
→ **Setup**, Employee Settings → **Employees**. `Time Codes` and `Time` (Quick
Duration) intentionally keep distinct labels — both can appear for a Company
Admin, so collapsing either to a single "Time" would be ambiguous.

### Main-navigation overlay safety (Slice 11C)

The sidebar overlay is **presentation only** and intentionally NOT
permission-filtered: the sidebar runs its own permission gate first, then the
overlay (keyed by route) relabels / re-icons / hides matching items. A hidden
override only drops the item from the menu; the route + its permission check are
unchanged, and a "visible" override can never add an item the sidebar's
permission gate already removed. With no overrides every managed route keeps its
registry default, so the overlay is a visual no-op until customised, and a
failed/empty override fetch falls back to the default sidebar.

---

## 11. PageMenuTiles rollout (Slice 11E)

Slice 11E applies the Slice 11D `PageMenuTiles` tile standard (§1–2) to the
remaining **safe** page-level / in-page section menus. This is a **visual**
standardization only — no routes, permissions, business logic, DB, RLS, or
registry architecture changed, and none of these surfaces consume the
`navigation_menu_overrides` registry (registry consumption stays limited to
Calculator tabs, the Customer Card menu, and the Main sidebar).

### Inventory of page-level menus / tabs found

| Surface | Component | Kind | 11E action |
| --- | --- | --- | --- |
| Roles & Permissions sections | `roles/SuperAdminRolesView.tsx` | In-page section tabs | Refactored → `PageMenuTiles` |
| Settings → Services sections | `settings/ServicesPanel.tsx` | In-page section tabs | Refactored → `PageMenuTiles` |
| Super Admin → Services sections | `superadmin/Services.tsx` | In-page section tabs | Refactored → `PageMenuTiles` |
| Checklist Libraries sections | `modules/ChecklistLibraries.tsx` | In-page section tabs | Refactored → `PageMenuTiles` |
| Checklist Templates sections (company admin) | `modules/ChecklistTemplates.tsx` | In-page section tabs | Refactored → `PageMenuTiles` |
| Settings tabs | `Settings.tsx` | Page tabs | Already tiles (Slice 11D) |
| Calculator tabs | `superadmin/CalculatorControl.tsx` | Page tabs | Already tiles (Slice 11D) + registry |
| Customer Card menu | `admin/CustomerCard.tsx` | Module menu | Canonical reference + registry |
| Work Order detail tabs | `admin/WorkOrderDetails.tsx` | In-page tabs | Deferred (see below) |
| Media Center tabs | `media/*` | In-page tabs | Deferred (see below) |
| Checklist route sub-nav | `checklist/ChecklistTabs.tsx` | Route-level links | Not a tile menu (see below) |
| Compact filters / segmented / status controls | various | Filter / status | Intentionally NOT tiles |

### Refactored in this slice

All five render the shared icon-above-label tile menu via `PageMenuTiles`, keep
their existing tab `value`s / content / order, and preserve every status badge,
counter and access gate:

- **Roles & Permissions** (`SuperAdminRolesView.tsx`) — `roles-section-tiles`.
- **Settings → Services** (`ServicesPanel.tsx`) — `services-panel-tiles`.
- **Super Admin → Services** (`superadmin/Services.tsx`) — `services-menu-tiles`.
- **Checklist Libraries** (`ChecklistLibraries.tsx`) — `library-menu-tiles`.
- **Checklist Templates** (`ChecklistTemplates.tsx`, company-admin view only —
  the Super Admin keeps the global grid) — `template-menu-tiles`.

### Label-shortening decisions (Slice 11E)

- Roles: Role Templates → **Templates**, Company Assignments → **Companies**,
  Permission Matrix → **Matrix**, Assigned Users → **Users**.
- Checklist Libraries: Room Library → **Rooms**, Cleaning Task Library →
  **Tasks**.
- Already short, kept as-is: Services panel (**Catalog**, **Packages**,
  **Import / Export**), Super Admin Services (**Catalogue**, **Companies**,
  **History**, **Billing**), Checklist Templates (**My Templates**,
  **Available**). Long labels clamp to two lines with the full text in the tile
  `title`, so none distort the fixed-size tiles.

### Deferred (documented, not silently skipped)

- **Work Order detail tabs** (`WorkOrderDetails.tsx`) — per-order tabs carry
  rich state (service rows, gates, counts) and route-critical behaviour; out of
  scope for this visual slice and migrated later.
- **Media Center tabs** — deferred to a later module-by-module pass.
- **Checklist route sub-nav** (`ChecklistTabs.tsx`) — this is route-level
  navigation (`<Link>`s across pages), not an in-page `<Tabs>` section menu, so
  it stays a compact link bar rather than a `PageMenuTiles` menu.
- **Compact filter / status / segmented controls** — e.g. the Library category
  chips, the Services Active/Archived and basis-type filters, the per-company
  Disabled/Trial/Enabled status toggle, and the Navigation & Menus category
  selector — intentionally remain compact buttons; tiles would be too heavy.

### PageMenuTiles usage guidance

Use `PageMenuTiles` for a page's **primary in-page section menu** that drives
`<TabsContent>`:

- Wrap the page in `<Tabs>`; render `<PageMenuTiles items={…} ariaLabel testId />`
  followed by one `<TabsContent value=…>` per item.
- Each `PageMenuTileItem` needs a stable `value` (matching its `TabsContent`), a
  short `label` (1–2 words), and a Lucide `icon`. Optional: `count` /
  `showZeroCount` (top-right badge), `isMissing` (red dot) / `needsAttention`
  (amber dot), `disabled`, `testId`.
- Selection, deep-linking and keyboard behaviour come from Radix Tabs for free;
  the icon is `aria-hidden` so the label stays the accessible name.
- **Do NOT** use it for compact filters, segmented/status controls, dropdowns,
  route-level sub-navigation, or wizard step indicators.
- Reuse the one shared component — do not fork per-surface tile menus. If a
  surface needs a new indicator, extend `PageMenuTile` reusably.

---

## Rollout

1. Establish this standard (done — Slice 11A).
2. Build the registry foundation + Super-Admin Navigation & Menus settings
   surface (Slice 11A).
3. Apply the registry to the Calculator tabs (Slice 11A), then the Customer Card
   menu (Slice 11B).
4. Categorize the Navigation & Menus settings page + add the future-ready
   language selector, and migrate the Main sidebar to consume label/icon/
   visibility overrides (Slice 11C). Settings tabs and other module sub-tabs are
   migrated module-by-module in later slices.
5. Build the shared `PageMenuTiles` component and apply it to the Settings and
   Calculator tabs (Slice 11D), then roll the tile standard out across the
   remaining safe page-level section menus — Roles, both Services surfaces, and
   the Checklist Libraries/Templates sections (Slice 11E). Work Order, Media
   Center, and other complex module tabs are deferred to later slices.
