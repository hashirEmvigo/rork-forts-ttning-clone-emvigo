/**
 * Authentication configuration foundation. The platform is invite-only by
 * design: there is no public sign-up route, and {@link SELF_REGISTRATION_ENABLED}
 * stays false until a deliberate decision is made to open registration. Accounts
 * are provisioned by Super Admins and Company Admins.
 */
export const SELF_REGISTRATION_ENABLED = false;

export type SsoProvider = "google" | "apple";

export interface SsoProviderConfig {
  id: SsoProvider;
  label: string;
  /** Single sign-on is scaffolded but not yet wired to an identity provider. */
  enabled: boolean;
}

/**
 * Single sign-on providers the login screen is prepared for. They render as
 * disabled options today and flip on once an identity provider is connected.
 */
export const SSO_PROVIDERS: SsoProviderConfig[] = [
  { id: "google", label: "Continue with Google", enabled: false },
  { id: "apple", label: "Continue with Apple", enabled: false },
];
