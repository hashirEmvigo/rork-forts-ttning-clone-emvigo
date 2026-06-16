# CleanOps Project Constitution v1.0

## Purpose

This document defines the non-negotiable architectural principles for CleanOps.

All future development, design decisions and implementations must remain compatible with this constitution.

If a proposed implementation conflicts with this document:

STOP.

Report the conflict before implementation.

---

# Vision

CleanOps is an operations platform for service businesses.

The platform must support real operational work rather than merely documenting it.

CleanOps exists to help organizations:

- Plan work
- Execute work
- Handle deviations
- Make operational decisions
- Improve continuously

---

# Core Objects

The core operational objects are:

- Customer
- Object
- Agreement
- Schedule
- Mission
- Assignment
- Request
- Key
- Mission Log

Future modules must integrate with these objects rather than replace them.

---

# Locked Architecture Decisions

## Mission is the operational center

Mission is the primary operational object.

Operational activities should be traceable to a Mission whenever possible.

---

## Schedule is plan

Schedule represents intended work.

Schedule is not operational truth.

---

## Mission Log is reality

Mission Log represents what actually happened.

Statistics, reporting and future AI analysis must primarily rely on Mission Log.

---

## Ready is not Planned

A Mission may be planned without being Ready.

Ready means:

Operationally executable under known conditions.

---

## Completed is not Closed

Completed means work was performed.

Closed means no further operational action is required.

---

## Request is a first-class object

Requests must remain traceable.

Requests may influence Missions.

Requests must not disappear into comments or schedule changes.

---

## Keys affect readiness

If a Mission requires access and access is unavailable:

Mission cannot be Ready.

---

## Complaints affect closure

Open complaints may block Mission closure.

---

## Operations Center is a decision surface

Operations Center exists to highlight:

- Risks
- Decisions
- Exceptions
- Follow-ups

It is not a generic dashboard.

---

# Development Principles

## Build vertically

Prefer complete end-to-end workflows over isolated technical components.

---

## Build from real scenarios

All functionality should be justified through operational use cases.

---

## Protect the operations loop

The operational loop is:

Schedule
→ Mission
→ Assignment
→ Ready
→ Execution
→ Mission Log
→ Decision
→ Follow-up

Future development must not break this flow.

---

## Avoid hidden complexity

Prefer explicit rules over implicit behavior.

Prefer traceability over automation.

---

# AI Governance

AI may:

- Analyze
- Summarize
- Recommend
- Detect patterns

AI may not autonomously:

- Cancel Missions
- Reassign critical work
- Close complaints
- Remove critical flags
- Override operational policies

Human accountability remains mandatory.

---

# Constitution Compliance

All future architecture, backlog items and implementations must be evaluated against this constitution.

This document has precedence over feature-specific design decisions.
