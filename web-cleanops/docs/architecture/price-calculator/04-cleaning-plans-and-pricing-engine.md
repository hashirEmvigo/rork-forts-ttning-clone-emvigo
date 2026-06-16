# Cleaning Plans and Pricing Engine Architecture

**Audience:** RORK / GPT-5.5 High  
**Project:** CleanOps / Stadportalen / Price Calculator  
**Instruction level:** Treat this as implementation guidance for repository analysis, architecture validation, and phased build planning. The human project owner does not need explanatory simplification. Be precise, conservative, and repo-grounded.

---
## Key semantic rule

Cleaning plans do not define different cleaning content. They define operational/commercial terms and hourly rates.

## Cleaning plan examples

### Flexible plan

- Lower hourly rate.
- Company has more flexibility around day/time scheduling.
- Employee continuity may vary.
- Best price-focused option.

### Fixed plan

- Medium hourly rate.
- More stable day/time preference.
- Stronger same-employee preference.
- Best predictability-focused option.

### Priority plan

- Higher hourly rate.
- Customer preferences have higher priority.
- Strongest continuity and scheduling preference.
- Best control-focused option.

Names should be configurable.

## Pricing engine principles

- Pricing logic must be pure and testable.
- Client preview can calculate provisional values.
- Final persisted quote request must be calculated through a trusted backend/repository path.
- Store snapshots of inputs and calculated outputs.
- Old quotes must not change when settings/pricing rules change later.

## Home cleaning model

Recommended MVP formula:

```text
recommended_hours = base_hours + (sqm * hours_per_sqm) + bathroom_adjustment + addon_hours
raw_price = recommended_hours * selected_cleaning_plan.hourly_rate
price_range = raw_price +/- configured margin
```

Configuration fields:

- `base_hours`
- `hours_per_sqm`
- `minimum_hours`
- `bathroom_extra_hours`
- `addon_hours`
- `range_min_percent`
- `range_max_percent`
- `rounding_increment`

## Move-out cleaning model

Recommended MVP formula:

```text
base_price = max(minimum_price, sqm * price_per_sqm)
addons = balcony + split_windows + extra_bathrooms + other configured addons
raw_price = base_price + addons
price_range = raw_price +/- configured margin
```

Configuration fields:

- `price_per_sqm`
- `minimum_price`
- `addon_prices`
- `range_min_percent`
- `range_max_percent`
- `rounding_increment`

## Internal calculation trace

Store calculation trace internally:

```json
{
  "pricingModel": "home_cleaning_recommended_hours",
  "inputs": {},
  "selectedPlanSnapshot": {},
  "formulaVersion": "v1",
  "steps": [],
  "rawPrice": 0,
  "minPrice": 0,
  "maxPrice": 0,
  "estimatedHours": 0
}
```

The customer should see only simplified result text. Admin may see full internal calculation details.
