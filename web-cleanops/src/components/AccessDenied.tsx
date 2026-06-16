import { useNavigate } from "react-router-dom";
import { ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Shown when a signed-in user reaches an area their role can't access. */
export function AccessDenied() {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-md animate-fade-up rounded-2xl border border-border bg-card p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
          <ShieldAlert className="h-6 w-6" />
        </div>
        <h1 className="mt-5 font-display text-2xl tracking-tight">Access Denied</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          You do not have permission to access this area.
        </p>
        <Button variant="outline" className="mt-6" onClick={() => navigate(-1)}>
          Go Back
        </Button>
      </div>
    </div>
  );
}
