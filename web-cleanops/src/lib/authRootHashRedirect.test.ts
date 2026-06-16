import { describe, expect, it } from "vitest";

import { getRootAuthHashRedirect } from "@/lib/authRootHashRedirect";

/**
 * AUTH root-hash catcher: forwards misrouted Supabase auth email links that land
 * on the site root (`/#access_token=...`) to their dedicated route, preserving
 * the full token hash. These tests exercise the pure decision helper.
 */
describe("getRootAuthHashRedirect", () => {
  const recoveryHash =
    "#access_token=eyJ.aaa.bbb&expires_at=1781116503&expires_in=3600" +
    "&refresh_token=rrr-ttt&token_type=bearer&type=recovery";
  const inviteHash =
    "#access_token=eyJ.ccc.ddd&expires_in=3600&refresh_token=uuu-vvv" +
    "&token_type=bearer&type=invite";

  it("routes a recovery token on the root to /reset-password", () => {
    expect(getRootAuthHashRedirect({ pathname: "/", hash: recoveryHash })).toBe(
      `/reset-password${recoveryHash}`,
    );
  });

  it("routes an invite token on the root to /accept-invite", () => {
    expect(getRootAuthHashRedirect({ pathname: "/", hash: inviteHash })).toBe(
      `/accept-invite${inviteHash}`,
    );
  });

  it("routes a signup token on the root to /accept-invite", () => {
    const signupHash =
      "#access_token=eyJ.eee.fff&refresh_token=www-xxx&token_type=bearer&type=signup";
    expect(getRootAuthHashRedirect({ pathname: "/", hash: signupHash })).toBe(
      `/accept-invite${signupHash}`,
    );
  });

  it("preserves every hash parameter verbatim through the redirect", () => {
    const target = getRootAuthHashRedirect({ pathname: "/", hash: recoveryHash });
    expect(target).toContain("access_token=eyJ.aaa.bbb");
    expect(target).toContain("refresh_token=rrr-ttt");
    expect(target).toContain("expires_at=1781116503");
    expect(target).toContain("type=recovery");
  });

  it("normalizes to a single leading # when the hash arrives without one", () => {
    expect(
      getRootAuthHashRedirect({
        pathname: "/",
        hash: "access_token=tok&type=recovery",
      }),
    ).toBe("/reset-password#access_token=tok&type=recovery");
  });

  it("treats a refresh_token-only hash as a valid token", () => {
    const hash = "#refresh_token=only-rt&type=invite";
    expect(getRootAuthHashRedirect({ pathname: "/", hash })).toBe(
      `/accept-invite${hash}`,
    );
  });

  it("ignores non-root paths even with a recovery token", () => {
    expect(
      getRootAuthHashRedirect({ pathname: "/dashboard", hash: recoveryHash }),
    ).toBeNull();
    expect(
      getRootAuthHashRedirect({ pathname: "/reset-password", hash: recoveryHash }),
    ).toBeNull();
  });

  it("ignores a clean root load with no hash", () => {
    expect(getRootAuthHashRedirect({ pathname: "/", hash: "" })).toBeNull();
  });

  it("ignores a root hash that carries no Supabase token", () => {
    expect(
      getRootAuthHashRedirect({ pathname: "/", hash: "#type=recovery" }),
    ).toBeNull();
    expect(
      getRootAuthHashRedirect({ pathname: "/", hash: "#section=pricing" }),
    ).toBeNull();
  });

  it("ignores a token hash with a missing or unhandled type", () => {
    expect(
      getRootAuthHashRedirect({ pathname: "/", hash: "#access_token=tok" }),
    ).toBeNull();
    expect(
      getRootAuthHashRedirect({
        pathname: "/",
        hash: "#access_token=tok&type=magiclink",
      }),
    ).toBeNull();
    expect(
      getRootAuthHashRedirect({
        pathname: "/",
        hash: "#access_token=tok&type=email_change",
      }),
    ).toBeNull();
  });
});
