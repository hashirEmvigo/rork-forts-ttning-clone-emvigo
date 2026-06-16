# Schedule Module UX Architecture

## Status

Draft v2 for UX / product / technical review.

Phase 0 cleanup status: target UX architecture only. This document does not authorize route changes, UI implementation, repository changes, Booking Queue sync or runtime behavior changes.

## Owner

Product / Admin Scheduling / UX

## Review Target

RORK

## Related Documents

- `/docs/architecture/schedule/00-schedule-index.md`
- `/docs/architecture/schedule/01-schedule-module-architecture.md`
- `/docs/architecture/schedule/02-service-level-scheduling-packages.md`

## Scope

Schedule workspace UX only.

This document defines the future `/schedule` user experience for manual scheduling, schedule review, employee filtering, planning queue handling, unassigned assignment docking, drag-and-drop planning, forward preview and multi-week schedule navigation.

It does not define the database schema or deterministic scheduling engine. Those are defined in `01-schedule-module-architecture.md`.

Current implementation context:

- The current app uses Work Orders, WorkOrder service rows, Booking Queue, Schedule Core and occurrence exceptions.
- The Planning Queue described here is a future schedule workspace UX concept and must not treat Booking Queue as final schedule authority while Booking Queue remains mixed/mirror-based.
- Drag-and-drop and recurring preview patterns are documentation-only until the validation engine and data authority are approved.

---

# 1. UX Goal

The Schedule Module should behave as a dedicated planning workspace, not as a normal subpage inside the main application layout.

Scheduling is a heavy operational workflow. The admin needs to:

- review several employees at once
- compare days and weeks
- identify unassigned work
- drag assignments into available slots
- filter employees
- combine employee filters with schedule status filters
- switch between compact overview and timeline views
- preview future recurring availability
- mark schedules as reviewed/ready
- work efficiently on both smaller screens and ultrawide monitors

The UX must prioritize operational control, visibility and fast manual planning.

---

# 2. Dedicated Schedule Workspace

When the user enters:

```text
/schedule
```

or the production route:

```text
stadportalen.se/schedule
```

the app should switch to a dedicated Schedule Workspace layout.

This layout should replace the normal main sidebar with a schedule-specific sidebar.

There must be a clear back action:

```text
<- Till huvudmeny
```

This pattern may later be reused for other heavy modules such as:

- invoicing
- material management
- support center
- development center
- AI automation
- payroll/export workflows

---

# 3. High-Level Layout

Recommended layout:

```text
+--------------------------------------------------------------+
| Schedule Workspace                                           |
+----------------+---------------------------------------------+
| Module Sidebar | Main Schedule Canvas                        |
|                |                                             |
| Search         | Toolbar                                     |
| View toggle    | Date/week navigation                        |
| Status filter  | Period selector                             |
| Employee list  | Schedule grid                               |
| Planning queue | Optional planning queue dock                |
| Dock controls  | Inline recurring preview                    |
+----------------+---------------------------------------------+
```

The sidebar is a control panel.

The main canvas is the planning surface.

---

# 4. Schedule Module Sidebar

The module sidebar should not contain generic navigation items such as:

```text
Schema
Medarbetare
Obokade uppdrag
Konflikter
```

Those should be removed from this workspace sidebar. The page itself is already the Schedule workspace.

The sidebar should act as a scheduling control center.

Recommended sidebar structure:

```text
<- Till huvudmeny

SCHEMA

[Sök kund, kundnr, adress eller medarbetare]

Vy
[Översikt] [Tidslinje]

Schemastatus
[Alla] [Att hantera] [Klara]

Medarbetare
[Alla] [Ingen] [Nollställ]
[x] Anna
[x] Bertil
[x] Hansson
[x] Lars
[x] Tobias
[x] Manne

Planeringskö (13)
[Alla] [Abonnemang] [Enstaka]

> Vecka 5 (4)
> Vecka 6 (2)
> Vecka 7 (3)
> Vecka 8 (4)

[Ladda fler veckor]

Visa planeringskö i schema
( ) Dölj
( ) Vänster
(x) Top
( ) Botten
```

