# Frontend Component Architecture - Price Calculator

**Audience:** RORK / GPT-5.5 High  
**Project:** CleanOps / Stadportalen / Price Calculator  
**Instruction level:** Treat this as implementation guidance for repository analysis, architecture validation, and phased build planning. The human project owner does not need explanatory simplification. Be precise, conservative, and repo-grounded.

---
## Page components

Suggested structure, subject to existing repo conventions:

```text
src/pages/public/PublicPriceCalculatorPage.tsx
src/components/price-calculator/PriceCalculatorLayout.tsx
src/components/price-calculator/CalculatorStepper.tsx
src/components/price-calculator/ServiceSelector.tsx
src/components/price-calculator/DynamicQuestionForm.tsx
src/components/price-calculator/CleaningPlanSelector.tsx
src/components/price-calculator/PricePreviewCard.tsx
src/components/price-calculator/ContactDetailsForm.tsx
src/components/price-calculator/CalculatorInfoPanel.tsx
src/components/price-calculator/QuoteCreatedPanel.tsx
```

Use existing folder conventions if different.

## State model

Suggested UI states:

```ts
type CalculatorState =
  | 'select_service'
  | 'answer_questions'
  | 'select_plan'
  | 'price_preview'
  | 'contact_details'
  | 'submitting'
  | 'quote_created'
  | 'error';
```

## Quote-created transition

When quote request submission succeeds:

- Keep user on the page.
- Replace FAQ/help panel with login prompt.
- Show submitted service summary.
- Show quote request created state.

## Validation

Validate each step before advancing.

Examples:

- Square meters must be numeric and within configured min/max.
- Email must be valid.
- Required service-specific fields must be present.
- Cleaning plan must be selected if service uses hourly pricing.

## Accessibility

- Use semantic form fields.
- Clear error text.
- Keyboard navigable stepper.
- Buttons must have descriptive labels.
- FAQ accordion must be accessible if implemented.

## Responsive behavior

- Desktop: two columns.
- Tablet: two columns if space allows, otherwise stacked.
- Mobile: stacked, calculator first, FAQ below.

## Non-goals

- Do not implement final AI chatbot.
- Do not implement a complete public CMS.
- Do not build CRM interface.
