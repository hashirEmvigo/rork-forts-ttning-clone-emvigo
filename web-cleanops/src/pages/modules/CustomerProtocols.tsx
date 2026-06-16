import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { ChecklistTabs } from "@/components/checklist/ChecklistTabs";
import { CustomerProtocolsWorkspace } from "@/components/checklist/CustomerProtocolsWorkspace";

/**
 * Standalone Customer Protocols route (`/modules/checklist-manager/protocols`).
 *
 * The protocol search/filter/cards body lives in the shared
 * `CustomerProtocolsWorkspace` so this page and the inline Customers workspace
 * section stay in lock-step. This route remains available, but the primary
 * Company Admin path now opens the same workspace inline on `/customers`.
 */
export default function CustomerProtocols() {
  return (
    <DashboardLayout wide>
      <ChecklistTabs />
      <CustomerProtocolsWorkspace />
    </DashboardLayout>
  );
}