---

# 5. Search

The search field should be global for the Schedule Workspace.

It should support searching by:

- employee name
- customer name
- customer number
- address
- assignment number / AO number
- service type
- possibly phone/email later

Search behavior should support both:

1. filtering visible results
2. jumping/highlighting the relevant schedule row, customer or assignment

Placeholder:

```text
Sök kund, kundnr, adress eller medarbetare
```

---

# 6. View Switcher

The module should support at least two schedule views.

Recommended labels:

```text
Översikt
Tidslinje
```

## 6.1 Overview View

Purpose:

- compact planning overview
- employee rows
- day/date columns
- assignments stacked inside each employee/day cell
- no strict vertical time axis
- best for weekly and multi-week overview

Structure:

```text
Anställd | Måndag | Tisdag | Onsdag | Torsdag | Fredag
Anna     | Kund 1 | Kund 2 | Kund 3 | Kund 4  | Kund 5
         | Kund 2 |        |        |         |
         | Kund 3 |        |        |         |
Lars     | Kund 1 |        | Kund 2 |         | Kund 3
Harald   |        | Kund 1 | Kund 2 | Kund 3  |
```

Assignments inside a cell should be stacked vertically.

Example:

```text
Anna / Måndag

08:00-10:00 Customer A
10:30-12:30 Customer B
13:30-15:30 Customer C
```

This is the default view for most planning work.

## 6.2 Timeline View

Purpose:

- detailed day/time planning
- time axis visible on the left
- assignments positioned according to actual time
- useful for drag-and-drop and daily route optimization

Structure:

```text
Tid     Anna       Bertil      Hansson      Lars
07:00
08:00   Job A      Job B
09:00
10:00   Restid     Job C
11:00
12:00   Rast
13:00   Job D
```

Important:

The time axis should appear in timeline/drag-and-drop contexts, not in compact overview mode.

---

# 7. Date and Period Navigation

The top toolbar should provide clear date navigation.

Recommended compact toolbar:

```text
[<-] Vecka 5 · 27 jan - 2 feb 2025 [->] [Idag]

Period: [Denna vecka v]
Vy: [Översikt] [Tidslinje]
[Filter] [Skapa bokning]
```

For multi-week view:

```text
[<-] Vecka 5-6 · 27 jan - 9 feb 2025 [->] [Idag]
Period: [2 veckor v]
```

The week label must remain clear even when the selected period includes several weeks.

---

# 8. Period Presets

The period selector should support:

```text
Valfri period
Idag
Imorgon
Denna vecka
Nästa vecka
2 veckor
3 veckor
4 veckor
Denna månad
30 dagar framåt
```

Internal model:

```ts
type SchedulePeriodPreset =
  | 'custom'
  | 'today'
  | 'tomorrow'
  | 'current_week'
  | 'next_week'
  | 'two_weeks'
  | 'three_weeks'
  | 'four_weeks'
  | 'current_month'
  | 'rolling_month';
```

Rules:

```text
Idag:
start = today
end = today

Imorgon:
start = tomorrow
end = tomorrow

Denna vecka:
start = Monday of current week
end = Sunday of current week

Nästa vecka:
start = Monday of next week
end = Sunday of next week

2 veckor:
start = Monday of current anchor week
end = Sunday after 2 weeks

3 veckor:
start = Monday of current anchor week
end = Sunday after 3 weeks

4 veckor:
start = Monday of current anchor week
end = Sunday after 4 weeks

Denna månad:
start = first day of current month
end = last day of current month

30 dagar framåt:
start = current anchor date or today
end = start + 30 days
```

For 2/3/4-week presets, the start date must always be Monday of the current anchor week.

---

# 9. Week Navigation

The schedule should always show the current week clearly.

Examples:

```text
Vecka 5
27 jan - 2 feb 2025
```

or:

```text
Vecka 5-6
27 jan - 9 feb 2025
```

