import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  Bell,
  FileText,
  Flag,
  Info,
  Inbox,
  Lock,
  ShieldCheck,
  Sparkles,
  Tags,
  Timer,
  Workflow,
  Zap,
} from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { AccessDenied } from "@/components/AccessDenied";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useApp } from "@/context/AppContext";

/**
 * Super Admin → Request Settings (frontend/mock foundation).
 *
 * Global/system Request governance tied to the **Admin Requests** product. This
 * is configuration/governance only — it is NOT the operational request inbox
 * (Company Admin owns day-to-day request handling). Everything here is a
 * placeholder: no request creation, list, assignment, status transitions,
 * notifications, or auto-actions are wired. Mock data illustrates the eventual
 * shape only.
 *
 * Ownership boundary made explicit on this surface:
 * - Super Admin owns global/system request types, locked defaults, global
 *   templates, governance/audit policy, and links to future Notification /
 *   Auto-Action templates.
 * - Company Admin (future `/settings/request`) owns local request settings,
 *   editable variants, and the operational dashboard/list/inbox.
 */

type ScopeTone = "system" | "locked" | "global" | "future" | "product";

const SCOPE_BADGE: Record<ScopeTone, { label: string; className: string }> = {
  system: { label: "System", className: "border-transparent bg-primary/10 text-primary" },
  locked: { label: "Locked", className: "border-border bg-muted text-muted-foreground" },
  global: {
    label: "Global default",
    className: "border-transparent bg-sky-500/10 text-sky-600 dark:text-sky-400",
  },
  future: {
    label: "Future",
    className: "border-transparent bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  product: {
    label: "Admin Requests",
    className: "border-transparent bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
};

function ScopeBadge({ tone }: { tone: ScopeTone }) {
  const meta = SCOPE_BADGE[tone];
  return (
    <Badge variant="outline" className={cn("gap-1", meta.className)}>
      {tone === "locked" ? <Lock className="h-3 w-3" /> : null}
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

/** Consistent governance card matching the Super Admin settings surface style. */
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

/** Locked, system-controlled value chips (request types, statuses, priorities). */
function LockedChips({ items }: { items: readonly string[] }) {
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

interface TemplateTile {
  name: string;
  detail: string;
  tone: ScopeTone;
}

/** Placeholder template/SLA tiles — display only, nothing is editable yet. */
function TemplateGrid({ tiles }: { tiles: readonly TemplateTile[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {tiles.map((tile) => (
        <div key={tile.name} className="rounded-xl border border-border bg-muted/30 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">{tile.name}</p>
            <ScopeBadge tone={tile.tone} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{tile.detail}</p>
        </div>
      ))}
    </div>
  );
}

const SYSTEM_REQUEST_TYPES: readonly string[] = [
  "Equipment & supplies",
  "Facility access / keys",
  "Incident & safety",
  "Staffing & scheduling",
  "Billing & invoicing query",
  "General admin",
];

const DEFAULT_STATUSES: readonly string[] = ["New", "Open", "Waiting", "Resolved", "Closed"];

const DEFAULT_PRIORITIES: readonly string[] = ["Low", "Normal", "High", "Urgent"];

const SLA_TEMPLATES: readonly TemplateTile[] = [
  { name: "Standard SLA", detail: "First response 8h · Resolve within 3 business days.", tone: "system" },
  { name: "Urgent SLA", detail: "First response 1h · Resolve same business day.", tone: "system" },
  { name: "Internal Admin SLA", detail: "First response 4h · Resolve within 2 business days.", tone: "system" },
];

const GLOBAL_TEMPLATES: readonly TemplateTile[] = [
  { name: "New equipment request", detail: "Locked system template — Company Admin may copy a local variant later.", tone: "locked" },
  { name: "Access / key request", detail: "Locked system template — cannot be edited locally.", tone: "locked" },
  { name: "Incident report", detail: "Locked system template — governs safety request intake.", tone: "locked" },
  { name: "General admin request", detail: "Global template — Company Admin may copy/use where allowed.", tone: "global" },
];

const FUTURE_INTEGRATIONS: readonly { icon: LucideIcon; name: string; detail: string }[] = [
  {
    icon: Bell,
    name: "Notification templates",
    detail: "Global notification templates for request events. Owned by a separate system — referenced here, not built.",
  },
  {
    icon: Zap,
    name: "Auto-Action templates",
    detail: "Global automated-action templates for requests. Owned by a separate system — referenced here, not built.",
  },
  {
    icon: Sparkles,
    name: "Automation & AI Center",
    detail: "Central automation/AI policy that will later drive request routing and actions. Linked, not configured here.",
  },
];

export default function RequestSettings() {
  const { currentUser } = useApp();

  if (currentUser?.role !== "super_admin") return <AccessDenied />;

  return (
    <DashboardLayout wide>
      <PageHeader
        title="Request Settings"
        description="Global system configuration for Admin Requests. Super Admin owns global/system request governance; Company Admin handles day-to-day requests."
        action={<ScopeBadge tone="product" />}
      />

      <div className="max-w-3xl space-y-5">
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            This is not the operational request inbox. Company Admin handles day-to-day requests.
            This surface defines global/system governance only — tied to{" "}
            <span className="font-semibold">Admin Requests</span>. Employee &amp; Customer Requests
            is a separate future product.
          </p>
        </div>

        <SettingsCard
          icon={Tags}
          title="Global / system request types"
          description="Platform-locked request types that every entitled company inherits. Company Admin may add local types later; these system types cannot be edited or removed locally."
          tones={["system", "locked"]}
        >
          <LockedChips items={SYSTEM_REQUEST_TYPES} />
        </SettingsCard>

        <SettingsCard
          icon={Workflow}
          title="Locked default statuses"
          description="The global request lifecycle every company starts from. System-controlled and consistent across the platform."
          tones={["global", "locked"]}
        >
          <LockedChips items={DEFAULT_STATUSES} />
        </SettingsCard>

        <SettingsCard
          icon={Flag}
          title="Locked default priorities"
          description="Global priority defaults applied to new requests. System-controlled global defaults."
          tones={["global", "locked"]}
        >
          <LockedChips items={DEFAULT_PRIORITIES} />
        </SettingsCard>

        <SettingsCard
          icon={Timer}
          title="SLA templates"
          description="Global service-level templates available to entitled companies. Placeholders only — no SLA timing engine runs in this foundation."
          tones={["system"]}
        >
          <TemplateGrid tiles={SLA_TEMPLATES} />
        </SettingsCard>

        <SettingsCard
          icon={FileText}
          title="Global request templates / system templates"
          description="Platform request templates. Locked/system templates cannot be edited locally; global templates may later be copied/used by Company Admin where allowed."
          tones={["system", "global"]}
        >
          <TemplateGrid tiles={GLOBAL_TEMPLATES} />
        </SettingsCard>

        <SettingsCard
          icon={ShieldCheck}
          title="Governance & audit"
          description="Changes to global request configuration should later be logged and audited. No audit engine is built in this foundation — this records the governance intent and ownership boundary."
          tones={["system"]}
        >
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              Edits to locked types, statuses, priorities, and global templates are Super-Admin-only.
            </li>
            <li className="flex items-start gap-2">
              <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              Future: every global change is recorded to an audit history with actor and timestamp.
            </li>
            <li className="flex items-start gap-2">
              <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              Company Admin local settings never override Super-Admin-locked governance.
            </li>
          </ul>
        </SettingsCard>

        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Inbox className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">Future integrations</h3>
                <ScopeBadge tone="future" />
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Linked systems that request governance will reference later. These are owned by
                separate workstreams and are not built or configured here.
              </p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {FUTURE_INTEGRATIONS.map((integration) => (
              <div
                key={integration.name}
                className="rounded-xl border border-dashed border-border bg-muted/20 p-4"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <integration.icon className="h-4 w-4" />
                </div>
                <p className="mt-2.5 text-sm font-medium">{integration.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">{integration.detail}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Foundation only. Company Admin request settings, the operational request handler, and
            Employee &amp; Customer Requests remain future scope and are intentionally not part of
            this surface.
          </p>
        </div>
      </div>
    </DashboardLayout>
  );
}
