import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2, ShieldAlert, UserPlus } from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useApp } from "@/context/AppContext";
import { supabase } from "@/lib/supabase";
import { isUserCreationConfigured } from "@/lib/adminCreateUser";
import { ENABLE_USER_CREATION } from "@/lib/featureFlags";
import { ROLE_LABELS, type UserRole } from "@/types";

/** Roles selectable on this screen, in display order. */
const CREATABLE_ROLES: UserRole[] = [
  "super_admin",
  "company_admin",
  "employee",
  "customer",
];

/** Minimum length for an admin-supplied temporary password (mirrors the Edge Function). */
const MIN_TEMP_PASSWORD_LENGTH = 8;

interface SupabaseCompany {
  id: string;
  name: string;
}

/** Loads companies straight from Supabase so the real UUID is used for provisioning. */
async function fetchSupabaseCompanies(): Promise<SupabaseCompany[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("companies")
    .select("id, name, status")
    .order("name", { ascending: true });
  if (error) {
    console.error("[create-user] Failed to load companies from Supabase.", error);
    return [];
  }
  return (data ?? [])
    .filter((row) => row.status !== "archived")
    .map((row) => ({ id: row.id as string, name: row.name as string }));
}

interface LastResult {
  email: string;
  usedTempPassword: boolean;
}

/**
 * Super Admin–only screen for creating real users. It routes through the single
 * canonical `createUser` flow (AppContext) — the same path used by the Admin →
 * Users → Add user dialog. When EXPO_PUBLIC_ENABLE_USER_CREATION is on, that
 * flow creates a real Supabase Auth user via the service_role-only
 * `admin-create-user` Edge Function; when off, it falls back to the legacy
 * localStorage behavior. Invite email is the default; a temporary password can
 * optionally be set for immediate-login verification. The service_role key never
 * touches the browser.
 */
export default function CreateUser() {
  const { toast } = useToast();
  const { createUser } = useApp();

  const [fullName, setFullName] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [role, setRole] = useState<UserRole>("super_admin");
  const [companyId, setCompanyId] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [lastResult, setLastResult] = useState<LastResult | null>(null);
  const [useTempPassword, setUseTempPassword] = useState<boolean>(false);
  const [tempPassword, setTempPassword] = useState<string>("");

  // The temp-password option only applies to the Supabase create path.
  const showTempPasswordOption = ENABLE_USER_CREATION;

  const companiesQuery = useQuery<SupabaseCompany[]>({
    queryKey: ["supabase-companies"],
    queryFn: fetchSupabaseCompanies,
    enabled: isUserCreationConfigured && Boolean(supabase),
  });

  const requiresCompany = role !== "super_admin";
  const companies = useMemo(() => companiesQuery.data ?? [], [companiesQuery.data]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setError("Email is required.");
      return;
    }
    if (requiresCompany && !companyId) {
      setError("Select a company for this role.");
      return;
    }

    const wantsTempPassword = showTempPasswordOption && useTempPassword;
    if (wantsTempPassword && tempPassword.length < MIN_TEMP_PASSWORD_LENGTH) {
      setError(`Temporary password must be at least ${MIN_TEMP_PASSWORD_LENGTH} characters.`);
      return;
    }

    setSubmitting(true);
    const result = await createUser({
      name: fullName.trim() || cleanEmail,
      email: cleanEmail,
      role,
      companyId: requiresCompany ? companyId : null,
      tempPassword: wantsTempPassword ? tempPassword : null,
    });
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error ?? "Unable to create user.");
      return;
    }

    setLastResult({ email: cleanEmail, usedTempPassword: wantsTempPassword });
    toast({
      title: wantsTempPassword ? "User created" : "Invitation sent",
      description: wantsTempPassword
        ? `${cleanEmail} can sign in now with the temporary password.`
        : `${cleanEmail} was created and emailed an invite to set their password.`,
    });
    setFullName("");
    setEmail("");
    setUseTempPassword(false);
    setTempPassword("");
  };

  if (!isUserCreationConfigured) {
    return (
      <DashboardLayout>
        <PageHeader
          title="Create user"
          description="Invite real Supabase users into the platform."
        />
        <div className="flex items-start gap-3 rounded-2xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
          <p>
            Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and
            EXPO_PUBLIC_SUPABASE_ANON_KEY to enable user creation.
          </p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <PageHeader
        title="Create user"
        description="Create a real user via the same canonical flow as Admin → Users. Invite email is the default; optionally set a temporary password for immediate-login verification."
      />

      <div className="mx-auto w-full max-w-xl">
        <form
          onSubmit={handleSubmit}
          className="space-y-5 rounded-2xl border border-border bg-card p-6"
        >
          <div className="space-y-1.5">
            <Label htmlFor="cu-name">Full name</Label>
            <Input
              id="cu-name"
              placeholder="e.g. Ingrid Sand"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cu-email">Email</Label>
            <Input
              id="cu-email"
              type="email"
              placeholder="name@company.io"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cu-role">Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
              <SelectTrigger id="cu-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CREATABLE_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {requiresCompany ? (
            <div className="space-y-1.5">
              <Label htmlFor="cu-company">Company</Label>
              <Select value={companyId} onValueChange={setCompanyId}>
                <SelectTrigger id="cu-company">
                  <SelectValue
                    placeholder={
                      companiesQuery.isLoading ? "Loading companies…" : "Select a company"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!companiesQuery.isLoading && companies.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No companies found in Supabase. Create a company there first.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              A Super Admin is platform-wide and is not attached to a company.
            </p>
          )}

          {showTempPasswordOption ? (
            <div className="space-y-3 rounded-lg border border-border p-3.5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Set a temporary password</p>
                  <p className="text-xs text-muted-foreground">
                    Let this user sign in immediately. Otherwise they get an invite email.
                  </p>
                </div>
                <Switch checked={useTempPassword} onCheckedChange={setUseTempPassword} />
              </div>
              {useTempPassword ? (
                <div className="space-y-1.5">
                  <Label htmlFor="cu-temp-password">Temporary password</Label>
                  <Input
                    id="cu-temp-password"
                    type="text"
                    autoComplete="off"
                    placeholder={`At least ${MIN_TEMP_PASSWORD_LENGTH} characters`}
                    value={tempPassword}
                    onChange={(e) => setTempPassword(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Share this securely. Ask the user to change it after their first sign-in.
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <p className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          {lastResult ? (
            <div className="flex items-start gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5 text-sm text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">
                  {lastResult.email} {lastResult.usedTempPassword ? "created." : "invited."}
                </p>
                <p className="text-xs opacity-90">
                  {lastResult.usedTempPassword
                    ? "They can sign in now with the temporary password. Verify in Supabase → profiles."
                    : "They were emailed an invite to set their password. Verify in Supabase → profiles."}
                </p>
              </div>
            </div>
          ) : null}

          <Button type="submit" className="w-full" size="lg" disabled={submitting}>
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <UserPlus className="h-4 w-4" />{" "}
                {showTempPasswordOption && useTempPassword ? "Create user" : "Send invite"}
              </>
            )}
          </Button>
        </form>
      </div>
    </DashboardLayout>
  );
}
