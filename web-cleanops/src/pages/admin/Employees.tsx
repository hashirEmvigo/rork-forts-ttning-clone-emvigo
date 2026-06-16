import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Archive, Briefcase, Eye, KeyRound, MapPin, MoreHorizontal, Pencil, Plus, Power, Search, Trash2, Users2 } from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { RoleBadge } from "@/components/RoleBadge";
import { EmployeeDialog } from "@/components/employees/EmployeeDialog";
import { EmployeeAreaAccessDialog } from "@/components/employees/EmployeeAreaAccessDialog";
import { PaginationControl } from "@/components/PaginationControl";
import { useApp } from "@/context/AppContext";
import { useDirectoryProfiles } from "@/hooks/use-directory-profiles";
import { useStaffNumbers } from "@/hooks/use-staff-numbers";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { usePagination } from "@/hooks/use-pagination";
import { DEFAULT_SEARCH_MIN_LENGTH, evaluateSearchThreshold } from "@/lib/searchThreshold";
import { useToast } from "@/hooks/use-toast";
import { initials } from "@/lib/format";
import { perf } from "@/lib/perf";
import { areaScopeSummary } from "@/lib/areaScope";
import { resolveEmployeeLanguage } from "@/lib/employeeLanguage";
import { formatCompactAvailability } from "@/lib/employeeSchedule";
import { sendEmployeeLoginEmail } from "@/lib/employeeLoginInvite";
import { postalCityLabel } from "@/lib/postalCity";
import { ROLE_LABELS, type Employee, type User, type UserRole } from "@/types";

/** Roles assignable inline from the employee table, in display order. */
const EDITABLE_ROLES: UserRole[] = ["employee", "company_admin", "super_admin"];

/**
 * Prefix for synthetic, display-only roster rows that represent an admin LOGIN
 * which has no employee profile of its own. Admin accounts (Company Admins and
 * the signed-in Super Admin) are not seeded as employees, so without these rows
 * they would silently vanish from the roster. The prefix is also used to hide
 * the per-row actions menu (there is no employee record to edit/preview/etc.).
 */
const SELF_ROW_PREFIX = "__self__:";

/**
 * Prefix for display-only roster rows sourced from the GLOBAL Supabase `profiles`
 * roster rather than this device's localStorage. They surface staff/admin logins
 * that were provisioned on another device (e.g. a freshly created employee whose
 * rich employee record only lives in the creating browser), so the directory is
 * consistent everywhere and converges on the same source of truth as the Roles &
 * Permissions assigned-user roster. Like self rows, they carry no editable
 * employee record, so their per-row actions menu is hidden and the role is shown
 * read-only.
 */
const PROFILE_ROW_PREFIX = "__profile__:";

/** Roles that belong on the Employees (staff) directory; customers are excluded. */
const STAFF_DIRECTORY_ROLES: UserRole[] = ["super_admin", "company_admin", "employee"];

/**
 * Login roles whose users always surface in the roster even without a linked
 * employee profile, since these accounts are administrators rather than seeded
 * staff. Regular employees always have an employee record and are unaffected.
 */
const ADMIN_DIRECTORY_ROLES: UserRole[] = ["company_admin", "super_admin"];

