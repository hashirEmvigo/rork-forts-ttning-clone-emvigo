import { describe, expect, it } from "vitest";

import {
  describeSupabaseAuthLinkError,
  parseSupabaseAuthLinkError,
  type SupabaseAuthLinkError,
} from "./authUrlError";

describe("parseSupabaseAuthLinkError", () => {
  it("returns null for a clean URL with no error params", () => {
    expect(parseSupabaseAuthLinkError({ hash: "", search: "" })).toBeNull();
    expect(
      parseSupabaseAuthLinkError({
        hash: "#access_token=abc&type=recovery",
        search: "",
      }),
    ).toBeNull();
  });

  it("parses the standard expired-recovery error hash", () => {
    const result = parseSupabaseAuthLinkError({
      hash: "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
      search: "",
    });
    expect(result).toEqual<SupabaseAuthLinkError>({
      error: "access_denied",
      errorCode: "otp_expired",
      description: "Email link is invalid or has expired",
    });
  });

  it("decodes %20-encoded descriptions", () => {
    const result = parseSupabaseAuthLinkError({
      hash: "#error_code=otp_expired&error_description=Email%20link%20is%20invalid",
      search: "",
    });
    expect(result?.description).toBe("Email link is invalid");
  });

  it("falls back to query-string params when the hash has none", () => {
    const result = parseSupabaseAuthLinkError({
      hash: "",
      search: "?error=server_error&error_description=Something+went+wrong",
    });
    expect(result?.error).toBe("server_error");
    expect(result?.description).toBe("Something went wrong");
  });

  it("prefers the hash over the query string", () => {
    const result = parseSupabaseAuthLinkError({
      hash: "#error_code=otp_expired",
      search: "?error_code=other",
    });
    expect(result?.errorCode).toBe("otp_expired");
  });
});

describe("describeSupabaseAuthLinkError", () => {
  it("gives a clear used/expired message for recovery", () => {
    const msg = describeSupabaseAuthLinkError(
      { error: "access_denied", errorCode: "otp_expired", description: null },
      "recovery",
    );
    expect(msg).toMatch(/already been used or has expired/i);
    expect(msg).toMatch(/request a new one/i);
  });

  it("gives an invite-specific used/expired message", () => {
    const msg = describeSupabaseAuthLinkError(
      { error: "access_denied", errorCode: "otp_expired", description: null },
      "invite",
    );
    expect(msg).toMatch(/already been used or has expired/i);
    expect(msg).toMatch(/ask an admin/i);
  });

  it("falls back to the GoTrue description for unknown errors", () => {
    const msg = describeSupabaseAuthLinkError(
      { error: "server_error", errorCode: null, description: "Database timeout" },
      "recovery",
    );
    expect(msg).toBe("Database timeout");
  });
});
