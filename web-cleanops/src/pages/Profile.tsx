import { useApp } from "@/context/AppContext";
import { AccessDenied } from "@/components/AccessDenied";
import CustomerProfile from "./customer/Profile";
import EmployeeProfile from "./employee/Profile";

/** Routes the signed-in user to the profile that matches their role. */
export default function Profile() {
  const { currentUser } = useApp();

  if (!currentUser) return null;

  switch (currentUser.role) {
    case "customer":
      return <CustomerProfile />;
    case "employee":
      return <EmployeeProfile />;
    default:
      return <AccessDenied />;
  }
}
