# CleanOps Core Operations Build Specification v1.0

## Purpose

This document defines how the operational core of CleanOps is intended to function.

This document translates the architectural principles defined in:

* 00-master-index.md
* 01-project-constitution.md

into concrete operational behavior.

This is not:

* database design
* API design
* UI design
* implementation details

This is the operational specification that future development should follow.

---

# Operational Core

The operational core of CleanOps consists of:

* Schedule
* Mission
* Assignment
* Mission Log
* Operations Center
* Requests
* Keys

These modules together form the operational workflow of the platform.

---

# Core Operations Loop

The primary operational loop is:

Schedule
→ Mission
→ Assignment
→ Ready
→ Execution
→ Mission Log
→ Decision
→ Follow-up
→ Closed

Future development must preserve this workflow.

---

# Mission

## Purpose

Mission is the central operational object of CleanOps.

A Mission represents a specific piece of work intended to be executed.

Mission is the primary object used for:

* execution
* follow-up
* quality
* operational decisions
* historical analysis

## Mission Principles

Mission is the operational truth container.

Operational activity should be traceable to a Mission whenever possible.

Mission is not:

* a schedule rule
* a request
* a customer
* an agreement

Mission connects these objects.

---

# Schedule

## Purpose

Schedule represents planned work.

Schedule defines what should happen.

Mission represents what actually becomes operational work.

## Schedule Principles

Schedule is planning.

Schedule is not operational truth.

Schedule may generate Missions.

Schedule may be changed without changing historical Mission outcomes.

---

# Assignment

## Purpose

Assignment defines operational responsibility.

Every Mission should have a responsible resource.

## Assignment Principles

Assignments affect readiness.

Missing Assignment may prevent a Mission from becoming Ready.

Assignments must remain traceable.

---

# Ready

## Definition

Ready means:

Operationally executable under known conditions.

## Ready Requirements

Typical requirements include:

* Mission exists
* Assignment exists
* Resource available
* Required access available
* Required instructions available
* No blocking operational issue exists

## Ready Blocking Conditions

Examples:

* Missing Assignment
* Key Missing
* Resource Unavailable
* Missing Access Instructions
* Critical Operational Conflict

A Mission may be Planned without being Ready.

---

# Execution

## Purpose

Execution represents operational work being performed.

Execution begins when a Mission moves into active work.

Execution may result in:

* Completed
* Partially Completed
* Blocked
* Failed

---

# Mission Log

## Purpose

Mission Log records operational reality.

Mission Log represents what actually happened.

## Mission Log Principles

Important operational events should be traceable.

Examples:

* status changes
* decisions
* comments
* customer contact
* follow-ups
* access issues
* key issues
* resource changes

Mission Log forms the foundation for future reporting, analytics and AI.

---

# Requests

## Purpose

Requests represent operational changes, needs or issues.

Examples:

* Customer Change Request
* Complaint
* Extra Service
* Internal Request
* Access Issue

## Request Principles

Requests must remain traceable.

Requests should not disappear into comments.

Requests may create, modify or affect Missions.

---

# Keys

## Purpose

Keys represent operational access requirements.

Access is an operational dependency.

## Key Principles

If access is unavailable:

Mission may not be Ready.

Key issues should be visible to operational management.

Key events should be logged.

---

# Operations Center

## Purpose

Operations Center is the primary operational decision surface.

Its purpose is to surface:

* risks
* blockers
* decisions
* exceptions
* follow-ups

## Operations Center Principles

Operations Center should show actionable items.

Operations Center should not become a generic dashboard.

Each surfaced issue should indicate:

* affected object
* responsible owner
* required action

---

# Completed

## Definition

Completed means:

The work has been performed.

Completed does not automatically mean operational closure.

---

# Closed

## Definition

Closed means:

No further operational action is required.

## Typical Closure Requirements

Examples:

* outcome documented
* follow-up completed
* review completed
* complaint resolved
* required evidence provided

Completed is not equivalent to Closed.

---

# Complaints

## Principle

Complaints represent operational quality concerns.

Open complaints may prevent closure.

Complaint handling must remain traceable.

---

# AI Governance

## AI May

* analyze
* summarize
* recommend
* detect patterns

## AI May Not

* cancel Missions
* close complaints
* override policies
* remove critical operational blockers

Human accountability remains mandatory.

---

# Non-Negotiable Rules

The following rules are mandatory:

* Mission is the operational center.
* Schedule is planning.
* Mission Log is operational reality.
* Ready is not Planned.
* Completed is not Closed.
* Requests are first-class objects.
* Key Missing may block Ready.
* Complaints may block Closed.
* Operations Center is a decision surface.
* AI does not replace operational responsibility.

---

# Development Guidance

Future implementation should prioritize:

1. Mission Foundation
2. Mission Log
3. Ready Validation
4. Operations Center
5. Requests
6. Keys

Future features should integrate into the operational core rather than bypass it.