There should be navigation buttons:

```text
<- previous week
-> next week
```

Recommended behavior:

- navigation arrows move the anchor date by one week
- the selected period preset remains active

Example:

```text
Preset: 2 weeks
Current range: Week 5-6

Click next:
New range: Week 6-7

Click next again:
New range: Week 7-8
```

This gives the admin controlled navigation instead of jumping the full period length.

---

# 10. Schedule Status Filter

The schedule status filter should be separate from the employee filter but combinable with it.

Recommended UI:

```text
Schemastatus
[Alla] [Att hantera] [Klara]
```

Meaning:

```text
Alla:
show all matching employee rows/assignments

Att hantera:
show schedules, employees or assignments that require review

Klara:
show schedules marked as reviewed/ready
```

This filter must combine with the employee list.

Example:

```text
Schemastatus = Att hantera
Selected employees = Anna, Lars, Manne
```

Result:

```text
Show only Anna, Lars and Manne where schedule status matches "Att hantera".
```

The status filter must not be treated as an employee selector.

Recommended internal model:

```ts
type ScheduleStatusFilter =
  | 'all'
  | 'pending_review'
  | 'ready';
```

Optional future state:

```ts
type SchedulePlanningStatus =
  | 'pending_review'
  | 'ready'
  | 'locked';
```

Important:

```text
Klar = reviewed by admin
Låst = locked against normal editing
```

These should not be treated as identical long term.

---

# 11. Employee Filter

The employee filter should allow admins to control visible rows.

Recommended UI:

```text
Medarbetare
[Alla] [Ingen] [Nollställ]

[x] Anna
[x] Bertil
[x] Hansson
[x] Lars
[x] Tobias
[x] Manne
```

Behavior:

```text
Alla:
select all employees

Ingen:
deselect all employees

Nollställ:
restore default employee selection
```

The employee filter must combine with:

- search
- schedule status
- active period
- active view

---

# 12. Planning Queue

The Planning Queue represents unassigned or unresolved assignments.

Recommended label:

```text
Planeringskö
```

or:

```text
Obokade uppdrag
```

The sidebar section should show:

```text
Planeringskö (13)
[Alla] [Abonnemang] [Enstaka]

> Vecka 5 (4)
> Vecka 6 (2)
> Vecka 7 (3)
> Vecka 8 (4)

[Ladda fler veckor]
```

The queue should initially load a limited number of weeks, for example 4 weeks.

Each click on:

```text
Ladda fler veckor
```

loads 4 additional weeks.

---

# 13. Planning Queue Week Expansion

Weeks should be collapsible.

Collapsed:

```text
> Vecka 5 (4)
```

Expanded:

```text
v Vecka 5 (4)

  Måndag (1)
    - Customer A
      Home cleaning · 3h · Preference: morning

  Tisdag (0)

  Onsdag (2)
    - Customer B
      Subscription · 4h · Not placed
    - Customer C
      One-off · 2h · Flexible

  Torsdag (1)
    - Customer D
      Window cleaning · 2h

  Fredag (0)

  [Visa lördag/söndag]
```

Saturday and Sunday should be hidden by default, with an optional expand button:

```text
Visa lördag/söndag
```

---

# 14. Planning Queue Assignment Cards

Each unassigned assignment card should show the minimum data needed for scheduling.

Recommended content:

```text
Customer name
Service type
Duration
Assignment type: Abonnemang / Enstaka
Preferred week
Customer preference
Status / reason
```

Example:

```text
Familjen Berg
Hemstädning · 3h
Abonnemang · v.5
Preferens: ons/fre 08-15
```

Optional badges:

```text
Ny
Konflikt
Saknar tid
Saknar medarbetare
Hög prioritet
```

---

# 15. Docking the Planning Queue into the Schedule

The Planning Queue should not only exist in the sidebar.

The admin should be able to dock unassigned assignments directly into the schedule workspace.

Recommended dock settings:

