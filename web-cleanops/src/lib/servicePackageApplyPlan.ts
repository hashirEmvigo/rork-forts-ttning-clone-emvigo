/**
 * Pure planner for "Copy package into company" (SVCCAT — Copy-into-company).
 *
 * The Super Admin service packages are GLOBAL templates. When a Company Admin
 * copies a package into their company, the result must be a self-contained DEEP
 * COPY: company-owned categories and services with fresh ids, built from the
 * package item SNAPSHOTS — never a live link to the global template. This module
 * decides WHAT to create; the executor ({@link import("@/hooks/use-service-catalog-mutations").useServiceCatalogMutations})
 * performs the Supabase-authoritative writes and resolves created-category ids.
 *
 * It mints no ids and performs no I/O, so it is trivially unit-testable and has
 * no dependency on the global template staying alive.
 */
import { normalizeServiceBasisType } from "@/lib/serviceBasis";
import type { Service, ServiceCategory, ServicePackage } from "@/types";

/** Fallback category name for package items with no/blank category snapshot. */
const UNCATEGORISED = "Uncategorised";

/**
 * The service fields copied from a {@link import("@/types").ServicePackageItem}
 * into a new company {@link Service}. Excludes the executor-owned fields
 * (`id`/`companyId`/`status`/`createdBy`/`createdAt`/`updatedAt`) and
 * `categoryId`, which the executor resolves from {@link PlannedServiceCreate.categoryName}.
 */
export type PlannedServiceFields = Omit<
  Service,
  "id" | "companyId" | "categoryId" | "status" | "createdBy" | "createdAt" | "updatedAt"
>;

/** One company service to create from a package item, plus its target category name. */
export interface PlannedServiceCreate {
  /** Normalized category display name this service belongs to. */
  categoryName: string;
  fields: PlannedServiceFields;
}

/** A company category that must be created (deduped by name) for the copy. */
export interface PlannedCategoryCreate {
  name: string;
  sortOrder: number;
}

/** The full plan for copying a package into a company catalog. */
export interface ServicePackageApplyPlan {
  /** New company categories to create, in first-seen order, with continuing sortOrders. */
  categoriesToCreate: PlannedCategoryCreate[];
  /** Existing company category ids keyed by normalized (trimmed, lowercased) name. */
  existingCategoryIdByName: Record<string, string>;
  /** One create per package item, in package order. */
  services: PlannedServiceCreate[];
}

/** Normalized lookup key for matching category names case/whitespace-insensitively. */
export function normalizeCategoryKey(name: string): string {
  return name.trim().toLowerCase();
}

function displayCategoryName(raw: string | undefined): string {
  const trimmed = raw?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : UNCATEGORISED;
}

/**
 * Plans a Company Admin "Copy into company" deep copy.
 *
 * Given a global package and the company's EXISTING categories, it:
 *  - reuses a company category when the package item's category name already
 *    exists in the company catalog (matched case/whitespace-insensitively),
 *  - otherwise schedules a new company category (deduped within the package),
 *    continuing the company's `sortOrder` sequence,
 *  - maps every package item to a company-service create input, preserving the
 *    snapshot field set (and defaulting `serviceBasisType` to `billable`).
 *
 * The result references categories by NAME only; the executor resolves ids after
 * creating the new categories, so copied services never depend on the global
 * template's ids or its continued existence.
 */
export function planServicePackageApply(
  pkg: ServicePackage,
  existingCompanyCategories: ServiceCategory[],
): ServicePackageApplyPlan {
  const existingCategoryIdByName: Record<string, string> = {};
  for (const category of existingCompanyCategories) {
    existingCategoryIdByName[normalizeCategoryKey(category.name)] = category.id;
  }

  let maxOrder = existingCompanyCategories.reduce(
    (max, category) => Math.max(max, category.sortOrder),
    -1,
  );
  const categoriesToCreate: PlannedCategoryCreate[] = [];
  const plannedKeys = new Set<string>();

  const services: PlannedServiceCreate[] = pkg.items.map((item) => {
    const categoryName = displayCategoryName(item.categoryName);
    const key = normalizeCategoryKey(categoryName);
    const alreadyResolved = key in existingCategoryIdByName || plannedKeys.has(key);
    if (!alreadyResolved) {
      maxOrder += 1;
      categoriesToCreate.push({ name: categoryName, sortOrder: maxOrder });
      plannedKeys.add(key);
    }

    const fields: PlannedServiceFields = {
      name: item.name,
      description: item.description,
      articleNumber: item.articleNumber,
      serviceType: item.serviceType,
      timeCode: item.timeCode,
      billingType: item.billingType,
      serviceBasisType: normalizeServiceBasisType(item.serviceBasisType),
      deductionEligible: item.deductionEligible,
      deductionType: item.deductionType,
      price: item.price,
      vat: item.vat,
      minimumPrice: item.minimumPrice,
      salesAccount: item.salesAccount,
      smsEnabled: item.smsEnabled,
    };

    return { categoryName, fields };
  });

  return { categoriesToCreate, existingCategoryIdByName, services };
}
