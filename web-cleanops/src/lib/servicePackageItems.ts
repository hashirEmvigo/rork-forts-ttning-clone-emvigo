/**
 * Service Package item snapshotting (SVCCAT Phase 2).
 *
 * The Super Admin package editor builds packages from the GLOBAL service catalog
 * via controlled selection (no free-text). Each {@link ServicePackageItem} is a
 * self-contained SNAPSHOT of the chosen {@link Service}: the service/category
 * NAMES are copied so a package stays valid after it is copied into a company
 * (categories/services are recreated, never live-linked). The source ids are
 * recorded for traceability but are never treated as a live link.
 */
import { makeId } from "@/lib/store";
import type {
  PayrollGroup,
  Service,
  ServiceCategory,
  ServicePackageItem,
} from "@/types";

/**
 * Builds a self-contained {@link ServicePackageItem} snapshot from a catalog
 * {@link Service} and its {@link ServiceCategory} (null when uncategorised).
 *
 * Snapshots the service/category names for copy-safety and records the source
 * service/category ids. The category-name follows the same "Uncategorised"
 * fallback the copy/apply path expects.
 */
export function buildServicePackageItemFromService(
  service: Service,
  category: ServiceCategory | null,
  payrollGroups: PayrollGroup[],
): ServicePackageItem {
  const payrollGroupType = service.payrollGroupId
    ? payrollGroups.find((g) => g.id === service.payrollGroupId)?.groupType
    : undefined;

  return {
    id: makeId("svc_pkg_item"),
    name: service.name,
    description: service.description,
    categoryName: category?.name.trim() || "Uncategorised",
    sourceServiceId: service.id,
    sourceCategoryId: category?.id,
    articleNumber: service.articleNumber,
    serviceType: service.serviceType,
    timeCode: service.timeCode,
    billingType: service.billingType,
    serviceBasisType: service.serviceBasisType,
    payrollGroupType,
    deductionEligible: service.deductionEligible,
    deductionType: service.deductionType,
    price: service.price,
    vat: service.vat,
    minimumPrice: service.minimumPrice,
    salesAccount: service.salesAccount,
    smsEnabled: service.smsEnabled,
  };
}
