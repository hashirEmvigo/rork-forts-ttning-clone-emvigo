import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ShieldCheck, ShieldAlert } from "lucide-react";

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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TimePicker } from "@/components/ui/time-picker";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/hooks/use-toast";
import {
  WEEKDAYS,
  WEEKDAY_LABELS,
  defaultEmployeeAvailability,
  formatAvailabilitySummary,
  normalizeEmployeeAvailability,
  representativeWindows,
} from "@/lib/employeeSchedule";
import { listAssignableRoles } from "@/lib/employeeRoles";
import { permissionLabel } from "@/lib/permissions";
import {
  getDefaultEmployeeLanguage,
  listActiveEmployeeLanguages,
} from "@/lib/employeeLanguage";
import { activePostalCities } from "@/lib/postalCity";
import { cn } from "@/lib/utils";
import { useEmployeeMutations } from "@/hooks/use-employee-mutations";
import type { Employee, EmployeeAvailabilityDay, Weekday } from "@/types";

interface EmployeeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  employee?: Employee | null;
}

const NO_LOGIN = "__none__";
/** Sentinel for "no explicit role" — keeps the login on its base-role default. */
const NO_ROLE = "__no_role__";
/** Sentinel for "no explicit language" — resolves to the company default. */
const DEFAULT_LANGUAGE = "__default__";
/** Sentinel for "no second language selected" — second language is optional. */
const NO_SECOND_LANGUAGE = "__no_second_lang__";
/** Sentinel for "no postal city selected" (Radix Select disallows empty values). */
const NO_CITY = "__no_city__";

/** Identifiers for the single-expand collapsible boxes in this dialog. */
type BoxId = "info" | "languages" | "role" | "schedule" | "login" | "teams";

/**
 * A collapsible box. Only one box is expanded at a time (single-expand), driven
 * by the parent's `openBox` state. Clicking a collapsed box's header expands it
 * and collapses whichever box was previously open.
 */
function CollapsibleBox({
  id,
  title,
  summary,
  isOpen,
  onToggle,
  children,
}: {
  id: BoxId;
  title: string;
  summary?: string;
  isOpen: boolean;
  onToggle: (id: BoxId) => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border transition-colors",
        isOpen && "border-primary/40 bg-muted/20",
      )}
    >
      <button
        type="button"
        onClick={() => onToggle(id)}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-foreground">{title}</span>
          {summary ? (
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">{summary}</span>
          ) : null}
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
            isOpen && "rotate-180",
          )}
        />
      </button>
      {isOpen ? <div className="border-t border-border px-4 py-4">{children}</div> : null}
    </div>
  );
}

