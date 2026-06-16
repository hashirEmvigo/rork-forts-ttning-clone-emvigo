import { describe, expect, it } from "vitest";

import {
  classifyPasswordUpdateError,
  PASSWORD_UPDATE_MESSAGES,
} from "./authPasswordError";

describe("classifyPasswordUpdateError", () => {
  describe("password rejections (link is fine — stay on the form)", () => {
    it("classifies same_password by code", () => {
      const result = classifyPasswordUpdateError({
        message: "New password should be different from the old password.",
        code: "same_password",
      });
      expect(result.kind).toBe("password");
      expect(result.message).toBe(PASSWORD_UPDATE_MESSAGES.samePassword);
    });

    it("classifies same-password by message when no code is present", () => {
      const result = classifyPasswordUpdateError({
        message: "New password should be different from the old password.",
        code: null,
      });
      expect(result.kind).toBe("password");
      expect(result.message).toBe(PASSWORD_UPDATE_MESSAGES.samePassword);
    });

    it("classifies weak_password by code", () => {
      const result = classifyPasswordUpdateError({
        message: "Password is too weak.",
        code: "weak_password",
      });
      expect(result.kind).toBe("password");
      expect(result.message).toBe(PASSWORD_UPDATE_MESSAGES.weakPassword);
    });

    it("classifies a leaked/pwned password message as weak", () => {
      const result = classifyPasswordUpdateError({
        message:
          "This password has been found in a data breach and is too easy to guess.",
        code: null,
      });
      expect(result.kind).toBe("password");
      expect(result.message).toBe(PASSWORD_UPDATE_MESSAGES.weakPassword);
    });

    it("classifies a too-short password message as short", () => {
      const result = classifyPasswordUpdateError({
        message: "Password should be at least 6 characters.",
        code: null,
      });
      expect(result.kind).toBe("password");
      expect(result.message).toBe(PASSWORD_UPDATE_MESSAGES.shortPassword);
    });

    it("classifies validation_failed as a generic password problem", () => {
      const result = classifyPasswordUpdateError({
        message: "Provided parameters are not in the expected format.",
        code: "validation_failed",
      });
      expect(result.kind).toBe("password");
      expect(result.message).toBe(PASSWORD_UPDATE_MESSAGES.genericPassword);
    });
  });

  describe("link/session/token failures (request a new link)", () => {
    it("classifies a missing auth session as a link problem", () => {
      const result = classifyPasswordUpdateError({
        message: "Auth session missing!",
        code: "session_not_found",
      });
      expect(result.kind).toBe("link");
      expect(result.message).toBe(PASSWORD_UPDATE_MESSAGES.link);
    });

    it("classifies an expired OTP/token by code", () => {
      const result = classifyPasswordUpdateError({
        message: "Email link is invalid or has expired",
        code: "otp_expired",
      });
      expect(result.kind).toBe("link");
      expect(result.message).toBe(PASSWORD_UPDATE_MESSAGES.link);
    });

    it("classifies a JWT expiry message without a code as a link problem", () => {
      const result = classifyPasswordUpdateError({
        message: "JWT expired",
        code: null,
      });
      expect(result.kind).toBe("link");
      expect(result.message).toBe(PASSWORD_UPDATE_MESSAGES.link);
    });
  });

  describe("unknown failures", () => {
    it("falls back to a neutral retry message and never blames the link", () => {
      const result = classifyPasswordUpdateError({
        message: "Service temporarily unavailable.",
        code: "internal_error",
      });
      expect(result.kind).toBe("unknown");
      expect(result.message).toBe(PASSWORD_UPDATE_MESSAGES.unknown);
    });

    it("handles null/empty failures gracefully", () => {
      expect(classifyPasswordUpdateError(null).kind).toBe("unknown");
      expect(classifyPasswordUpdateError({ message: null }).kind).toBe("unknown");
      expect(classifyPasswordUpdateError({ message: "" }).kind).toBe("unknown");
    });
  });
});
