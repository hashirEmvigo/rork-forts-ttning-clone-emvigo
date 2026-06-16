import type {
  ChecklistTemplateV2,
  CustomerSegment,
  TemplateAudience,
} from "@/types";

/**
 * Checklist Manager V2 — Template recommendation layer (Template Picker UX).
 *
 * A small, pure helper that ranks templates for a customer based on the
 * customer's {@link CustomerSegment} and each template's {@link TemplateAudience}.
 * It is deliberately deterministic and side-effect free (no storage, no AI) so
 * it can be reused by the picker UI and unit-tested in isolation.
 *
 * Matching rules (a template's missing audience is treated as `general`):
 *  - B2B customer      → B2B + General templates.
 *  - B2C customer      → B2C + General templates.
 *  - One-Time customer → General templates (no dedicated one-time audience
 *    exists; general templates such as move-out / deep cleaning fit best).
 *
 * Recommendations never restrict what can be used — every template remains
 * selectable in its tier group; this only surfaces the most relevant ones first.
 */

/** A template's effective audience for matching (unset → `general`). */
export function effectiveAudience(
  template: Pick<ChecklistTemplateV2, "audience">,
): TemplateAudience {
  return template.audience ?? "general";
}

/**
 * The audiences recommended for a customer segment, in priority order
 * (most specific first). Returns an empty list when the segment is unknown so
 * callers show no "recommended" group rather than guessing.
 */
export function recommendedAudiences(
  segment: CustomerSegment | undefined,
): TemplateAudience[] {
  switch (segment) {
    case "b2b":
      return ["b2b", "general"];
    case "b2c":
      return ["b2c", "general"];
    case "one_time":
      return ["general"];
    default:
      return [];
  }
}

/** Whether a template is recommended for the given customer segment. */
export function isRecommendedForSegment(
  template: Pick<ChecklistTemplateV2, "audience">,
  segment: CustomerSegment | undefined,
): boolean {
  return recommendedAudiences(segment).includes(effectiveAudience(template));
}

/**
 * Splits templates into a recommended subset and the remainder for a customer
 * segment. The recommended list is ordered by audience priority (the segment's
 * own audience before `general`), preserving the original relative order within
 * each audience bucket. When the segment is unknown nothing is recommended.
 */
export function partitionByRecommendation<T extends Pick<ChecklistTemplateV2, "audience">>(
  templates: T[],
  segment: CustomerSegment | undefined,
): { recommended: T[]; others: T[] } {
  const priority = recommendedAudiences(segment);
  if (priority.length === 0) {
    return { recommended: [], others: [...templates] };
  }
  const recommended: T[] = [];
  const others: T[] = [];
  for (const template of templates) {
    if (isRecommendedForSegment(template, segment)) {
      recommended.push(template);
    } else {
      others.push(template);
    }
  }
  recommended.sort(
    (a, b) =>
      priority.indexOf(effectiveAudience(a)) -
      priority.indexOf(effectiveAudience(b)),
  );
  return { recommended, others };
}