```text
Visa planeringskö i schema
( ) Dölj
( ) Vänster
(x) Top
( ) Botten
```

Important UX rule:

> Only one dock position may be active at a time.

This is a display preference, not a business rule.

Reason:

- laptop users may prefer top or hidden
- ultrawide users may prefer left
- some users may prefer bottom
- different admins will work differently

The choice should be saved as a per-user preference.

---

# 16. Dock Position: Top

Top mode displays unassigned assignments as a sticky row at the top of the schedule canvas.

Example:

```text
Planning Queue / Obokade uppdrag

[Customer A · 3h] [Customer B · 2h] [Customer C · 4h]
```

This row should appear below the main toolbar and below the day/date header.

It should remain sticky when scrolling vertically through employee rows.

Recommended behavior:

```text
Toolbar: sticky
Date/day header: sticky
Planning queue top dock: sticky
Employee rows: scrollable
```

Top mode is a good default for most users.

For ultrawide users, a 2-week view with top dock can show a broad planning horizon while keeping unassigned work visible.

---

# 17. Dock Position: Left

Left mode displays unassigned assignments in a docked column inside the schedule canvas.

This is useful on ultrawide screens.

Example:

```text
Unassigned jobs | Employee | Monday | Tuesday | Wednesday | ...
Customer A      | Anna     | ...
Customer B      | Lars     | ...
Customer C      | Manne    | ...
```

Advantages:

- excellent for ultrawide monitors
- keeps unassigned jobs close to employee rows
- useful when dragging horizontally into schedule cells

Risk:

- consumes horizontal space
- less suitable on smaller screens

---

# 18. Dock Position: Bottom

Bottom mode displays unassigned assignments in a docked row at the bottom.

Example:

```text
Employee schedule
...
--------------------------------------
Planning Queue
[Customer A] [Customer B] [Customer C]
```

Advantages:

- less visual interference
- useful when admin primarily reviews schedule first
- good for compact layouts if sticky behavior is carefully designed

Risk:

- less visible during vertical scrolling
- may require sticky bottom behavior

---

# 19. Overview Grid Design

The overview view should use employee rows and day/date columns.

Recommended structure:

```text
Employee | Mon 27 Jan | Tue 28 Jan | Wed 29 Jan | Thu 30 Jan | Fri 31 Jan
Anna     | Job 1      | Job 2      | Job 3      | Job 4      | Job 5
Lars     | Job 1      |            | Job 2      |            | Job 3
Harald   |            | Job 1      | Job 2      | Job 3      |
```

Inside each cell:

```text
08:00-10:00
Customer name
Address
Service type
Status badge
```

Multiple bookings should stack vertically inside the same employee/day cell.

Example:

```text
Anna / Monday

08:00-10:00 Customer 1
10:30-12:30 Customer 2
13:30-15:30 Customer 3
```

The bookings should not be forced into one single horizontal row in overview mode.

---

# 20. Alternating Day Column Backgrounds

To improve readability, day columns should use subtle alternating background colors.

Example:

```text
Monday: white
Tuesday: light gray
Wednesday: white
Thursday: light gray
Friday: white
```

The contrast should be subtle enough to preserve the clean visual style.

Recommended theme tokens:

```text
white: #FFFFFF
subtle: #F8FAFC
```

The purpose is to make it easier to distinguish Monday, Tuesday, Wednesday, Thursday and Friday, especially on ultrawide screens and multi-week views.

---

# 21. Multi-Week Overview

When the user selects 2 weeks, the schedule should show two weeks horizontally.

Example:

```text
Week 5                                      Week 6
Mon Tue Wed Thu Fri Sat Sun                 Mon Tue Wed Thu Fri Sat Sun
```

For ultrawide screens, this is useful because the user can see a larger planning horizon without leaving the overview.

The week boundary should be visually clear.

Recommended:

- vertical divider between weeks
- week label above day headers
- date span in toolbar
- alternating day backgrounds

Example toolbar label:

```text
Vecka 5-6
27 jan - 9 feb 2025
```

