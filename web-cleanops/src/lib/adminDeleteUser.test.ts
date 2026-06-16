import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Validates the client side of the "delete releases the email for reuse" fix.
 *
 * Scenario from the bug report:
 *   1. Create an employee with a login using email X.
 *   2. Permanently delete the employee (no operational history).
 *   3. Create a new employee with the same email X → must succeed.
 *
 * The email is only freed when the linked Supabase Auth user (and its cascaded
 * `profiles` row, which holds the duplicate-blocking email) is removed via the
 * `admin-delete-user` Edge Function. These tests assert that `deleteSupabaseUser`:
 *   - skips local-only (non-UUID) logins with nothing to delete server-side,
 *   - posts the auth user id to the delete function and reports success,
 *   - surfaces a clear error (so the caller aborts and never orphans the login).
 */

vi.mock("@/lib/supabase", () => ({
  supabase: { auth: {} },
  isSupabaseConfigured: true,
}));

vi.mock("@/lib/authSupabase", () => ({
  getSession: vi.fn(async () => ({
    session: { access_token: "session-token" },
    error: null,
  })),
  isSupabaseAuthEnabled: true,
}));

const SUPABASE_URL = "https://example.supabase.co";
const ANON_KEY = "anon-key";
const VALID_UUID = "11111111-1111-4111-8111-111111111111";

async function loadHelper() {
  vi.stubEnv("EXPO_PUBLIC_SUPABASE_URL", SUPABASE_URL);
  vi.stubEnv("EXPO_PUBLIC_SUPABASE_ANON_KEY", ANON_KEY);
  vi.resetModules();
  return await import("./adminCreateUser");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("deleteSupabaseUser", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, userId: VALID_UUID }),
    }));
    vi.stubGlobal("fetch", fetchMock);
  });

  it("skips the server call for a local-only id with no email fallback", async () => {
    const { deleteSupabaseUser } = await loadHelper();
    const res = await deleteSupabaseUser("usr_local_123");
    expect(res.ok).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to email when the id is local/non-UUID (legacy users)", async () => {
    const { deleteSupabaseUser } = await loadHelper();
    const res = await deleteSupabaseUser("usr_local_123", "Legacy@Example.com");
    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${SUPABASE_URL}/functions/v1/admin-delete-user`);
    // No user_id (it was not a UUID); email is lowercased.
    expect(JSON.parse(String(init.body))).toEqual({ email: "legacy@example.com" });
  });

  it("sends both id and email when a valid UUID and email are present", async () => {
    const { deleteSupabaseUser } = await loadHelper();
    const res = await deleteSupabaseUser(VALID_UUID, "person@example.com");
    expect(res.ok).toBe(true);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      user_id: VALID_UUID,
      email: "person@example.com",
    });
  });

  it("posts the auth user id to admin-delete-user and reports success", async () => {
    const { deleteSupabaseUser } = await loadHelper();
    const res = await deleteSupabaseUser(VALID_UUID);
    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${SUPABASE_URL}/functions/v1/admin-delete-user`);
    expect(JSON.parse(String(init.body))).toEqual({ user_id: VALID_UUID });
  });

  it("surfaces an error so the caller aborts (no orphaned login)", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ error: "Not authorized to delete users." }),
    });
    const { deleteSupabaseUser } = await loadHelper();
    const res = await deleteSupabaseUser(VALID_UUID);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("Not authorized");
  });
});
