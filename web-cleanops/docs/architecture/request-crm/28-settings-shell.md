# 28 - Settings Shell

## Purpose

Settings shell gives visibility into future configuration without implementing full live logic too early.

## Tabs

- Request Categories
- Request Types
- Status / Priority / Severity
- SLA Defaults
- Visibility Defaults
- Internal Post Types
- Email Policy
- Notification Type Labels
- AI Policy Placeholders
- Automation & AI Center Links
- Runtime Safety Links

## Each settings row should show

- name/key
- scope
- status: planned | mock | active later
- local domain effect
- central automation key if applicable
- risk level candidate
- AI extension candidate
- requires approval candidate
- feature flag

## Prohibited in settings shell

- no visual rule builder
- no hidden rule persistence
- no live automation toggles
- no live AI tool permission mutations
- no production runtime guard toggles

## Recommended component behavior

Render disabled/read-only controls with clear implementation status. This creates a stable UX target without risky early backend commitments.
