import { describe, expect, it } from "vitest";

import type { UserAuthMeta } from "./adminUserLifecycle";
import {
  canResendInvite,
  deriveInviteStatus,
  inviteStatusLabel,
} from "./userInviteStatus";

/** Builds a UserAuthMeta with sensible defaults. */
const meta = (patch: Partial<UserAuthMeta>): UserAuthMeta => ({
  lastSignInAt: patch.lastSignInAt ?? null,
  emailConfirmedAt: patch.emailConfirmedAt ?? null,
  invitedAt: patch.invitedAt ?? null,
  createdAt: patch.createdAt ?? "2026-01-01T00:00:00.000Z",
});

describe("deriveInviteStatus", () => {
  it("returns 'unknown' when no metadata is available", () => {
    expect(deriveInviteStatus(undefined)).toBe("unknown");
    expect(deriveInviteStatus(null)).toBe("unknown");
  });

  it("returns 'accepted' once the user has signed in at least once", () => {
    expect(
      deriveInviteStatus(meta({ lastSignInAt: "2026-02-01T10:00:00.000Z" })),
    ).toBe("accepted");
  });

  it("returns 'pending' for an invited user who has never signed in", () => {
    expect(
      deriveInviteStatus(meta({ invitedAt: "2026-01-05T00:00:00.000Z", lastSignInAt: null })),
    ).toBe("pending");
  });

  it("returns 'pending' for a provisioned user with no sign-in (temp-password path)", () => {
    expect(
      deriveInviteStatus(meta({ emailConfirmedAt: "2026-01-05T00:00:00.000Z", lastSignInAt: null })),
    ).toBe("pending");
  });
});

describe("inviteStatusLabel", () => {
  it("maps each status to a readable label", () => {
    expect(inviteStatusLabel("accepted")).toBe("Onboarded");
    expect(inviteStatusLabel("pending")).toBe("Invited");
    expect(inviteStatusLabel("unknown")).toBe("—");
  });
});

describe("canResendInvite", () => {
  it("offers resend only for users who have not onboarded", () => {
    expect(canResendInvite("pending")).toBe(true);
    expect(canResendInvite("unknown")).toBe(true);
    expect(canResendInvite("accepted")).toBe(false);
  });
});
