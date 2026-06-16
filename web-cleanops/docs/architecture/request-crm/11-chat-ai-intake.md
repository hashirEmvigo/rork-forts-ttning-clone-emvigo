# 11 - Chat and AI Intake

## Goal

Chat is AI-first intake. The first implementation must focus on structured intake, summary and escalation, not autonomous resolution.

## Chat states

- open
- ai_handling
- waiting_for_admin
- admin_takeover
- converted_to_request
- closed

## AI cannot solve flow

1. Customer/employee starts chat.
2. Mock AI asks clarifying questions.
3. AI cannot solve within policy.
4. If admin is available, offer admin takeover.
5. Else create request draft or request according to policy.
6. Include subject, summary, transcript, suggested category, priority and suggested tasks.
7. Notify relevant category/group/owner through a centrally registered automation candidate.

## Request conversion

Chat transcript and summary must be linked to the request. Avoid duplicates by allowing conversion to an existing request when applicable.

## Slice 0

Only mock/static chat sessions and UI shell. No live AI, no provider, no real escalation runner.
