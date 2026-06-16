# 03 - Architecture Principles

## Single communication domain

Requests, chats, notifications and messages should share communication-domain primitives where practical. Avoid three disconnected systems.

## Request as container

A request is a container for threads, internal posts, tasks, system events, AI summaries and metadata.

## Event-driven core

Modules emit domain events. Rules and policies decide whether an event becomes a notification, dashboard item, internal task, request update, new request, AI proposal or no-op.

The policy decision must be centrally discoverable in Automation & AI Center.

## RBAC + ABAC

Use role-based access for coarse permissions and attribute-based access for owner, support, participant, category, lock state, tenant, sensitivity and source object context.

## Audit everything

Audit request changes, access decisions, message delivery, snooze, handle-self, locked request actions, AI proposals, notification actions, test data creation and cleanup.

## Mock-first AI

AI service must support mock outputs before a real provider is connected.

## Provider isolation

REQUEST must call Internal AI Service, not external AI providers directly.

## Outbox pattern

External delivery such as email should use an outbox/queue and not be sent directly inside request transactions.

## Feature flags

Every major feature must be togglable per environment, tenant and role where needed.

## No silent hiding

Snooze/hidden states must never hide unacknowledged, emergency or time-critical items from responsible actors.

## Automation & AI Center source-of-truth

REQUEST may emit events and implement domain mutations. Automation & AI Center owns central automation visibility, policy, runtime safety, AI extension and execution/incident history.
