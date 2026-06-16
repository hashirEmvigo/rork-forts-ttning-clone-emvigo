# UI - Filter and Sort Specification

## Request list filters

- status
- category
- owner
- support admin
- priority
- severity
- SLA state
- source
- customer
- employee
- linked object type
- has unread external message
- has unacknowledged internal task
- snoozed state
- handled-by-owner-only
- locked/access state
- AI suggestion available
- automation action linked
- test data

## Request list sorting

- updated_at desc
- created_at desc
- SLA due asc
- severity desc
- priority desc
- unread first
- unassigned first

## Notification filters

- severity
- status
- type
- linked object type
- assigned group
- assigned admin
- requires action
- source module
- automation action key
- created_at range

## Chat filters

- status
- actor type
- assigned admin
- linked request state
- AI mode
- last message at
- waiting for admin

## Settings filters

- active/planned/mock
- module
- risk level candidate
- AI extension candidate
- central automation linked/unlinked
- feature flag

Slice 0 should implement these as mock/static UI controls where possible. They do not need live backend query semantics yet.
