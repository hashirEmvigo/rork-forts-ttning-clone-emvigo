import { useNavigate } from "react-router-dom";
import { Eye, LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useApp } from "@/context/AppContext";

/**
 * Persistent banner shown while an admin previews another user's portal (customer
 * or employee). It keeps the original admin identity visible at all times and
 * offers a clear exit. The preview is read-only — no actions are performed as the
 * previewed user while it is active.
 */
export function ViewAsBanner() {
  const {
    isViewingAsCustomer,
    viewAsCustomer,
    isViewingAsEmployee,
    viewAsEmployee,
    originalUser,
    exitViewAsCustomer,
    exitViewAsEmployee,
  } = useApp();
  const navigate = useNavigate();

  const previewing = isViewingAsCustomer
    ? { kind: "Customer" as const, name: viewAsCustomer?.name, returnTo: "/customers" }
    : isViewingAsEmployee
      ? { kind: "Employee" as const, name: viewAsEmployee?.name, returnTo: "/employees" }
      : null;

  if (!previewing || !previewing.name) return null;

  const handleExit = () => {
    if (previewing.kind === "Customer") exitViewAsCustomer();
    else exitViewAsEmployee();
    navigate(previewing.returnTo, { replace: true });
  };

  return (
    <div className="sticky top-0 z-40 border-b border-amber-500/40 bg-amber-500 text-amber-950">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-5 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-12">
        <div className="flex items-center gap-2.5 text-sm">
          <Eye className="h-4 w-4 shrink-0" />
          <div className="leading-tight">
            <p className="font-semibold">
              Viewing as {previewing.kind}: {previewing.name}
            </p>
            <p className="text-xs text-amber-900/80">
              Original user: {originalUser?.name ?? "—"} · Read-only preview
            </p>
          </div>
        </div>
        <Button
          size="sm"
          onClick={handleExit}
          className="shrink-0 bg-amber-950 text-amber-50 hover:bg-amber-900"
        >
          <LogOut className="h-4 w-4" /> Exit View Mode
        </Button>
      </div>
    </div>
  );
}
