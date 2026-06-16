import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { AreaScopePicker } from "@/components/users/AreaScopePicker";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/hooks/use-toast";
import { ENABLE_USER_CREATION } from "@/lib/featureFlags";
import { normalizeAreaScope } from "@/lib/areaScope";
import {
  ASSIGNABLE_ROLES,
  ROLE_LABELS,
  type AreaScope,
  type AreaScopeMode,
  type User,
  type UserRole,
} from "@/types";

/** Minimum length for an admin-supplied temporary password (mirrors the Edge Function). */
const MIN_TEMP_PASSWORD_LENGTH = 8;

/**
 * Builds a short, admin-facing diagnostic note describing the live Edge Function
 * version for the `admin-create-user` call.
 *
 * Interpretation:
 *   - a version string (e.g. "2024-companyadmin-1") → the updated build is live;
 *   - missing/null → the response carried no version, which usually means the
 *     OLD deployed function is still serving requests.
 */
function describeFunctionVersion(functionVersion?: string | null): string {
  return functionVersion
    ? `functionVersion present: ${functionVersion}`
    : "functionVersion missing — the old deployed Edge Function is likely still live.";
}

/**
 * Builds a short, admin-facing diagnostic note describing which credential the
 * create request used.
 *
 * Interpretation:
 *   - "session" → a real Supabase Auth token was sent; the Edge Function can
 *     resolve the caller's profile;
 *   - "anon" → no Supabase session existed, so the anon key was sent and the
 *     Edge Function sees an anonymous caller (base_role/status/company_id =
 *     none). The admin is signed in via the legacy localStorage path.
 */
function describeAuthMode(authMode?: "session" | "anon"): string {
  if (authMode === "session") return "authMode: session (real Supabase token sent)";
  if (authMode === "anon")
    return "authMode: anon (no Supabase session — signed in via localStorage; Edge Function sees an anonymous caller)";
  return "authMode: unknown";
}

interface UserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The company these users belong to. */
  companyId: string;
  /** Pass a user to edit; omit to create a new one. */
  user?: User | null;
}

export function UserDialog({ open, onOpenChange, companyId, user }: UserDialogProps) {
  const { createUser, updateUser, areas } = useApp();
  const { toast } = useToast();
  const [name, setName] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [role, setRole] = useState<UserRole>("employee");
  const [areaMode, setAreaMode] = useState<AreaScopeMode>("all");
  const [areaIds, setAreaIds] = useState<string[]>([]);
  const [error, setError] = useState<string>("");
  const [saving, setSaving] = useState<boolean>(false);
  const [useTempPassword, setUseTempPassword] = useState<boolean>(false);
  const [tempPassword, setTempPassword] = useState<string>("");
  const isEdit = Boolean(user);

  // The temp-password option only applies to the Supabase create path.
  const showTempPasswordOption = !isEdit && ENABLE_USER_CREATION;

  useEffect(() => {
    if (open) {
      setName(user?.name ?? "");
      setEmail(user?.email ?? "");
      setRole(user?.role ?? "employee");
      const scope = normalizeAreaScope(user?.areaScope);
      setAreaMode(scope.mode);
      setAreaIds(scope.areaIds);
      setError("");
      setSaving(false);
      setUseTempPassword(false);
      setTempPassword("");
    }
  }, [open, user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!name.trim() || !email.trim() || saving) return;

    if (showTempPasswordOption && useTempPassword && tempPassword.length < MIN_TEMP_PASSWORD_LENGTH) {
      setError(`Temporary password must be at least ${MIN_TEMP_PASSWORD_LENGTH} characters.`);
      return;
    }

    if (areaMode === "selected" && areaIds.length === 0) {
      setError("Select at least one area, or choose “All areas”.");
      return;
    }

    const areaScope: AreaScope =
      areaMode === "selected"
        ? { mode: "selected", areaIds }
        : { mode: "all", areaIds: [] };

    setSaving(true);
    try {
      if (user) {
        const result = updateUser(user.id, {
          name: name.trim(),
          email: email.trim(),
          role,
          areaScope,
        });
        if (!result.ok) {
          setError(result.error ?? "Unable to save user.");
          return;
        }
        toast({ title: "User updated", description: `${name.trim()} has been saved.` });
      } else {
        const result = await createUser({
          name: name.trim(),
          email: email.trim(),
          role,
          companyId,
          tempPassword: showTempPasswordOption && useTempPassword ? tempPassword : null,
          areaScope,
        });
        // Deployment/runtime verification: surface the live Edge Function version
        // and which credential the request used (session vs anon key).
        const versionNote = describeFunctionVersion(result.functionVersion);
        const authNote = describeAuthMode(result.authMode);
        if (!result.ok) {
          // eslint-disable-next-line no-console
          console.warn(`[admin-create-user] create failed — ${versionNote} — ${authNote}`);
          const baseError = result.error ?? "Unable to create user.";
          setError(`${baseError}\n\n(${versionNote})\n(${authNote})`);
          return;
        }
        // eslint-disable-next-line no-console
        console.info(`[admin-create-user] create succeeded — ${versionNote} — ${authNote}`);
        toast({
          title: showTempPasswordOption && useTempPassword ? "User created" : "User invited",
          description:
            showTempPasswordOption && useTempPassword
              ? `${name.trim()} can sign in now with the temporary password.`
              : `${name.trim()} has been added to your team.`,
        });
      }
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit user" : "Add user"}</DialogTitle>
            <DialogDescription>
              {isEdit
                ? "Update this team member's details and role."
                : "Invite a new member to your company and assign their role."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-5">
            <div className="space-y-1.5">
              <Label htmlFor="user-name">Full name</Label>
              <Input
                id="user-name"
                placeholder="e.g. Ingrid Sand"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="user-email">Email</Label>
              <Input
                id="user-email"
                type="email"
                placeholder="name@company.io"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="user-role">Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
                <SelectTrigger id="user-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSIGNABLE_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <AreaScopePicker
              companyId={companyId}
              areas={areas}
              mode={areaMode}
              areaIds={areaIds}
              onModeChange={setAreaMode}
              onAreaIdsChange={setAreaIds}
            />

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
                    <Label htmlFor="user-temp-password">Temporary password</Label>
                    <Input
                      id="user-temp-password"
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
              <p className="whitespace-pre-line rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : isEdit ? "Save changes" : "Add user"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