---

# 22. Weekend Handling

For weekly and multi-week views, Saturday/Sunday should be supported but not always emphasized.

Options:

```text
Show Monday-Friday by default
Allow weekend toggle
Show weekend when assignments exist
Show weekend for custom periods
```

Recommended MVP behavior:

- Monday-Friday visible by default in ordinary weekly planning
- Saturday/Sunday visible when selected period explicitly includes weekends or when weekend toggle is enabled
- planning queue can show weekend via `Visa lördag/söndag`

For 2-week ultrawide views, weekend columns may be visible if there is enough width or if the user has enabled weekend visibility.

---

# 23. Assignment Card UX

Assignment cards in the schedule should be compact but informative.

Recommended content:

```text
Time
Customer name
Address
Service type
Status badge
Optional icon/color
```

Example:

```text
08:00-10:00
Familjen Berg
Storgatan 12, Malmö
Hemstädning · 2h
Klar
```

Cards should use light color coding by service type or status.

Example service colors:

```text
Hemstädning: green
Kontorsstädning: blue
Fönsterputs: purple
Flyttstädning: orange
Trappstädning: yellow
```

Status badges:

```text
Klar
Att hantera
Konflikt
Obokad
Låst
```

---

# 24. Rest Time and Travel Time

In overview mode, rest/travel time can be shown as compact inline chips or small separator rows inside a day cell.

Example:

```text
08:00-10:00 Customer A
Restid 20 min
10:30-12:30 Customer B
Rast 30 min
13:00-15:00 Customer C
```

In timeline mode, rest/travel should align to the time axis.

Important:

Rest/travel should be visually distinct from customer assignments.

Recommended visual style:

```text
Restid: light neutral chip with car icon
Rast: light orange/neutral chip with break icon
```

---

# 25. Drag-and-Drop Behavior

Drag-and-drop should support:

- dragging from planning queue into schedule cell
- dragging between employee/day cells
- dragging within the same employee/day
- moving assignment between days
- moving assignment between employees
- timeline positioning in timeline view

When dropping an unassigned assignment into a schedule slot, the system should trigger validation/preview before final commit.

UX states:

```text
Valid drop target
Warning drop target
Blocked drop target
Requires preview
```

Drop result should not silently commit complex recurring assignments without validation.

---

# 26. Recurring Slot Preview

When the admin clicks a free slot or attempts to place a recurring assignment, the UI should support an inline recurring slot preview.

Purpose:

Distinguish between:

- free this week
- free for one-off
- free for recurring
- future conflict
- future conflict with solvable variation
- blocked recurring slot

Recommended interaction:

Admin clicks an employee/day cell.

An inline preview row opens directly below that employee row without leaving the schedule grid.

Example:

```text
Anna / Onsdag - Kontrollera plats framåt

[4v] [8v] [12v] [26v]

V.3 Onsdag   Ledig
V.4 Onsdag   Ledig
V.5 Onsdag   Endast engång
V.6 Onsdag   Krock, lösbar
V.7 Onsdag   Ledig
V.8 Onsdag   Ledig

Konflikt:
Kund X, var fjärde vecka, onsdag 10:00-14:00

Förslag:
Flytta Kund X till torsdag 13:00-17:00 med Anna
```

The preview should not remove the user from the main schedule context.

---

# 27. Inline Preview Actions

Recommended actions:

```text
Boka återkommande
Boka engång
Visa alternativ
Visa konfliktinfo
Stäng
```

Preview states:

```text
Green:
free for recurring

Yellow:
future conflict, solvable

Orange:
requires admin decision

Red:
blocked

Blue:
one-off only
```

---

# 28. Sticky Behavior

The following elements should be sticky where practical:

```text
Main toolbar
Date/day header
Top-docked planning queue
Employee name column
```

For large schedules, sticky behavior is important so the admin does not lose context while scrolling.

Recommended:

- left sidebar fixed
- toolbar sticky
- date header sticky
- employee column sticky horizontally
- planning queue top dock sticky if enabled

