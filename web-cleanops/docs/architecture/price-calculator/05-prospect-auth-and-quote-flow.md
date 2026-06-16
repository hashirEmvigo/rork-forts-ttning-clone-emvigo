# Prospect, Auth and Quote Flow Architecture

**Audience:** RORK / GPT-5.5 High  
**Project:** CleanOps / Stadportalen / Price Calculator  
**Instruction level:** Treat this as implementation guidance for repository analysis, architecture validation, and phased build planning. The human project owner does not need explanatory simplification. Be precise, conservative, and repo-grounded.

---
## Prospect concept

A prospect is a person or organization that has submitted interest/quote data but is not yet an active customer.

The system should support a user/customer status such as:

```text
prospect
active_customer
inactive_customer
```

Use existing role/status naming if already present.

## Quote submission flow

On quote request submission:

1. Validate request.
2. Resolve company from public calculator config.
3. Recalculate trusted price.
4. Find existing prospect/customer by company + email if appropriate.
5. Create prospect if none exists.
6. Create quote request.
7. Store answer snapshots.
8. Store pricing snapshot.
9. Set quote status.
10. Present quote-created/login prompt.

## Recommended quote statuses

```text
draft
submitted
pending_review
ready_for_customer
viewed
accepted
rejected
expired
converted
```

MVP may use a smaller subset:

```text
submitted
pending_review
ready_for_customer
```

## Login handoff

Preferred UX:

- Visitor submits quote request.
- Page switches to quote-created state.
- System offers magic-link login or existing login route.
- Visitor can view quote in portal after authentication.

Do not force manual account creation with password in the initial MVP if current auth supports magic links.

## Existing user handling

If the email already belongs to an existing customer/prospect within the same company:

- Attach quote request to existing profile.
- Do not duplicate customers blindly.
- Preserve tenant boundary.

If the email exists in another company:

- Do not leak existence.
- Create/associate only within the current company according to existing multi-tenant identity model.

## CRM preparation

The quote/prospect records may include:

- `source = price_calculator`
- `source_url`
- `campaign_source`
- `prospect_status`
- `quote_status`

Do not build CRM UI now.
