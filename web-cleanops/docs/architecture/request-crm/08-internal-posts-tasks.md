# 08 - Internal Posts and Tasks

## Product rule

The internal area must function as a mini task system. Do not reduce it to plain notes.

## Post types

- task (hard-coded)
- phone_call
- note
- ai_summary
- system_note
- configurable future types

## Task requirements

Task posts require:

- assignees
- assignment role
- status
- comments
- acknowledgement state per assignee
- unread state per assignee
- due_at optional

## Acknowledgement rule

Opening the request must not automatically acknowledge internal tasks. Admin must open/click the relevant post/task.

## Notification rule boundary

A task comment can create a notification. The trigger is emitted by REQUEST, but automated notification policy must be compatible with Automation & AI Center.
