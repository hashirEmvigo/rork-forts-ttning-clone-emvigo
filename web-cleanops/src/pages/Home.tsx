import { useApp } from "@/context/AppContext";
import SuperAdminDashboard from "./superadmin/Dashboard";
import CompanyAdminDashboard from "./admin/Dashboard";
import EmployeeDashboard from "./employee/Dashboard";
import CustomerDashboard from "./customer/Dashboard";

/** Routes the signed-in user to the dashboard that matches their role. */
export default function Home() {
  const { currentUser } = useApp();

  if (!currentUser) return null;

  switch (currentUser.role) {
    case "super_admin":
      return <SuperAdminDashboard />;
    case "company_admin":
      return <CompanyAdminDashboard />;
    case "employee":
      return <EmployeeDashboard />;
    case "customer":
      return <CustomerDashboard />;
    default:
      return null;
  }
}
