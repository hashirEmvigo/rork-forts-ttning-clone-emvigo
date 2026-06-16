import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Routes, Route } from "react-router-dom";

import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppProvider, useApp } from "@/context/AppContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { SmartRoute } from "@/components/public/SmartRoute";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ENABLE_USER_CREATION } from "@/lib/featureFlags";
import {
  getLastClientDomainStoragePurgeResult,
  invalidateDomainQueryCaches,
} from "@/lib/clientDomainStorage";

import Login from "./pages/auth/Login";
import ForgotPassword from "./pages/auth/ForgotPassword";
import ResetPassword from "./pages/auth/ResetPassword";
import AcceptInvite from "./pages/auth/AcceptInvite";
import Home from "./pages/Home";
import PublicPage from "./pages/public/PublicPage";
import PriceCalculator from "./pages/public/PriceCalculator";
import Companies from "./pages/superadmin/Companies";
import SettingsTemplates from "./pages/superadmin/SettingsTemplates";
import GlobalTemplates from "./pages/superadmin/GlobalTemplates";
import AgreementTemplates from "./pages/superadmin/AgreementTemplates";
import SystemSettings from "./pages/superadmin/SystemSettings";
import RequestSettings from "./pages/superadmin/RequestSettings";
import AdministrationCenter from "./pages/superadmin/AdministrationCenter";
import Services from "./pages/superadmin/Services";
import EntitlementValidation from "./pages/superadmin/EntitlementValidation";
import SystemPerformance from "./pages/superadmin/SystemPerformance";
import DevelopmentCenter from "./pages/superadmin/DevelopmentCenter";
import EmployeeMigration from "./pages/superadmin/EmployeeMigration";
import MediaCenter from "./pages/superadmin/MediaCenter";
import CalculatorControl from "./pages/superadmin/CalculatorControl";
import Users from "./pages/admin/Users";
import CreateUser from "./pages/admin/CreateUser";
import Employees from "./pages/admin/Employees";
import Customers from "./pages/admin/Customers";
import CustomerCard from "./pages/admin/CustomerCard";
import CustomerAgreementDetail from "./pages/admin/CustomerAgreementDetail";
import WorkOrderDetails from "./pages/admin/WorkOrderDetails";
import BookingList from "./pages/admin/BookingList";
import BookingQueue from "./pages/admin/BookingQueue";
import Schedule from "./pages/admin/Schedule";
import ScheduleLab from "./pages/admin/ScheduleLab";
import Teams from "./pages/admin/Teams";
import ModulePage from "./pages/ModulePage";
import ChecklistTemplates from "./pages/modules/ChecklistTemplates";
import ChecklistLibraries from "./pages/modules/ChecklistLibraries";
import TemplateEditor from "./pages/modules/TemplateEditor";
import CustomerProtocols from "./pages/modules/CustomerProtocols";
import ProtocolEditor from "./pages/modules/ProtocolEditor";
import CustomerCleaningProtocols from "./pages/customer/CleaningProtocols";
import CustomerCleaningPreferences from "./pages/customer/CleaningPreferences";
import CustomerCleaningProtocolView from "./pages/customer/CleaningProtocolView";
import Profile from "./pages/Profile";
import Settings from "./pages/Settings";
import ChecklistSettings from "./pages/settings/ChecklistSettings";
import CompanyMediaLibrarySettings from "./pages/settings/MediaLibrary";
import ChecklistSettingModule from "./pages/settings/ChecklistSettingModule";
import CompanyRequestSettings from "./pages/settings/RequestSettings";
import ProtocolRuns from "./pages/execution/ProtocolRuns";
import CrmSettings from "./pages/crm/CrmSettings";
import CrmDashboard from "./pages/crm/CrmDashboard";
import CrmRequests from "./pages/crm/CrmRequests";
import { CHECKLIST_SETTINGS_MODULES } from "@/lib/checklistSettingsModules";
import { isRequestCrmSettingsShellEnabled } from "@/lib/requestCrm/settingsNav";
import { isRequestCrmShellEnabled, REQUEST_CRM_MODULE_ID } from "@/lib/requestCrm/shellNav";
import {
  COMPANY_REQUEST_SETTINGS_PATH,
  COMPANY_REQUEST_SETTINGS_VIEW_PERMISSION,
} from "@/lib/requestCrm/companyRequestSettingsNav";
import {
  COMPANY_MEDIA_LIBRARY_SETTINGS_PATH,
  COMPANY_MEDIA_LIBRARY_SETTINGS_VIEW_PERMISSION,
} from "@/lib/assets/companyMediaSettingsNav";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();
const startupDomainStoragePurge = getLastClientDomainStoragePurgeResult();
if (startupDomainStoragePurge?.didPurge) {
  void invalidateDomainQueryCaches(queryClient);
}

