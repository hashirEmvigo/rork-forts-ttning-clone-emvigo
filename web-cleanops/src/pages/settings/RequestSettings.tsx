import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import {
  ArrowLeft,
  ArrowUpRight,
  Bell,
  Building2,
  ClipboardList,
  Clock,
  Inbox,
  Info,
  Lock,
  Sparkles,
  Tags,
  UserCog,
  Users,
  Workflow,
} from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { AccessDenied } from "@/components/AccessDenied";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useApp } from "@/context/AppContext";

/**
 * Company Admin → Settings → Request (frontend/mock foundation).
 *
 * The local, company-level configuration home for the **Admin Requests** product.
 * It is the Company-Admin-local counterpart to the Super Admin global governance
 * surface at `/request-settings`. Everything here is a placeholder: no request
 * creation, list/inbox, assignment, status transitions, comments, notifications,
 * automation, or AI is wired, and nothing persists. Mock/default values only
 * illustrate the eventual shape.
 *
 * Ownership boundary made explicit on this surface:
 *  - Super Admin owns global/system defaults (locked types, statuses, priorities,
 *    SLA + global templates, governance) at `/request-settings`.
 *  - Company Admin owns local request behaviour here (future): local intake,
 *    local categories, default assignment, and local presentation.
 *  - Operational request handling will later live in the Admin Requests module.
 *  - Automation/AI decisions will later be governed by the Automation & AI Center.
 */

type ScopeTone = "local" | "inherited" | "future" | "product";

const SCOPE_BADGE: Record<ScopeTone, { label: string; className: string }> = {
  local: {
    label: "Local",
    className: "border-transparent bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  inherited: {
    label: "From Super Admin",
    className: "border-transparent bg-sky-500/10 text-sky-600 dark:text-sky-400",
  },
  future: {
    label: "Coming later",
    className: "border-transparent bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  product: {
    label: "Admin Requests",
    className: "border-transparent bg-primary/10 text-primary",
  },
};

function ScopeBadge({ tone }: { tone: ScopeTone }) {
  const meta = SCOPE_BADGE[tone];
  return (
    <Badge variant="outline" className={cn("gap-1", meta.className)}>
      {tone === "inherited" ? <Lock className="h-3 w-3" /> : null}
      {meta.label}
    </Badge>
  );
}

interface SettingsCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
  tones?: ScopeTone[];
  children?: React.ReactNode;
}

/** Consistent settings card, matching the Settings/Super Admin surface style. */
function SettingsCard({ icon: Icon, title, description, tones, children }: SettingsCardProps) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{title}</h3>
            {tones?.map((tone) => (
              <ScopeBadge key={tone} tone={tone} />
            ))}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      {children ? <div className="mt-4">{children}</div> : null}
    </section>
  );
}

/** Read-only, system-inherited value chips (locked locally; owned by Super Admin). */
function InheritedChips({ items }: { items: readonly string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span
          key={item}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-2.5 py-1 text-xs font-medium text-foreground"
        >
          <Lock className="h-3 w-3 text-muted-foreground" />
          {item}
        </span>
      ))}
    </div>
  );
}

/**
 * A disabled, read-only preference row. The switch never toggles — it is a
 * "Coming later" placeholder that communicates intent without any runtime
 * behaviour or persistence.
 */
function FuturePreference({
  label,
  description,
  defaultOn = false,
}: {
  label: string;
  description: string;
  defaultOn?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-border bg-muted/30 p-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium">{label}</p>
          <ScopeBadge tone="future" />
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch defaultChecked={defaultOn} disabled aria-label={label} />
    </div>
  );
}

interface DefaultTile {
  label: string;
  value: string;
  tone: ScopeTone;
  hint: string;
}