---

# 29. Responsive Behavior

The UX must support both small screens and ultrawide screens.

## 29.1 Smaller screens

Recommended defaults:

```text
Planning queue dock: hidden or top
Sidebar collapsible
One-week view default
Timeline view may require horizontal scroll
```

## 29.2 Ultrawide screens

Recommended defaults:

```text
Planning queue dock: top or left
2-week view useful
More employee rows visible
More day columns visible
```

The dock position is intentionally user-selectable because users work on different screen sizes and have different planning habits.

---

# 30. Recommended Sidebar State Model

```ts
type ScheduleSidebarState = {
  searchQuery: string;

  activeScheduleView: 'overview' | 'timeline';

  scheduleStatusFilter:
    | 'all'
    | 'pending_review'
    | 'ready';

  selectedEmployeeIds: string[];

  assignmentTypeFilter:
    | 'all'
    | 'recurring'
    | 'one_off';

  loadedPlanningQueueWeeks: number;

  expandedPlanningQueueWeeks: string[];

  showWeekendInPlanningQueue: boolean;

  unassignedDockPosition:
    | 'hidden'
    | 'left'
    | 'top'
    | 'bottom';
};
```

---

# 31. Recommended Date Range State Model

```ts
type SchedulePeriodPreset =
  | 'custom'
  | 'today'
  | 'tomorrow'
  | 'current_week'
  | 'next_week'
  | 'two_weeks'
  | 'three_weeks'
  | 'four_weeks'
  | 'current_month'
  | 'rolling_month';

type ScheduleDateRangeState = {
  preset: SchedulePeriodPreset;
  anchorDate: Date;
  startDate: Date;
  endDate: Date;
};
```

---

# 32. Recommended UX Defaults

Initial recommended defaults:

```text
View:
Översikt

Period:
Denna vecka

Planning queue dock:
Top

Employee filter:
All selected

Schedule status:
All

Planning queue:
First 4 weeks loaded

Weekend:
Hidden unless assignments exist or user expands
```

For ultrawide users, the app may remember preference:

```text
Period: 2 weeks
Dock: Top or Left
View: Overview
```

User preferences should be persisted per user.

---

# 33. UX Risks

## Risk 1: Sidebar overload

The sidebar can become too long if too many employees and planning weeks are shown.

Mitigation:

- collapsible sections
- fixed search field
- employee list scroll area
- planning queue scroll area
- load more weeks button

## Risk 2: Too many "All" filters

There are multiple "All" options.

Mitigation:

Always label the section clearly:

```text
Schemastatus: Alla
Medarbetare: Alla
Planeringskö: Alla
```

## Risk 3: Planning queue dock confusion

Users may not understand left/top/bottom initially.

Mitigation:

Use clear label:

```text
Visa planeringskö i schema
```

Add tooltip:

```text
Välj var obokade uppdrag ska visas när du planerar med drag-and-drop.
```

## Risk 4: Multi-week view becomes crowded

A 2-week or 4-week view can become dense.

Mitigation:

- support horizontal scrolling
- keep employee column sticky
- allow compact card mode
- allow hidden details until hover/click
- use alternating day backgrounds
- show more detail in a side panel when clicked

---


---

# 34. Planning Mode UX

Planning Mode / Utkastläge should let admins test multiple schedule changes before publishing.

This remains documentation-only until the ScheduleChangeSet ADR is approved. Draft UX must not mutate committed schedule, Booking Queue, occurrence exceptions, Mission Log or Time Reporting.

Core UX elements:

- draft state indicator
- change basket / ändringskorg
- scenario summary before publish
- validation status for the whole change set
- reason-code suggestion/review
- customer communication summary

Example:

```text
Ändringar i utkast (7)
```

Publish review should summarize:

```text
Du har gjort 14 ändringar i vecka 5.

- 6 uppdrag flyttade till annan tid
- 3 uppdrag bytte medarbetare
- 2 återkommande kunder fick avvikelse
- 1 Premium/Priority-kund påverkades
- 2 konflikter löstes
```