export default function Employees() {
  // Dev-only render accounting (no-op in production).
  perf.count("Employees.render");
  const { currentUser, employees, users, areas, employeeLanguages, postalCities, updateEmployee, updateUser, createLoginForEmployee, startViewAsEmployee, hasPermission, getEmployeeDeletability, deleteEmployee, archiveEmployee } =
    useApp();
  const canManageEmployees = hasPermission("users.manage");
  // Global identity backbone (Supabase profiles) shared with the assigned-user
  // roster, so logins created on any device appear here too.
  const { profiles } = useDirectoryProfiles();
  // Permanent delete / archive of directory records is restricted to admins.
  const canManageLifecycle =
    currentUser?.role === "super_admin" || currentUser?.role === "company_admin";
  // Role editing reuses the same permission that governs the rest of team management.
  const canManageRoles = hasPermission("users.manage");
  // Object-first access: Teams are reached from the Employees page rather than
  // the main sidebar. Gated by the same permission the route requires.
  const canViewTeams = hasPermission("users.manage");
  const { toast } = useToast();
  const navigate = useNavigate();
  const [query, setQuery] = useState<string>("");
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  // Employee pending a reactivation decision (whether to re-enable its login).
  const [reactivating, setReactivating] = useState<Employee | null>(null);
  // Employee whose Area Scoped Access is being managed (only with a linked login).
  const [managingAreaAccess, setManagingAreaAccess] = useState<Employee | null>(null);
  // Employee pending a delete/archive decision.
  const [lifecycleTarget, setLifecycleTarget] = useState<Employee | null>(null);

  // Super Admins get full role-editing reach and appear in the roster
  // themselves, even though admin accounts are not seeded as employees.
  const isSuperAdmin = currentUser?.role === "super_admin";

  const companyId = currentUser?.companyId ?? "";

  // Database-issued Staff IDs (NUM-1 Phase 3). Employee records resolve by their
  // stable legacy id; everything else (profile logins, synthetic admin rows)
  // resolves by email, the only key every roster row shares.
  const { byEmail: employeeStaffByEmail, byLegacyId: employeeStaffByLegacyId } =
    useStaffNumbers(isSuperAdmin ? null : companyId);

  const scopedEmployees = useMemo(
    () => (isSuperAdmin ? employees : employees.filter((e) => e.companyId === companyId)),
    [employees, companyId, isSuperAdmin],
  );

  /**
   * Display-only rows for admin LOGINS that have no employee profile of their
   * own — the signed-in user (when an admin) plus every Company Admin / Super
   * Admin login in the company. Admin accounts are not seeded as employees, so
   * without these rows a Company Admin (e.g. the viewer themselves, or a peer
   * admin) would be missing from the roster entirely. Synthesized from the login
   * (no employee record is created or persisted) and skipped whenever a real
   * employee row is already linked to that login, so there are never duplicates.
   */
  const adminEmployees = useMemo<Employee[]>(() => {
    // The signed-in user leads (so their "You" row appears first) followed by
    // every admin login in the company. The current Super Admin is included even
    // when their login is absent from the local users collection or carries no
    // companyId, matching how admin accounts are provisioned.
    const candidates: User[] = [];
    if (currentUser && ADMIN_DIRECTORY_ROLES.includes(currentUser.role)) {
      candidates.push(currentUser);
    }
    for (const u of users) {
      if (u.companyId !== companyId) continue;
      if (!ADMIN_DIRECTORY_ROLES.includes(u.role)) continue;
      candidates.push(u);
    }

    const seen = new Set<string>();
    const rows: Employee[] = [];
    for (const u of candidates) {
      if (seen.has(u.id)) continue;
      seen.add(u.id);
      // Already represented by a real employee row → no synthetic duplicate.
      if (scopedEmployees.some((e) => e.userId === u.id)) continue;
      rows.push({
        id: `${SELF_ROW_PREFIX}${u.id}`,
        companyId: u.companyId ?? companyId,
        name: u.name,
        email: u.email,
        status: u.status,
        teamIds: [],
        userId: u.id,
        createdAt: u.createdAt,
      });
    }
    return rows;
  }, [users, companyId, scopedEmployees, currentUser]);

  /**
   * Display-only rows for staff/admin LOGINS that exist in the global Supabase
   * `profiles` roster but have no representation in this device's localStorage —
   * neither a local employee record nor a local admin login. This is what keeps
   * the directory consistent across devices: a colleague created elsewhere still
   * appears. Deduped by email against everything already shown, scoped to the
   * viewer's company (super admins see all), and customers are excluded.
   */
  const directory = useMemo<{ rows: Employee[]; roleById: Map<string, UserRole> }>(() => {
    const represented = new Set<string>();
    const representedLoginIds = new Set<string>();
    for (const e of scopedEmployees) {
      if (e.email) represented.add(e.email.toLowerCase());
      if (e.userId) representedLoginIds.add(e.userId);
    }
    for (const e of adminEmployees) {
      if (e.email) represented.add(e.email.toLowerCase());
      if (e.userId) representedLoginIds.add(e.userId);
    }

    const rows: Employee[] = [];
    const roleById = new Map<string, UserRole>();
    for (const p of profiles) {
      if (!STAFF_DIRECTORY_ROLES.includes(p.baseRole)) continue;
      // Company scoping: company admins only see their own company; a super admin
      // (no companyId) sees every staff profile.
      if (
        companyId &&
        p.companyId &&
        p.companyId !== companyId &&
        currentUser?.role !== "super_admin"
      ) {
        continue;
      }
      const email = p.email?.trim().toLowerCase();
      if (representedLoginIds.has(p.id)) continue;
      if (email && represented.has(email)) continue;
      if (email) represented.add(email);
      const rowId = `${PROFILE_ROW_PREFIX}${p.id}`;
      roleById.set(rowId, p.baseRole);
      rows.push({
        id: rowId,
        companyId: p.companyId ?? companyId,
        name: p.fullName?.trim() || p.email || "Unnamed",
        email: p.email ?? "",
        status: p.status === "active" ? "active" : "inactive",
        teamIds: [],
        userId: p.id,
        createdAt: new Date(0).toISOString(),
      });
    }
    return { rows, roleById };
  }, [profiles, companyId, currentUser, scopedEmployees, adminEmployees]);

  // The full roster shown in the table: admin logins without an employee profile
  // first (signed-in user leading), then profile-only logins from other devices,
  // then real Supabase employee records for the actor's scope.
  const roster = useMemo<Employee[]>(
    () => [...adminEmployees, ...directory.rows, ...scopedEmployees],
    [adminEmployees, directory.rows, scopedEmployees],
  );

  const companyLanguages = useMemo(
    () => employeeLanguages.filter((l) => l.companyId === companyId),
    [employeeLanguages, companyId],
  );

  const cityNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of postalCities) map.set(c.id, postalCityLabel(c));
    return map;
  }, [postalCities]);

  // Search hygiene: debounce, then gate free-text searches behind the shared
  // threshold policy (identifier-style queries still run immediately).
  const debouncedQuery = useDebouncedValue(query, 350);
  const { activeQuery, belowThreshold } = evaluateSearchThreshold(debouncedQuery);

  const filtered = useMemo(() => {
    const q = activeQuery.toLowerCase();
    if (!q) return roster;
    return roster.filter(
      (e) => e.name.toLowerCase().includes(q) || e.email.toLowerCase().includes(q),
    );
  }, [roster, activeQuery]);

  // Paginate before rendering so large rosters never all mount at once.
  const {
    page,
    pageSize,
    totalPages,
    totalItems,
    pageItems,
    startIndex,
    endIndex,
    setPage,
    setPageSize,
  } = usePagination(filtered, { pageSize: 40, resetKey: activeQuery });

  const loginUser = (employee: Employee): User | undefined => {
    if (!employee.userId) return undefined;
    // The synthetic Super Admin row resolves to the current login directly,
    // since admin accounts may not exist in the local users collection.
    if (currentUser && employee.userId === currentUser.id) return currentUser;
    return users.find((u) => u.id === employee.userId);
  };

  /** Whether the actor may inline-edit the role on a given login. */
  const canEditRole = (login: User): boolean => {
    // Super Admins can edit any login's role, including their own.
    if (isSuperAdmin) return true;
    // Company Admins need the permission, can't edit their own role, and only
    // see the dropdown for roles within the inline-editable set.
    if (!canManageRoles) return false;
    if (login.id === currentUser?.id) return false;
    return EDITABLE_ROLES.includes(login.role);
  };
  /**
   * Staff IDs resolvable by email: every employee record (preferred, so a person
   * with both an employee row and a login resolves to the employee's number),
   * then profile logins fill any email not already covered. Bare integers from
   * the database authority — never calculated here.
   */
  const staffNumberByEmail = useMemo(() => {
    const map = new Map<string, number>();
    for (const [email, number] of employeeStaffByEmail) map.set(email, number);
    for (const profile of profiles) {
      const email = profile.email?.trim().toLowerCase();
      if (email && typeof profile.staffNumber === "number" && !map.has(email)) {
        map.set(email, profile.staffNumber);
      }
    }
    return map;
  }, [employeeStaffByEmail, profiles]);
  /**
   * Clean numeric Staff ID for a roster row, with NO prefix and never a technical
   * id (no `emp_…`, no profile UUID). Resolves a real employee row by its legacy
   * id, otherwise by email (covers profile-only and synthetic admin rows). Falls
   * back to "—" only when no Staff ID has been issued for the person.
   */
  const staffIdLabel = (employee: Employee): string => {
    const byLegacyId = employeeStaffByLegacyId.get(employee.id);
    if (typeof byLegacyId === "number") return String(byLegacyId);
    const email = employee.email?.trim().toLowerCase();
    const byEmail = email ? staffNumberByEmail.get(email) : undefined;
    return typeof byEmail === "number" ? String(byEmail) : "—";
  };
  /** Resolved city/postort name from the employee's controlled Postal City. */
  const cityLabel = (employee: Employee): string =>
    employee.postalCityId ? cityNameById.get(employee.postalCityId) ?? "—" : "—";
  /** Area access resolved from the linked login (access is a login concern). */
  const areaAccessLabel = (employee: Employee): string => {
    const login = loginUser(employee);
    return login ? areaScopeSummary(login.areaScope, areas) : "—";
  };
  /**
   * Preferred language by name, resolving an unset language to the company
   * default. An assigned-but-deactivated language is flagged inactive.
   */
  const languageLabel = (employee: Employee): string => {
    const lang = resolveEmployeeLanguage(employee.languageId, companyLanguages);
    if (!lang) return "—";
    return lang.isActive ? lang.name : `${lang.name} (inactive)`;
  };
  /**
   * Compact, single-line availability for the roster: a contiguous, uniform
   * schedule reads as e.g. "Mon–Fri 08:00–16:00"; anything that differs between
   * days collapses to "Variable" to keep the row readable. Synthetic admin rows
   * (no employee profile) carry no availability.
   */
  const availabilityLabel = (employee: Employee): string =>
    employee.id.startsWith(SELF_ROW_PREFIX) || employee.id.startsWith(PROFILE_ROW_PREFIX)
      ? "—"
      : formatCompactAvailability(employee.availability);

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (employee: Employee) => {
    setEditing(employee);
    setDialogOpen(true);
  };

  const readOnlyReason = (isSelfRow: boolean, isProfileRow: boolean): string | null => {
    if (isSelfRow) return "Read-only · Admin login";
    if (isProfileRow) return "Read-only · Login only";
    return null;
  };

  const handleViewAs = (employee: Employee) => {
    const res = startViewAsEmployee(employee.id);
    if (!res.ok) {
      toast({
        title: "Cannot preview",
        description: res.error ?? "Unable to view as this employee.",
        variant: "destructive",
      });
      return;
    }
    navigate("/", { replace: true });
  };

  /**
   * Inline role change for an employee's linked login. Roles live on the User
   * record, so we resolve the linked login and update it via the existing path.
   */
  const changeRole = (employee: Employee, role: UserRole) => {
    const login = loginUser(employee);
    if (!login) {
      toast({
        title: "No login linked",
        description: `${employee.name} has no login account to assign a role to.`,
        variant: "destructive",
      });
      return;
    }
    if (login.role === role) return;
    const res = updateUser(login.id, { role });
    if (!res.ok) {
      toast({
        title: "Could not update role",
        description: res.error ?? "Unable to change this role.",
        variant: "destructive",
      });
      return;
    }
    toast({
      title: "Role updated",
      description: `${employee.name} is now ${ROLE_LABELS[role]}.`,
    });
  };

  /**
   * Emails login access to an existing employee. Sends a password reset when a
   * login is already linked, otherwise an invite that creates/connects login
   * access. Reuses the existing safe mechanisms — no plaintext credentials.
   */
  const sendLoginEmail = async (employee: Employee) => {
    if (!employee.email?.trim()) {
      toast({
        title: "No email address",
        description: `${employee.name} has no email address to send login details to.`,
        variant: "destructive",
      });
      return;
    }
    const hasLogin = Boolean(loginUser(employee));
    const res = await sendEmployeeLoginEmail({
      email: employee.email,
      fullName: employee.name,
      companyId: employee.companyId,
      hasLogin,
    });
    if (res.ok) {
      toast({
        title: res.mode === "reset" ? "Password reset sent" : "Login invite sent",
        description:
          res.mode === "reset"
            ? `A password reset email was sent to ${employee.email}.`
            : `A login invite was emailed to ${employee.email}.`,
      });
      return;
    }
    toast({
      title: res.mode === "reset" ? "Could not send reset" : "Could not send invite",
      description: res.error ?? "The login email could not be sent.",
      variant: "destructive",
    });
  };

  /**
   * Provisions and links a login for a legacy employee that has none, reusing
   * the safe creation path. Hard-block: surfaces a clear error if it fails.
   */
  const createLogin = async (employee: Employee) => {
    if (!employee.email?.trim()) {
      toast({
        title: "No email address",
        description: `${employee.name} needs an email address before a login can be created.`,
        variant: "destructive",
      });
      return;
    }
    const res = await createLoginForEmployee(employee.id);
    if (!res.ok) {
      toast({
        title: "Could not create login",
        description: res.error ?? "Login access could not be created.",
        variant: "destructive",
      });
      return;
    }
    toast({
      title: "Login created",
      description: `${employee.name} now has a linked login. Its role is editable.`,
    });
  };

  /**
   * Deactivates an employee AND disables its linked login so the account can no
   * longer sign in. Guards against the actor locking out their own login.
   */
  const deactivate = (employee: Employee) => {
    const login = loginUser(employee);
    if (login && login.id === currentUser?.id) {
      toast({
        title: "Can't deactivate yourself",
        description: "You cannot deactivate your own account and login.",
        variant: "destructive",
      });
      return;
    }
    updateEmployee(employee.id, { status: "inactive" });
    if (login && login.status !== "inactive") {
      updateUser(login.id, { status: "inactive" });
    }
    toast({
      title: "Employee deactivated",
      description: login
        ? `${employee.name} and their login are now inactive.`
        : `${employee.name} is now inactive.`,
    });
  };

  /** Reactivates the employee, and optionally its linked login. */
  const reactivate = (employee: Employee, withLogin: boolean) => {
    updateEmployee(employee.id, { status: "active" });
    const login = loginUser(employee);
    if (withLogin && login && login.status !== "active") {
      updateUser(login.id, { status: "active" });
    }
    toast({
      title: "Employee activated",
      description:
        withLogin && login
          ? `${employee.name} and their login are active again.`
          : `${employee.name} is active again.`,
    });
    setReactivating(null);
  };

  // Resolved deletability for the employee pending a delete/archive decision:
  // whether a permanent delete is allowed, and why it is blocked when it is not.
  const lifecycleInfo = useMemo(
    () => (lifecycleTarget ? getEmployeeDeletability(lifecycleTarget.id) : null),
    [lifecycleTarget, getEmployeeDeletability],
  );

  /** Permanently deletes the employee (and linked login) after confirmation. */
  const handleDelete = async (employee: Employee) => {
    const res = await deleteEmployee(employee.id);
    if (!res.ok) {
      toast({
        title: "Could not delete",
        description: res.error ?? "This employee could not be deleted.",
        variant: "destructive",
      });
      return;
    }
    toast({
      title: "Employee deleted",
      description: `${employee.name} and their linked login were permanently deleted.`,
    });
    setLifecycleTarget(null);
  };

  /** Archives the employee, preserving operational history. */
  const handleArchive = (employee: Employee) => {
    const res = archiveEmployee(employee.id);
    if (!res.ok) {
      toast({
        title: "Could not archive",
        description: res.error ?? "This employee could not be archived.",
        variant: "destructive",
      });
      return;
    }
    toast({
      title: "Employee archived",
      description: `${employee.name} was archived. Their history is preserved.`,
    });
    setLifecycleTarget(null);
  };

  /**
   * Entry point from the row menu. Deactivation cascades immediately; activation
   * asks first whether the linked login should be re-enabled too.
   */
  const toggleStatus = (employee: Employee) => {
    if (employee.status === "active") {
      deactivate(employee);
      return;
    }
    // Reactivation: confirm whether to also restore login access.
    if (loginUser(employee)) {
      setReactivating(employee);
    } else {
      reactivate(employee, false);
    }
  };

  return (
    <DashboardLayout wide>
      <PageHeader
        title="Employees"
        description="Internal staff profiles. Connect logins and organise people into teams."
        action={
          <div className="flex items-center gap-2">
            {canViewTeams ? (
              <Button variant="outline" onClick={() => navigate("/teams")}>
                <Users2 className="h-4 w-4" /> Teams
              </Button>
            ) : null}
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" /> Add employee
            </Button>
          </div>
        }
      />

      <div className="mb-4 flex items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search employees…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
          {belowThreshold ? (
            <p className="mt-1.5 text-xs text-muted-foreground">
              Type at least {DEFAULT_SEARCH_MIN_LENGTH} characters to search.
            </p>
          ) : null}
        </div>
        <span className="text-sm text-muted-foreground">
          {filtered.length} of {roster.length}
        </span>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Name</TableHead>
              <TableHead>Staff ID</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Address</TableHead>
              <TableHead>City</TableHead>
              <TableHead>Area access</TableHead>
              <TableHead>Language</TableHead>
              <TableHead>Availability</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Employment type</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={13} className="py-16 text-center">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Briefcase className="h-8 w-8 opacity-40" />
                    <p className="text-sm">No employees yet.</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              pageItems.map((employee) => {
                const isSelfRow = employee.id.startsWith(SELF_ROW_PREFIX);
                const isProfileRow = employee.id.startsWith(PROFILE_ROW_PREFIX);
                const isReadOnlyRow = isSelfRow || isProfileRow;
                const readOnlyLabel = readOnlyReason(isSelfRow, isProfileRow);
                return (
                <TableRow key={employee.id}>
                  {/* Name — primary identification: avatar, name, title subtitle */}
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
                        {initials(employee.name)}
                      </div>
                      <div className="leading-tight">
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{employee.name}</p>
                          {employee.userId === currentUser?.id ? (
                            <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                              You
                            </span>
                          ) : null}
                          {readOnlyLabel ? (
                            <span className="inline-flex items-center rounded-full border border-dashed border-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                              {readOnlyLabel}
                            </span>
                          ) : null}
                        </div>
                        {employee.title?.trim() ? (
                          <p className="text-xs text-muted-foreground">{employee.title}</p>
                        ) : null}
                      </div>
                    </div>
                  </TableCell>

                  {/* Staff ID — clean company-scoped number from the allocator; no prefix, no technical id */}
                  <TableCell className="text-muted-foreground">
                    {(() => {
                      const value = staffIdLabel(employee);
                      return value === "—" ? (
                        "—"
                      ) : (
                        <span className="font-mono text-xs tabular-nums">{value}</span>
                      );
                    })()}
                  </TableCell>

                  {/* Phone */}
                  <TableCell className="text-muted-foreground">
                    {employee.phone?.trim() || "—"}
                  </TableCell>

                  {/* Email */}
                  <TableCell className="text-muted-foreground">
                    {employee.email?.trim() ? (
                      <span className="block max-w-[200px] truncate" title={employee.email}>
                        {employee.email}
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>

                  {/* Address (street) */}
                  <TableCell className="text-muted-foreground">
                    {employee.address?.trim() ? (
                      <span className="block max-w-[180px] truncate" title={employee.address}>
                        {employee.address}
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>

                  {/* City (controlled Postal City) */}
                  <TableCell className="text-muted-foreground">
                    {cityLabel(employee)}
                  </TableCell>

                  {/* Area access (from linked login) */}
                  <TableCell className="text-muted-foreground">
                    {areaAccessLabel(employee)}
                  </TableCell>

                  {/* Language (resolved name) */}
                  <TableCell className="text-muted-foreground">
                    {languageLabel(employee)}
                  </TableCell>

                  {/* Availability — compact summary ("Mon–Fri 08:00–16:00" or "Variable") */}
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {availabilityLabel(employee)}
                  </TableCell>

                  {/* Role (from linked login) — inline-editable dropdown */}
                  <TableCell>
                    {(() => {
                      // Profile-only rows come from the global roster and have no
                      // local login to edit — show their role read-only.
                      if (isProfileRow) {
                        const role = directory.roleById.get(employee.id);
                        return role ? (
                          <RoleBadge role={role} />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        );
                      }
                      const login = loginUser(employee);
                      if (!login) {
                        return <span className="text-muted-foreground">—</span>;
                      }
                      if (!canEditRole(login)) {
                        return <RoleBadge role={login.role} />;
                      }
                      // Super Admins may edit logins whose current role sits
                      // outside the standard set — include it so the value is
                      // never blank.
                      const options = EDITABLE_ROLES.includes(login.role)
                        ? EDITABLE_ROLES
                        : [login.role, ...EDITABLE_ROLES];
                      return (
                        <Select
                          value={login.role}
                          onValueChange={(v) => changeRole(employee, v as UserRole)}
                        >
                          <SelectTrigger className="h-8 w-[150px] border-transparent bg-transparent px-2 hover:border-border hover:bg-secondary/60 focus:ring-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {options.map((r) => (
                              <SelectItem key={r} value={r}>
                                {ROLE_LABELS[r]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      );
                    })()}
                  </TableCell>

                  {/* Status */}
                  <TableCell>
                    <StatusBadge status={employee.status} />
                  </TableCell>

                  {/* Employment type — reserved for a future settings module */}
                  <TableCell>
                    <span className="inline-flex items-center rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground/70">
                      Coming soon
                    </span>
                  </TableCell>

                  {/* Actions — real employee records are editable; login-only and
                      synthetic admin rows are explicit read-only roster entries. */}
                  <TableCell>
                    {isReadOnlyRow ? (
                      <span className="text-xs text-muted-foreground">Read-only</span>
                    ) : !canManageEmployees ? (
                      <span className="text-xs text-muted-foreground">No edit permission</span>
                    ) : (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          aria-label={`Employee actions for ${employee.name}`}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(employee)}>
                          <Pencil className="h-4 w-4" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleViewAs(employee)}>
                          <Eye className="h-4 w-4" /> View as employee
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled>
                          <KeyRound className="h-4 w-4" /> Login actions — Coming soon
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled>
                          <MapPin className="h-4 w-4" /> Area access — Coming soon
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled>
                          <Power className="h-4 w-4" /> Status actions — Coming soon
                        </DropdownMenuItem>
                        {canManageLifecycle && employee.userId !== currentUser?.id ? (
                          <DropdownMenuItem disabled className="text-muted-foreground">
                            <Trash2 className="h-4 w-4" /> Delete/archive — Coming soon
                          </DropdownMenuItem>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    )}
                  </TableCell>
                </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <PaginationControl
        page={page}
        pageSize={pageSize}
        totalPages={totalPages}
        totalItems={totalItems}
        startIndex={startIndex}
        endIndex={endIndex}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        itemLabel="employees"
      />

      <EmployeeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        companyId={editing?.companyId ?? companyId}
        employee={editing}
      />

      <EmployeeAreaAccessDialog
        open={Boolean(managingAreaAccess)}
        onOpenChange={(open) => {
          if (!open) setManagingAreaAccess(null);
        }}
        employee={managingAreaAccess}
        login={managingAreaAccess ? loginUser(managingAreaAccess) ?? null : null}
      />

      <AlertDialog
        open={Boolean(reactivating)}
        onOpenChange={(open) => {
          if (!open) setReactivating(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reactivate login access as well?</AlertDialogTitle>
            <AlertDialogDescription>
              {reactivating
                ? `${reactivating.name} will be reactivated. Their login is currently disabled — restoring it lets them sign in again.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setReactivating(null)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={() => reactivating && reactivate(reactivating, false)}
            >
              Reactivate employee only
            </Button>
            <Button onClick={() => reactivating && reactivate(reactivating, true)}>
              Yes, reactivate employee and login
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(lifecycleTarget)}
        onOpenChange={(open) => {
          if (!open) setLifecycleTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {lifecycleInfo?.allowed ? "Delete or archive employee?" : "Archive employee?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {lifecycleTarget && lifecycleInfo?.allowed
                ? `${lifecycleTarget.name} has no operational history (no completed or future missions). You can permanently delete them — this removes the employee profile and their linked login — or archive them to keep the record.`
                : lifecycleTarget
                  ? `${lifecycleTarget.name} has operational history and cannot be permanently deleted. Archive them instead to keep their record while removing them from live views.`
                  : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {lifecycleInfo && !lifecycleInfo.allowed && lifecycleInfo.reasons.length > 0 ? (
            <ul className="list-disc space-y-1 rounded-lg bg-muted/50 px-5 py-3 text-sm text-muted-foreground">
              {lifecycleInfo.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : null}
          <AlertDialogFooter className="gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setLifecycleTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={() => lifecycleTarget && handleArchive(lifecycleTarget)}
            >
              <Archive className="h-4 w-4" /> Archive employee
            </Button>
            {lifecycleInfo?.allowed ? (
              <Button
                variant="destructive"
                onClick={() => lifecycleTarget && handleDelete(lifecycleTarget)}
              >
                <Trash2 className="h-4 w-4" /> Delete permanently
              </Button>
            ) : null}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