/** Read-only default tiles (assignment, SLA, presentation) — nothing editable yet. */
function DefaultGrid({ tiles }: { tiles: readonly DefaultTile[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {tiles.map((tile) => (
        <div key={tile.label} className="rounded-xl border border-border bg-muted/30 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {tile.label}
            </p>
            <ScopeBadge tone={tile.tone} />
          </div>
          <p className="mt-1.5 text-sm font-semibold">{tile.value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{tile.hint}</p>
        </div>
      ))}
    </div>
  );
}

const INHERITED_REQUEST_TYPES: readonly string[] = [
  "Equipment & supplies",
  "Facility access / keys",
  "Incident & safety",
  "Staffing & scheduling",
  "Billing & invoicing query",
  "General admin",
];

const ASSIGNMENT_DEFAULTS: readonly DefaultTile[] = [
  {
    label: "Default assignee",
    value: "Unassigned",
    tone: "future",
    hint: "Local routing rules will decide the first responder for new requests.",
  },
  {
    label: "Responsibility",
    value: "Company Admin queue",
    tone: "local",
    hint: "Day-to-day request handling stays with your company.",
  },
];

const SLA_DEFAULTS: readonly DefaultTile[] = [
  {
    label: "First response",
    value: "8h (Standard)",
    tone: "inherited",
    hint: "Global SLA templates come from Super Admin at Request Settings.",
  },
  {
    label: "Local override",
    value: "Not set",
    tone: "future",
    hint: "Local SLA tuning within global limits will be configurable later.",
  },
];

const HANDOFFS: readonly { icon: LucideIcon; name: string; detail: string }[] = [
  {
    icon: Bell,
    name: "Notifications",
    detail:
      "Request-event notifications will be delivered through the Notification Center. Referenced here, not configured or sent.",
  },
  {
    icon: Sparkles,
    name: "Automation & AI",
    detail:
      "Routing, auto-actions, and AI decisions will be governed by the Automation & AI Center. Linked, never executed here.",
  },
  {
    icon: ClipboardList,
    name: "Operational handling",
    detail:
      "Creating, assigning, and resolving requests will live in the Admin Requests operational module — not on this settings surface.",
  },
];

export default function CompanyRequestSettings() {
  const { currentUser } = useApp();

  // Defense-in-depth: the route already gates this to Company Admin with the
  // request-settings permission and a usable `admin-requests` module. Super Admin
  // governs globally at `/request-settings`, so they never use this local surface.
  if (currentUser?.role !== "company_admin") return <AccessDenied />;

  return (
    <DashboardLayout wide>
      <Link
        to="/settings"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Settings
      </Link>

      <PageHeader
        title="Request Settings"
        description="Local company configuration for Admin Requests. Set how your company handles requests; global/system defaults are owned by Super Admin."
        action={<ScopeBadge tone="product" />}
      />

      <div className="max-w-3xl space-y-5">
        <div className="flex items-start gap-2.5 rounded-xl border border-sky-300 bg-sky-50 px-4 py-3 text-sm text-sky-900 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-200">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            This is a local company settings foundation. Global/system defaults — locked request
            types, statuses, priorities, SLA and global templates — are owned by Super Admin at{" "}
            <span className="font-semibold">Request Settings</span>. Operational request handling and
            Automation &amp; AI remain future scope. Nothing here is active or saved yet.
          </p>
        </div>

        <SettingsCard
          icon={Inbox}
          title="Local request intake"
          description="How requests enter your company's queue. These are read-only placeholders — no intake runtime is active in this foundation."
          tones={["local", "future"]}
        >
          <div className="space-y-3">
            <FuturePreference
              label="Accept internal admin requests"
              description="Allow your team to raise Admin Requests into the company queue."
              defaultOn
            />
            <FuturePreference
              label="Inherit Super Admin request types"
              description="Use the global/system request types as your starting catalogue."
              defaultOn
            />
            <FuturePreference
              label="Require category on new requests"
              description="Make request category mandatory at intake for cleaner reporting."
            />
          </div>
        </SettingsCard>

        <SettingsCard
          icon={Tags}
          title="Company request categories & types"
          description="Your local catalogue starts from the Super-Admin-owned system types below. Adding local categories/types will arrive in a later wave."
          tones={["inherited", "future"]}
        >
          <div className="space-y-3">
            <InheritedChips items={INHERITED_REQUEST_TYPES} />
            <div className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
              <Lock className="h-3.5 w-3.5 shrink-0" />
              System types are inherited and locked locally. Local request types are a future
              addition and cannot be created yet.
            </div>
          </div>
        </SettingsCard>

        <SettingsCard
          icon={UserCog}
          title="Assignment & responsibility"
          description="Who handles requests by default. Day-to-day handling belongs to your company; routing rules are a future addition."
          tones={["local", "future"]}
        >
          <DefaultGrid tiles={ASSIGNMENT_DEFAULTS} />
        </SettingsCard>

        <SettingsCard
          icon={Clock}
          title="SLA & response-time defaults"
          description="Service-level expectations for your company. Global SLA templates are owned by Super Admin; local tuning within those limits will come later."
          tones={["inherited", "future"]}
        >
          <DefaultGrid tiles={SLA_DEFAULTS} />
        </SettingsCard>

        <SettingsCard
          icon={Users}
          title="Request sources"
          description="Where requests originate. Admin Requests covers internal admin intake today. Customer and employee request sources belong to a separate future product and are shown here only as disabled placeholders."
          tones={["future"]}
        >
          <div className="space-y-3">
            <FuturePreference
              label="Internal admin source"
              description="Admin-raised requests within your company (Admin Requests)."
              defaultOn
            />
            <FuturePreference
              label="Customer request source"
              description="Part of a separate future product — not available in Admin Requests."
            />
            <FuturePreference
              label="Employee request source"
              description="Part of a separate future product — not available in Admin Requests."
            />
          </div>
        </SettingsCard>

        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Workflow className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">Handoffs to other systems</h3>
                <ScopeBadge tone="future" />
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Where request behaviour will later connect. These are owned by separate workstreams
                and are not built, configured, or triggered here.
              </p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {HANDOFFS.map((handoff) => (
              <div
                key={handoff.name}
                className="rounded-xl border border-dashed border-border bg-muted/20 p-4"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <handoff.icon className="h-4 w-4" />
                </div>
                <p className="mt-2.5 text-sm font-medium">{handoff.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">{handoff.detail}</p>
              </div>
            ))}
          </div>
        </div>

        <SettingsCard
          icon={Building2}
          title="Governance & ownership"
          description="How local and global request settings relate."
          tones={["local", "inherited"]}
        >
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span>
                Super Admin owns global/system defaults and locked governance at{" "}
                <Link to="/request-settings" className="font-medium text-foreground underline-offset-2 hover:underline">
                  Request Settings
                </Link>
                . Those defaults are read-only here.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              Company Admin configures local behaviour here; local settings never override
              Super-Admin-locked governance.
            </li>
            <li className="flex items-start gap-2">
              <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              Module availability is governed by your company entitlement and your local module
              activation in Settings → Modules.
            </li>
          </ul>
        </SettingsCard>

        <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Foundation only. The operational request handler, local persistence, notifications, and
            Automation &amp; AI remain future scope and are intentionally not part of this surface.
          </p>
        </div>
      </div>
    </DashboardLayout>
  );
}
