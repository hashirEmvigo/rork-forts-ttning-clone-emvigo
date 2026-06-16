# Full-Page Landing Page Design - Price Calculator

**Audience:** RORK / GPT-5.5 High  
**Project:** CleanOps / Stadportalen / Price Calculator  
**Instruction level:** Treat this as implementation guidance for repository analysis, architecture validation, and phased build planning. The human project owner does not need explanatory simplification. Be precise, conservative, and repo-grounded.

---
## Design decision

The calculator must not be a small widget buried inside a normal page. It should be a dedicated full-page conversion experience.

## Desktop layout

```text
+---------------------------------------------------------------+
| Header: logo | Back to website | Contact / Help               |
+---------------------------------------------------------------+
|                                                               |
|  LEFT PANEL                         RIGHT PANEL               |
|  Price calculator                   FAQ / trust / help         |
|                                                               |
|  Service selection                  Common questions           |
|  Dynamic form                       How pricing works          |
|  Cleaning plan selector             RUT/tax info               |
|  Price preview                      Support contact            |
|  Contact details                    Future AI chatbot slot     |
|                                                               |
+---------------------------------------------------------------+
```

## After quote submission

The right-side FAQ/trust content should be replaced by login/next-step content.

```text
LEFT PANEL                         RIGHT PANEL
Quote request summary              Login prompt
Price indication                   Magic-link/email instruction
Submitted service details          Continue to portal CTA
```

## Mobile layout

Mobile should stack:

1. Header.
2. Calculator.
3. Price preview.
4. FAQ/help accordion.
5. Quote-created login prompt after submission.

## Visual behavior

- The calculator must be visually dominant.
- The right panel must reduce hesitation and increase conversion.
- Step progress should be visible.
- Price indication should be clear but not overpromise finality.
- The quote-created state should feel like continuity, not a redirect failure.

## Required components

Suggested component names:

- `PublicPriceCalculatorPage`
- `PriceCalculatorLayout`
- `CalculatorHeader`
- `CalculatorStepper`
- `ServiceSelector`
- `DynamicServiceQuestionForm`
- `CleaningPlanSelector`
- `PricePreviewCard`
- `ContactDetailsStep`
- `CalculatorInfoPanel`
- `CalculatorFaqPanel`
- `QuoteCreatedPanel`
- `LoginPromptPanel`
- `ChatbotSlotPlaceholder`

Use actual repo conventions if naming differs.

## Non-goals

Do not build chatbot behavior in MVP. Only reserve the placement.

Do not build complex CMS editing of the landing page in MVP unless existing settings architecture makes this easy.