Actions:

```text
[Godkänn föreslagna orsaker]
[Ange samma orsak för alla]
[Gå igenom manuellt]
[Spara utan AI-lärande]
```

---

# 35. Capacity and Compression UX

The schedule UX should surface capacity information without confusing free time and bookable time.

Daily header example:

```text
Måndag 27/1
Bokad 78%
Bokningsbart 14,5h
Ledigt 22h
```

Weekly summary example:

```text
Vecka 5 – Bokningsläge

Total kapacitet: 600h
Bokad kundtid: 462h / 77%
Operativt upptaget: 515h / 86%
Ledigt totalt: 85h
Bokningsbara luckor: 41h
Ej bokningsbara fragment: 44h
Komprimeringspotential: Hög
```

Compression entry point:

```text
[Komprimera]
```

Compression Mode should create scenarios, not directly change the schedule. It remains preview/scenario-only until the validation engine, ScheduleChangeSet ADR and occurrence-write policy are approved:

```text
Scenario A – Frigör mest kapacitet
Scenario B – Minst kundpåverkan
Scenario C – Bäst balans
```

Admin chooses a scenario and continues in Planning Mode.

---

# 36. Customer Preference and Temporary Exception Guidance UX

Customer preferences and temporary scheduling exceptions should appear as planning guidance.

Recommended surfaces:

- Customer Card: edit and manage preferences/exceptions.
- WorkOrderDetails: read-only guidance and warnings.
- Add Service Status Preview: non-blocking Customer fit / Employee fit.
- Schedule Workspace: warnings when planned work conflicts with active temporary exception.

Do not create manual service-row preference links.

Do not auto-move bookings from guidance alone.

Temporary Scheduling Exceptions are warnings/guidance only in the first implementation. They must not create occurrence exceptions, move WorkOrder service rows, write Booking Queue, mutate recurring series, affect Mission Log or affect Time Reporting.

---

# 37. MVP Recommendation

MVP should include:

1. Dedicated Schedule Workspace layout.
2. Schedule-specific sidebar.
3. Search field.
4. Overview / Timeline view toggle.
5. Period selector.
6. Week navigation arrows.
7. Schedule status filter.
8. Employee checklist filter.
9. Planning queue grouped by week.
10. Load more weeks button.
11. Planning queue dock position: hidden / left / top / bottom.
12. Only one dock position active at a time.
13. Top dock sticky behavior.
14. Overview grid with employee rows and day columns.
15. Alternating day column backgrounds.
16. Assignment cards with time, customer, address and service type.
17. Basic drag-and-drop visual states.
18. Timeline view with time axis for drag-and-drop/detail work.

Recurring slot preview can be included in MVP if the scheduling engine supports it. Otherwise, the UI should reserve space/pattern for it and implement it once validation is ready.

---

# 38. Key UX Principle

The Schedule Module should help admins answer:

```text
What is planned?
What is not planned?
Who is visible?
What needs review?
Where can I place this assignment?
Will this placement work beyond the current week?
```

The interface should not force users to leave the schedule view to answer these questions.

The combination of:

```text
dedicated module sidebar
multi-week overview
sticky planning queue
employee filters
status filters
recurring preview
```

creates a schedule workspace that supports both manual planning and future AI-assisted scheduling.

---

# 39. Review Questions for RORK

Please review with focus on:

1. How the dedicated `/schedule` workspace should be implemented in the current routing/layout system.
2. Whether module-specific sidebars already exist elsewhere and can be reused.
3. How to persist user preferences for view, period and dock position.
4. How the planning queue should query unassigned assignments.
5. How drag-and-drop should connect to validation/change-set flow.
6. Whether overview and timeline should share card components.
7. How to handle large employee lists and multi-week performance.
8. Whether recurring slot preview can be included in MVP or must wait for validation engine.
9. How this UX should be represented in Development Center/backlog.

RORK should return a UX implementation review and phased plan before coding begins.