/** Redirects already-authenticated users away from auth pages to their dashboard. */
function PublicOnly({ children }: { children: React.ReactNode }) {
  const { currentUser } = useApp();
  if (currentUser) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
      <Route path="/forgot-password" element={<PublicOnly><ForgotPassword /></PublicOnly>} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/accept-invite" element={<AcceptInvite />} />

      {/* Smart root: public marketing home for visitors, dashboard for authed users. */}
      <Route
        path="/"
        element={
          <SmartRoute publicView={<PublicPage slug="home" />}>
            <Navigate to="/dashboard" replace />
          </SmartRoute>
        }
      />

      {/* Public marketing pages — accessible without authentication. */}
      <Route path="/features" element={<PublicPage slug="features" />} />
      <Route path="/get-started" element={<PublicPage slug="get-started" />} />
      <Route path="/about" element={<PublicPage slug="about" />} />
      <Route path="/contact" element={<PublicPage slug="contact" />} />

      {/* Public price calculator — accessible logged in or out; never redirects. */}
      <Route path="/rakna-ut-ditt-pris" element={<PriceCalculator />} />
      <Route path="/rakna-ut-pris" element={<Navigate to="/rakna-ut-ditt-pris" replace />} />

      {/* Authenticated home (role-specific dashboards), moved off the public root. */}
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <Home />
          </ProtectedRoute>
        }
      />
      <Route
        path="/companies"
        element={
          <ProtectedRoute requirePermission="companies.manage">
            <Companies />
          </ProtectedRoute>
        }
      />
      <Route
        path="/users"
        element={
          <ProtectedRoute requirePermission="users.manage">
            <Users />
          </ProtectedRoute>
        }
      />
      <Route
        path="/employees"
        element={
          <ProtectedRoute requirePermission="users.manage">
            <Employees />
          </ProtectedRoute>
        }
      />
      <Route
        path="/customers"
        element={
          <ProtectedRoute requirePermission="users.manage">
            <Customers />
          </ProtectedRoute>
        }
      />
      <Route
        path="/customers/:customerId"
        element={
          <ProtectedRoute requirePermission="users.manage">
            <CustomerCard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/agreements/:agreementId"
        element={
          <ProtectedRoute requirePermission="users.manage">
            <CustomerAgreementDetail />
          </ProtectedRoute>
        }
      />
      <Route
        path="/work-orders/:workOrderId"
        element={
          <ProtectedRoute requirePermission="users.manage">
            <WorkOrderDetails />
          </ProtectedRoute>
        }
      />
      <Route
        path="/booking-list"
        element={
          <ProtectedRoute requirePermission="users.manage">
            <BookingList />
          </ProtectedRoute>
        }
      />
      <Route
        path="/booking-queue"
        element={
          <ProtectedRoute requirePermission="users.manage">
            <BookingQueue />
          </ProtectedRoute>
        }
      />
      <Route
        path="/schedule"
        element={
          <ProtectedRoute requirePermission="users.manage">
            <Schedule />
          </ProtectedRoute>
        }
      />
      <Route
        path="/schedule-lab"
        element={
          <ProtectedRoute requirePermission="users.manage">
            <ScheduleLab />
          </ProtectedRoute>
        }
      />
      <Route
        path="/teams"
        element={
          <ProtectedRoute requirePermission="users.manage">
            <Teams />
          </ProtectedRoute>
        }
      />
      <Route
        path="/modules/checklist-manager"
        element={
          <ProtectedRoute requirePermission="checklist_templates.view">
            <ChecklistTemplates />
          </ProtectedRoute>
        }
      />
      <Route
        path="/modules/checklist-manager/libraries"
        element={
          <ProtectedRoute requirePermission="checklist_templates.view">
            <ChecklistLibraries />
          </ProtectedRoute>
        }
      />
      <Route
        path="/modules/checklist-manager/templates/:templateId"
        element={
          <ProtectedRoute requirePermission="checklist_templates.view">
            <TemplateEditor />
          </ProtectedRoute>
        }
      />
      <Route
        path="/modules/checklist-manager/protocols"
        element={
          <ProtectedRoute requirePermission="customer_protocols.view">
            <CustomerProtocols />
          </ProtectedRoute>
        }
      />
      <Route
        path="/modules/checklist-manager/protocols/:protocolId"
        element={
          <ProtectedRoute requirePermission="customer_protocols.view">
            <ProtocolEditor />
          </ProtectedRoute>
        }
      />
      <Route
        path="/modules/my-cleaning-protocols"
        element={
          <ProtectedRoute allow={["customer"]} requirePermission="my_cleaning_protocols.view">
            <CustomerCleaningProtocols />
          </ProtectedRoute>
        }
      />
      <Route
        path="/modules/my-cleaning-protocols/:protocolId"
        element={
          <ProtectedRoute allow={["customer"]} requirePermission="my_cleaning_protocols.view">
            <CustomerCleaningProtocolView />
          </ProtectedRoute>
        }
      />
      <Route
        path="/modules/:moduleId"
        element={
          <ProtectedRoute>
            <ModulePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/my-cleaning-preferences"
        element={
          <ProtectedRoute allow={["customer"]}>
            <CustomerCleaningPreferences />
          </ProtectedRoute>
        }
      />
      <Route
        path="/profile"
        element={
          <ProtectedRoute allow={["customer", "employee"]}>
            <Profile />
          </ProtectedRoute>
        }
      />
      <Route
        path="/administration"
        element={
          <ProtectedRoute allow={["super_admin"]} requirePermission="settings_templates.manage">
            <AdministrationCenter />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings-templates"
        element={
          <ProtectedRoute requirePermission="settings_templates.manage">
            <SettingsTemplates />
          </ProtectedRoute>
        }
      />
      {/* Shared path: public marketing for visitors, the Super Admin catalog for authed users. */}
      <Route
        path="/services"
        element={
          <SmartRoute publicView={<PublicPage slug="services" />}>
            <ProtectedRoute allow={["super_admin"]} requirePermission="settings_templates.manage">
              <Services />
            </ProtectedRoute>
          </SmartRoute>
        }
      />
      <Route
        path="/global-templates"
        element={
          <ProtectedRoute allow={["super_admin"]} requirePermission="global_templates.view">
            <GlobalTemplates />
          </ProtectedRoute>
        }
      />
      <Route
        path="/agreement-templates"
        element={
          <ProtectedRoute allow={["super_admin"]} requirePermission="settings_templates.manage">
            <AgreementTemplates />
          </ProtectedRoute>
        }
      />
      <Route
        path="/system-settings"
        element={
          <ProtectedRoute allow={["super_admin"]} requirePermission="settings_templates.manage">
            <SystemSettings />
          </ProtectedRoute>
        }
      />
      {/* Super Admin–only global/system Request governance (frontend/mock
          foundation). Top-level Super Admin route, deliberately distinct from the
          future Company Admin local `/settings/request`. */}
      <Route
        path="/request-settings"
        element={
          <ProtectedRoute allow={["super_admin"]} requirePermission="settings_templates.manage">
            <RequestSettings />
          </ProtectedRoute>
        }
      />
      <Route
        path="/entitlement-validation"
        element={
          <ProtectedRoute allow={["super_admin"]} requirePermission="settings_templates.manage">
            <EntitlementValidation />
          </ProtectedRoute>
        }
      />
      <Route
        path="/system-performance"
        element={
          <ProtectedRoute allow={["super_admin"]} requirePermission="settings_templates.manage">
            <SystemPerformance />
          </ProtectedRoute>
        }
      />
      <Route
        path="/development-center"
        element={
          <ProtectedRoute allow={["super_admin"]} requirePermission="settings_templates.manage">
            <DevelopmentCenter />
          </ProtectedRoute>
        }
      />
      <Route
        path="/employee-migration"
        element={
          <ProtectedRoute allow={["super_admin"]} requirePermission="settings_templates.manage">
            <EmployeeMigration />
          </ProtectedRoute>
        }
      />
      <Route
        path="/media-center"
        element={
          <ProtectedRoute allow={["super_admin"]} requirePermission="settings_templates.manage">
            <MediaCenter />
          </ProtectedRoute>
        }
      />
      <Route
        path="/calculator"
        element={
          <ProtectedRoute allow={["super_admin"]} requirePermission="calculator.manage">
            <CalculatorControl />
          </ProtectedRoute>
        }
      />
      {ENABLE_USER_CREATION ? (
        <Route
          path="/create-user"
          element={
            <ProtectedRoute allow={["super_admin"]}>
              <CreateUser />
            </ProtectedRoute>
          }
        />
      ) : null}
      <Route
        path="/settings"
        element={
          <ProtectedRoute requirePermission="settings.manage">
            <Settings />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings/checklists"
        element={
          <ProtectedRoute requirePermission="checklists.settings.view">
            <ChecklistSettings />
          </ProtectedRoute>
        }
      />
      <Route
        path={COMPANY_MEDIA_LIBRARY_SETTINGS_PATH}
        element={
          <ProtectedRoute
            allow={["company_admin"]}
            requirePermission={COMPANY_MEDIA_LIBRARY_SETTINGS_VIEW_PERMISSION}
          >
            <CompanyMediaLibrarySettings />
          </ProtectedRoute>
        }
      />
      {/* Company Admin–only local Request settings foundation (frontend/mock).
          Distinct from the Super Admin global governance route `/request-settings`.
          Gated through existing seams only: company_admin role, the existing
          `requests.settings.view` permission, and the `admin-requests` module via
          the shared `canAccessModule` seam (WAVE-003H-R/003I-R). */}
      <Route
        path={COMPANY_REQUEST_SETTINGS_PATH}
        element={
          <ProtectedRoute
            allow={["company_admin"]}
            requirePermission={COMPANY_REQUEST_SETTINGS_VIEW_PERMISSION}
            requireModule={REQUEST_CRM_MODULE_ID}
          >
            <CompanyRequestSettings />
          </ProtectedRoute>
        }
      />
      <Route
        path="/protocol-runs"
        element={
          <ProtectedRoute requirePermission="checklists.execution.view">
            <ProtocolRuns />
          </ProtectedRoute>
        }
      />
      {CHECKLIST_SETTINGS_MODULES.map((module) => (
        <Route
          key={module.id}
          path={module.path}
          element={
            <ProtectedRoute requirePermission="checklists.settings.view">
              <ChecklistSettingModule moduleId={module.id} />
            </ProtectedRoute>
          }
        />
      ))}

      {/* REQUEST CRM Dashboard + Request List shell (Slice 0) — shared-admin
          only, behind the master REQUEST CRM frontend shell flag (default OFF).
          `/crm` redirects to the dashboard. The whole group is absent unless the
          shell flag is ON. */}
      {isRequestCrmShellEnabled() ? (
        <>
          <Route
            path="/crm"
            element={
              <ProtectedRoute
                allow={["super_admin", "company_admin"]}
                requirePermission="requests.view"
                requireModule={REQUEST_CRM_MODULE_ID}
              >
                <Navigate to="/crm/dashboard" replace />
              </ProtectedRoute>
            }
          />
          <Route
            path="/crm/dashboard"
            element={
              <ProtectedRoute
                allow={["super_admin", "company_admin"]}
                requirePermission="requests.view"
                requireModule={REQUEST_CRM_MODULE_ID}
              >
                <CrmDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/crm/requests"
            element={
              <ProtectedRoute
                allow={["super_admin", "company_admin"]}
                requirePermission="requests.view"
                requireModule={REQUEST_CRM_MODULE_ID}
              >
                <CrmRequests />
              </ProtectedRoute>
            }
          />
        </>
      ) : null}

      {/* REQUEST CRM Settings Shell (Slice 0) — shared-admin only, behind feature
          flags defaulting OFF. The whole group is absent unless both the master
          shell flag and the settings-shell flag are ON. */}
      {isRequestCrmSettingsShellEnabled() ? (
        <>
          <Route
            path="/crm/settings"
            element={
              <ProtectedRoute
                allow={["super_admin", "company_admin"]}
                requirePermission="requests.settings.view"
              >
                <CrmSettings />
              </ProtectedRoute>
            }
          />
          <Route
            path="/crm/settings/:tab"
            element={
              <ProtectedRoute
                allow={["super_admin", "company_admin"]}
                requirePermission="requests.settings.view"
              >
                <CrmSettings />
              </ProtectedRoute>
            }
          />
        </>
      ) : null}

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AppProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <ErrorBoundary>
            <AppRoutes />
          </ErrorBoundary>
        </BrowserRouter>
      </TooltipProvider>
    </AppProvider>
  </QueryClientProvider>
);

export default App;