/** Create or edit an internal staff member, with team membership and an optional login. */
export function EmployeeDialog({ open, onOpenChange, companyId, employee }: EmployeeDialogProps) {
  const {
    teams,
    users,
    employees,
    roles,
    employeeLanguages,
    postalCities,
    currentUser,
  } = useApp();
  const { toast } = useToast();
  const employeeMutations = useEmployeeMutations(companyId);
  const [name, setName] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [title, setTitle] = useState<string>("");
  const [phone, setPhone] = useState<string>("");
  const [iceNumber, setIceNumber] = useState<string>("");
  const [address, setAddress] = useState<string>("");
  const [postalCityId, setPostalCityId] = useState<string>(NO_CITY);
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [userId, setUserId] = useState<string>(NO_LOGIN);
  const [roleId, setRoleId] = useState<string>(NO_ROLE);
  const [languageId, setLanguageId] = useState<string>(DEFAULT_LANGUAGE);
  const [secondLanguageId, setSecondLanguageId] = useState<string>(NO_SECOND_LANGUAGE);
  // Single-expand: only one box open at a time. Box 1 (info) starts expanded.
  const [openBox, setOpenBox] = useState<BoxId>("info");
  // Per-day availability: each weekday carries an availability flag plus a
  // preferred (comfortable) window inside a wider acceptable window. Lets an
  // employee work different hours on different days.
  const [availability, setAvailability] = useState<EmployeeAvailabilityDay[]>(() =>
    defaultEmployeeAvailability(),
  );
  const [error, setError] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);
  const isEdit = Boolean(employee);

  const companyTeams = useMemo(
    () => teams.filter((t) => t.companyId === companyId),
    [teams, companyId],
  );

  // Controlled, company-scoped postal cities — the only source of city/postort,
  // mirroring the customer address model (no free-text city).
  const companyPostalCities = useMemo(
    () => activePostalCities(postalCities).filter((c) => c.companyId === companyId),
    [postalCities, companyId],
  );

  // Company-scoped languages. Only active ones are assignable; the resolved
  // default is offered as the implicit "company default" choice.
  const companyLanguages = useMemo(
    () => employeeLanguages.filter((l) => l.companyId === companyId),
    [employeeLanguages, companyId],
  );
  const activeLanguages = useMemo(
    () => listActiveEmployeeLanguages(companyLanguages),
    [companyLanguages],
  );
  const defaultLanguage = useMemo(
    () => getDefaultEmployeeLanguage(companyLanguages),
    [companyLanguages],
  );
  // An assigned language that has since been deactivated isn't in the active
  // list — surface it (as inactive) so editing never silently erases it.
  const inactiveAssignedLanguage = useMemo(() => {
    if (languageId === DEFAULT_LANGUAGE) return null;
    const match = companyLanguages.find((l) => l.id === languageId);
    return match && !match.isActive ? match : null;
  }, [languageId, companyLanguages]);
  // Same preservation rule for an assigned-but-deactivated second language.
  const inactiveSecondLanguage = useMemo(() => {
    if (secondLanguageId === NO_SECOND_LANGUAGE) return null;
    const match = companyLanguages.find((l) => l.id === secondLanguageId);
    return match && !match.isActive ? match : null;
  }, [secondLanguageId, companyLanguages]);

  // Employee-role logins in this company not already linked to another employee.
  const availableLogins = useMemo(() => {
    const takenByOthers = new Set(
      employees.filter((e) => e.id !== employee?.id && e.userId).map((e) => e.userId as string),
    );
    return users.filter(
      (u) =>
        u.companyId === companyId &&
        u.role === "employee" &&
        (!takenByOthers.has(u.id) || u.id === employee?.userId),
    );
  }, [users, employees, companyId, employee?.id, employee?.userId]);

  // Roles a company admin can assign here (active company roles + system
  // templates), resolved through the single permission engine.
  const assignableRoles = useMemo(
    () => listAssignableRoles(companyId, roles, currentUser?.role),
    [companyId, roles, currentUser?.role],
  );

  // The company's system "Employee" role — retained for existing edit-state role display.
  const defaultEmployeeRole = useMemo(
    () => assignableRoles.find((r) => r.isSystem && r.baseRole === "employee") ?? null,
    [assignableRoles],
  );

  // The login currently selected as this employee's account, if any. Roles are
  // assigned to the LOGIN (the authorization subject), never to the employee.
  const linkedUser = useMemo(
    () => (userId === NO_LOGIN ? null : users.find((u) => u.id === userId) ?? null),
    [userId, users],
  );

  // The role currently reflected by the selector (may be an inactive role the
  // login already holds, which still resolves but isn't in the assignable list).
  const selectedRole = useMemo(
    () => (roleId === NO_ROLE ? null : roles.find((r) => r.id === roleId) ?? null),
    [roleId, roles],
  );

  useEffect(() => {
    if (open) {
      setName(employee?.name ?? "");
      setEmail(employee?.email ?? "");
      setTitle(employee?.title ?? "");
      setPhone(employee?.phone ?? "");
      setAddress(employee?.address ?? "");
      setPostalCityId(employee?.postalCityId ?? NO_CITY);
      setTeamIds(employee?.teamIds ?? []);
      setUserId(employee?.userId ?? NO_LOGIN);
      setIceNumber(employee?.iceNumber ?? "");
      setLanguageId(employee?.languageId ?? DEFAULT_LANGUAGE);
      setSecondLanguageId(employee?.secondLanguageId ?? NO_SECOND_LANGUAGE);
      setAvailability(
        normalizeEmployeeAvailability(
          employee?.availability,
          employee?.acceptableHours,
          employee?.preferredHours,
        ),
      );
      setSubmitting(false);
      setError("");
      setOpenBox("info");
    }
  }, [open, employee]);

  /** Single-expand toggle: open the clicked box, or collapse it if already open. */
  const toggleBox = (id: BoxId) => setOpenBox((prev) => (prev === id ? prev : id));

  // Preselect the role from the currently linked login. Re-runs when the linked
  // login changes so the selector always reflects that account's current role.
  // When creating with no existing login linked, default to the system Employee
  // role (a new login is always provisioned, and Employee is the safe default).
  useEffect(() => {
    if (!open) return;
    const linked = userId === NO_LOGIN ? null : users.find((u) => u.id === userId);
    if (linked) {
      setRoleId(linked.roleId ?? NO_ROLE);
      return;
    }
    setRoleId(isEdit ? NO_ROLE : defaultEmployeeRole?.id ?? NO_ROLE);
  }, [open, userId, users, isEdit, defaultEmployeeRole]);

  const toggleTeam = (id: string) => {
    setTeamIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  };

  /** Toggles whether the employee is available to work on a given weekday. */
  const toggleDayAvailable = (weekday: Weekday) => {
    setAvailability((prev) =>
      prev.map((d) => (d.weekday === weekday ? { ...d, isAvailable: !d.isAvailable } : d)),
    );
  };

  /** Updates one edge of a day's preferred or acceptable window. */
  const updateDayWindow = (
    weekday: Weekday,
    kind: "preferred" | "acceptable",
    edge: "start" | "end",
    value: string,
  ) => {
    setAvailability((prev) =>
      prev.map((d) =>
        d.weekday === weekday ? { ...d, [kind]: { ...d[kind], [edge]: value } } : d,
      ),
    );
  };

  /** Copies Monday's availability and windows onto every other weekday. */
  const copyMondayToAll = () => {
    setAvailability((prev) => {
      const monday = prev.find((d) => d.weekday === "monday");
      if (!monday) return prev;
      return prev.map((d) => ({
        ...d,
        isAvailable: monday.isAvailable,
        preferred: { ...monday.preferred },
        acceptable: { ...monday.acceptable },
      }));
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!name.trim() || !email.trim()) {
      setError("Name and email are required.");
      return;
    }
    // Keep the legacy single-window fields meaningful for consumers that read
    // one window, derived from the first available day.
    const representative = representativeWindows(availability);
    const resolvedLanguageId = languageId === DEFAULT_LANGUAGE ? null : languageId;
    const resolvedSecondLanguageId =
      secondLanguageId === NO_SECOND_LANGUAGE ? null : secondLanguageId;
    const resolvedPostalCityId = postalCityId === NO_CITY ? undefined : postalCityId;

    setSubmitting(true);
    try {
      if (isEdit && employee) {
        await employeeMutations.updateEmployee({
          employeeId: employee.id,
          patch: {
            name: name.trim(),
            email: email.trim(),
            title: title.trim() || undefined,
            phone: phone.trim() || undefined,
            iceNumber: iceNumber.trim() || undefined,
            address: address.trim() || undefined,
            postalCityId: resolvedPostalCityId,
            teamIds,
            languageId: resolvedLanguageId,
            secondLanguageId: resolvedSecondLanguageId,
            availability,
            acceptableHours: representative?.acceptable,
            preferredHours: representative?.preferred,
          },
        });
        toast({ title: "Employee updated", description: `${name.trim()} has been saved.` });
        onOpenChange(false);
        return;
      }

      await employeeMutations.createEmployee({
        companyId,
        name: name.trim(),
        email: email.trim(),
        title: title.trim() || undefined,
        phone: phone.trim() || undefined,
        iceNumber: iceNumber.trim() || undefined,
        address: address.trim() || undefined,
        postalCityId: resolvedPostalCityId,
        teamIds,
        userId: null,
        languageId: resolvedLanguageId,
        secondLanguageId: resolvedSecondLanguageId,
        availability,
        acceptableHours: representative?.acceptable,
        preferredHours: representative?.preferred,
      });
      toast({
        title: "Employee added",
        description: `${name.trim()} has been saved. Login setup is deferred.`,
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save employee.");
    } finally {
      setSubmitting(false);
    }
  };

  // Short, human-readable summaries shown on each collapsed box header.
  const preferredLanguageSummary =
    languageId === DEFAULT_LANGUAGE
      ? `Company default${defaultLanguage ? ` · ${defaultLanguage.name}` : ""}`
      : companyLanguages.find((l) => l.id === languageId)?.name ?? "Company default";
  const secondLanguageSummary =
    secondLanguageId === NO_SECOND_LANGUAGE
      ? "Not set"
      : companyLanguages.find((l) => l.id === secondLanguageId)?.name ?? "Not set";
  const loginSummary = linkedUser
    ? `${linkedUser.name} — ${linkedUser.email}`
    : isEdit
      ? "No login connected"
      : "Login setup deferred";
  const roleSummary = isEdit ? selectedRole?.name ?? "Account default" : "Deferred";
  const scheduleSummary = formatAvailabilitySummary(availability);
  const teamsSummary =
    teamIds.length === 0
      ? "Team assignment not selected"
      : `${teamIds.length} team${teamIds.length === 1 ? "" : "s"}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit employee" : "Add employee"}</DialogTitle>
            <DialogDescription>
              Internal staff profile saved to Supabase. Login setup is deferred.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2.5 py-5">
            {/* Box 1 — Employee info */}
            <CollapsibleBox
              id="info"
              title="Employee info"
              summary={name.trim() || "Name, contact details and address"}
              isOpen={openBox === "info"}
              onToggle={toggleBox}
            >
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="emp-name">Full name</Label>
                    <Input
                      id="emp-name"
                      placeholder="e.g. Ingrid Sand"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      autoFocus
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="emp-email">Email</Label>
                    <Input
                      id="emp-email"
                      type="email"
                      placeholder="name@company.io"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="emp-phone">Phone</Label>
                    <Input
                      id="emp-phone"
                      type="tel"
                      placeholder="e.g. +46 70 123 45 67"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="emp-ice">ICE number</Label>
                    <Input
                      id="emp-ice"
                      type="tel"
                      placeholder="In case of emergency"
                      value={iceNumber}
                      onChange={(e) => setIceNumber(e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="emp-address">Address</Label>
                    <Input
                      id="emp-address"
                      placeholder="Street"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="emp-city">City</Label>
                    <Select value={postalCityId} onValueChange={setPostalCityId}>
                      <SelectTrigger id="emp-city">
                        <SelectValue placeholder="Not assigned" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_CITY}>Not assigned</SelectItem>
                        {companyPostalCities.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </CollapsibleBox>

            {/* Box 2 — Languages */}
            <CollapsibleBox
              id="languages"
              title="Languages"
              summary={
                secondLanguageSummary === "Not set"
                  ? preferredLanguageSummary
                  : `${preferredLanguageSummary} · ${secondLanguageSummary}`
              }
              isOpen={openBox === "languages"}
              onToggle={toggleBox}
            >
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="emp-language">Preferred language</Label>
                  <Select value={languageId} onValueChange={setLanguageId}>
                    <SelectTrigger id="emp-language">
                      <SelectValue placeholder="Company default" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={DEFAULT_LANGUAGE}>
                        Company default{defaultLanguage ? ` · ${defaultLanguage.name}` : ""}
                      </SelectItem>
                      {inactiveAssignedLanguage ? (
                        <SelectItem value={inactiveAssignedLanguage.id}>
                          {inactiveAssignedLanguage.name} (inactive)
                        </SelectItem>
                      ) : null}
                      {activeLanguages.map((l) => (
                        <SelectItem key={l.id} value={l.id}>
                          {l.name}
                          {l.nativeName && l.nativeName !== l.name ? ` · ${l.nativeName}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="emp-second-language">Second language</Label>
                  <Select value={secondLanguageId} onValueChange={setSecondLanguageId}>
                    <SelectTrigger id="emp-second-language">
                      <SelectValue placeholder="Not set" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_SECOND_LANGUAGE}>Not set</SelectItem>
                      {inactiveSecondLanguage ? (
                        <SelectItem value={inactiveSecondLanguage.id}>
                          {inactiveSecondLanguage.name} (inactive)
                        </SelectItem>
                      ) : null}
                      {activeLanguages.map((l) => (
                        <SelectItem key={l.id} value={l.id}>
                          {l.name}
                          {l.nativeName && l.nativeName !== l.name ? ` · ${l.nativeName}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <p className="text-xs text-muted-foreground">
                  Used for the employee&rsquo;s portal, checklists and notifications. Managed in
                  Settings &rsaquo; Employee Languages.
                </p>
              </div>
            </CollapsibleBox>

            {/* Box 3 — Role & permissions */}
            <CollapsibleBox
              id="role"
              title="Role & permissions"
              summary={roleSummary}
              isOpen={openBox === "role"}
              onToggle={toggleBox}
            >
              <p className="mb-3 text-xs text-muted-foreground">
                Role and login changes are deferred in EMP-A1; this save only updates the employee profile.
              </p>
              {isEdit && !linkedUser ? (
                <div className="space-y-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
                  <div className="flex items-start gap-2.5">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      This employee has no login yet. Login creation is deferred for the next employee slice.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2.5">
                  <div className="space-y-1.5">
                    <Label htmlFor="emp-role">Assigned role</Label>
                    <Select value={roleId} onValueChange={setRoleId} disabled>
                      <SelectTrigger id="emp-role">
                        <SelectValue placeholder="No role assigned" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_ROLE}>No role (account default)</SelectItem>
                        {selectedRole && !assignableRoles.some((r) => r.id === selectedRole.id) ? (
                          <SelectItem value={selectedRole.id}>
                            {selectedRole.name} (inactive)
                          </SelectItem>
                        ) : null}
                        {assignableRoles.map((r) => (
                          <SelectItem key={r.id} value={r.id}>
                            {r.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {selectedRole ? (
                    <div className="space-y-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" />
                        <span className="text-sm font-medium text-foreground">{selectedRole.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {selectedRole.permissions.length} permission
                          {selectedRole.permissions.length === 1 ? "" : "s"}
                        </span>
                      </div>
                      {selectedRole.description ? (
                        <p className="text-xs text-muted-foreground">{selectedRole.description}</p>
                      ) : null}
                      {selectedRole.permissions.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {selectedRole.permissions.slice(0, 8).map((key) => (
                            <span
                              key={key}
                              className="rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground"
                            >
                              {permissionLabel(key)}
                            </span>
                          ))}
                          {selectedRole.permissions.length > 8 ? (
                            <span className="rounded-full px-2 py-0.5 text-[11px] text-muted-foreground">
                              +{selectedRole.permissions.length - 8} more
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      No explicit role. The login keeps its account-type default permissions.
                    </p>
                  )}
                </div>
              )}
            </CollapsibleBox>

            {/* Box 4 — Availability (per-day acceptable vs. preferred working hours) */}
            <CollapsibleBox
              id="schedule"
              title="Availability"
              summary={scheduleSummary}
              isOpen={openBox === "schedule"}
              onToggle={toggleBox}
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    Mark available days and set each day&rsquo;s working hours. Preferred is the
                    ideal window; acceptable is the widest window the employee will work.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    onClick={copyMondayToAll}
                  >
                    Copy Monday to all
                  </Button>
                </div>

                <div className="space-y-2">
                  {WEEKDAYS.map((weekday) => {
                    const day = availability.find((d) => d.weekday === weekday)!;
                    return (
                      <div
                        key={weekday}
                        className={cn(
                          "rounded-lg border border-border px-3 py-2.5 transition-colors",
                          day.isAvailable ? "bg-background" : "bg-muted/30",
                        )}
                      >
                        <label className="flex cursor-pointer items-center gap-2.5">
                          <Checkbox
                            checked={day.isAvailable}
                            onCheckedChange={() => toggleDayAvailable(weekday)}
                          />
                          <span className="text-sm font-medium text-foreground">
                            {WEEKDAY_LABELS[weekday]}
                          </span>
                          {!day.isAvailable ? (
                            <span className="text-xs text-muted-foreground">Unavailable</span>
                          ) : null}
                        </label>

                        {day.isAvailable ? (
                          <div className="mt-3 grid gap-3 sm:grid-cols-2">
                            <div className="rounded-md border border-border/70 bg-card p-2.5">
                              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                Preferred
                              </p>
                              <div className="flex gap-2">
                                <div className="min-w-0 flex-1">
                                  <Label className="mb-1 block text-xs">Start</Label>
                                  <TimePicker
                                    value={day.preferred.start}
                                    onChange={(v) =>
                                      updateDayWindow(weekday, "preferred", "start", v)
                                    }
                                    aria-label={`${WEEKDAY_LABELS[weekday]} preferred start`}
                                  />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <Label className="mb-1 block text-xs">End</Label>
                                  <TimePicker
                                    value={day.preferred.end}
                                    onChange={(v) =>
                                      updateDayWindow(weekday, "preferred", "end", v)
                                    }
                                    aria-label={`${WEEKDAY_LABELS[weekday]} preferred end`}
                                  />
                                </div>
                              </div>
                            </div>
                            <div className="rounded-md border border-border/70 bg-card p-2.5">
                              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                Acceptable
                              </p>
                              <div className="flex gap-2">
                                <div className="min-w-0 flex-1">
                                  <Label className="mb-1 block text-xs">Start</Label>
                                  <TimePicker
                                    value={day.acceptable.start}
                                    onChange={(v) =>
                                      updateDayWindow(weekday, "acceptable", "start", v)
                                    }
                                    aria-label={`${WEEKDAY_LABELS[weekday]} acceptable start`}
                                  />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <Label className="mb-1 block text-xs">End</Label>
                                  <TimePicker
                                    value={day.acceptable.end}
                                    onChange={(v) =>
                                      updateDayWindow(weekday, "acceptable", "end", v)
                                    }
                                    aria-label={`${WEEKDAY_LABELS[weekday]} acceptable end`}
                                  />
                                </div>
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            </CollapsibleBox>

            {/* Box 5 — Linked login */}
            <CollapsibleBox
              id="login"
              title="Linked login"
              summary={loginSummary}
              isOpen={openBox === "login"}
              onToggle={toggleBox}
            >
              <div className="space-y-1.5">
                <Label htmlFor="emp-login">Linked login</Label>
                <Select value={userId} onValueChange={setUserId} disabled>
                  <SelectTrigger id="emp-login">
                    <SelectValue placeholder="No login connected" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_LOGIN}>
                      {isEdit ? "No login connected" : "Login setup deferred"}
                    </SelectItem>
                    {isEdit
                      ? availableLogins.map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.name} — {u.email}
                          </SelectItem>
                        ))
                      : null}
                  </SelectContent>
                </Select>
                {!isEdit ? (
                  <p className="text-xs text-muted-foreground">
                    EMP-A1 creates the employee profile in Supabase only. Login creation is deferred.
                  </p>
                ) : null}
              </div>
            </CollapsibleBox>

            {/* Box 6 — Teams */}
            <CollapsibleBox
              id="teams"
              title="Teams"
              summary={teamsSummary}
              isOpen={openBox === "teams"}
              onToggle={toggleBox}
            >
              {companyTeams.length === 0 ? (
                <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  No teams yet. Create teams to group employees.
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {companyTeams.map((team) => (
                    <label
                      key={team.id}
                      className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-border px-3 py-2 text-sm"
                    >
                      <Checkbox
                        checked={teamIds.includes(team.id)}
                        onCheckedChange={() => toggleTeam(team.id)}
                      />
                      {team.name}
                    </label>
                  ))}
                </div>
              )}
            </CollapsibleBox>

            {error ? (
              <p className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || employeeMutations.isPending}>
              {submitting || employeeMutations.isPending
                ? "Saving…"
                : isEdit
                  ? "Save changes"
                  : "Add employee"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
