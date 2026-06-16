import type { UserRole } from "@/types";
import type { UsageGateResult } from "@/lib/serviceRegistry";

/**
 * User-facing messaging for a blocked media upload.
 *
 * The upload gate has three distinct reasons a user may be blocked, and each
 * deserves an accurate, role-appropriate explanation instead of a single
 * misleading "you don't have permission" catch-all:
 *
 *  1. `permission`        — the user genuinely lacks the media.manage right.
 *  2. `service_disabled`  — Media Uploads is not entitled for the company.
 *  3. `trial_limit`       — Media Uploads is on a trial that is exhausted.
 *
 * This module is pure and registry-agnostic so the same shape can be reused by
 * future entitlement-gated services (Customer Portal, Employee App, AI Image
 * Analysis, …) — the caller just supplies the service name and gate result.
 */
export type UploadBlockKind = "permission" | "service_disabled" | "trial_limit";

export interface UploadBlockMessage {
  kind: UploadBlockKind;
  title: string;
  description: string;
  /**
   * When true, the user can reach the service-activation surface, so the UI
   * should offer an "Activate Service" action. When false, the message tells
   * them who to contact instead.
   */
  canActivate: boolean;
}

/**
 * Options controlling which roles may reach the service-activation surface.
 *
 * `companyAdminCanActivate` is a forward-looking flag for the planned paid
 * Company Admin self-activation flow ("company_admin_can_activate_services").
 * It defaults to `false`, so today Company Admins get a neutral "your service
 * provider can activate this" message rather than a dead-end button. When the
 * self-activation flow ships, the caller flips this to `true` and the message
 * builder will return an activation CTA for Company Admins too — no other
 * changes required here.
 */
export interface ActivationOptions {
  companyAdminCanActivate?: boolean;
}

/**
 * Whether a role can manage service entitlements (i.e. reach the Services
 * dashboard and turn a service on). In this platform only Super Admin can grant
 * entitlements; the Services route is Super-Admin-only. Company Admins retain
 * upload permission but, until the paid self-activation flow ships, must rely on
 * their service provider to enable a paid service — so they are not offered a
 * dead-end activation button unless `companyAdminCanActivate` is enabled.
 */
export function canActivateServices(
  role: UserRole,
  options: ActivationOptions = {},
): boolean {
  if (role === "super_admin") return true;
  if (role === "company_admin") return options.companyAdminCanActivate === true;
  return false;
}

/** Message shown when the user genuinely lacks upload permission. */
export function describePermissionBlock(): UploadBlockMessage {
  return {
    kind: "permission",
    title: "Permission required",
    description: "You do not have permission to upload media.",
    canActivate: false,
  };
}

/**
 * Builds the explanation for an entitlement/trial block, tailored to the
 * viewer's role. `gate` must be a *blocked* result (status `disabled`, or
 * `trial` with the allowance exhausted).
 */
export function describeEntitlementBlock(
  gate: UsageGateResult,
  role: UserRole,
  serviceName: string = "Media Uploads",
  options: ActivationOptions = {},
): UploadBlockMessage {
  const isTrial = gate.status === "trial";
  const kind: UploadBlockKind = isTrial ? "trial_limit" : "service_disabled";
  const canActivate = canActivateServices(role, options);

  // Usage line, e.g. "30 / 30 images used.", only meaningful on a counted trial.
  const usageLine =
    isTrial && gate.limit !== null
      ? `${gate.used} / ${gate.limit} images used.`
      : null;

  const join = (parts: (string | null)[]): string =>
    parts.filter((p): p is string => Boolean(p)).join(" ");

  if (canActivate) {
    const lead = isTrial
      ? `${serviceName} trial limit reached.`
      : `${serviceName} is not activated for this company.`;
    return {
      kind,
      title: isTrial
        ? `${serviceName} trial limit reached`
        : `Activate ${serviceName}?`,
      description: join([lead, usageLine, "Would you like to activate the service now?"]),
      canActivate: true,
    };
  }

  // Company Admins are administrators themselves, so "contact your
  // administrator" is confusing. Until self-activation ships they get a neutral
  // message pointing at the service provider instead.
  if (role === "company_admin") {
    const lead = isTrial
      ? `${serviceName} trial limit reached.`
      : `${serviceName} is not activated for this company.`;
    return {
      kind,
      title: isTrial
        ? `${serviceName} trial limit reached`
        : `${serviceName} not activated`,
      description: join([lead, usageLine, "This service can be activated by your service provider."]),
      canActivate: false,
    };
  }

  const contact =
    role === "customer" ? "Please contact support." : "Please contact your administrator.";
  const lead = isTrial
    ? `${serviceName} trial limit reached.`
    : `${serviceName} is not available${role === "customer" ? "" : " for this company"}.`;

  return {
    kind,
    title: isTrial ? `${serviceName} trial limit reached` : `${serviceName} not available`,
    description: join([lead, usageLine, contact]),
    canActivate: false,
  };
}
