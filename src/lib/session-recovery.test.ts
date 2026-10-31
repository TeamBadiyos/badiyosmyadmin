import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSessionRecovery } from "./session-recovery";

function setup(fetcher = vi.fn<typeof fetch>()) {
  const auth = {
    refreshSession: vi.fn().mockResolvedValue({ data: { session: { access_token: "new-token" } }, error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: "old-token" } } }),
    getUser: vi.fn().mockResolvedValue({ error: null }),
  };
  const expired = vi.fn();
  const recovery = createSessionRecovery(() => auth as unknown as SupabaseClient["auth"], fetcher, expired);
  return { auth, expired, fetcher, ...recovery };
}

describe("expired login recovery", () => {
  it("shares one refresh across simultaneous 401s and retries with the original body and apikey", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const request = input as Request;
      return new Response(null, { status: request.headers.get("Authorization") === "Bearer new-token" ? 200 : 401 });
    });
    const s = setup(fetcher);
    let complete: ((value: unknown) => void) | undefined;
    s.auth.refreshSession.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const send = () => s.sessionSafeFetch("https://example.test/rest/v1/orders", {
      method: "POST", headers: { apikey: "unchanged-key", Authorization: "Bearer old-token" }, body: '{"amount":50}',
    });
    const pending = [send(), send()];
    await vi.waitFor(() => expect(s.auth.refreshSession).toHaveBeenCalledTimes(1));
    complete?.({ data: { session: { access_token: "new-token" } }, error: null });
    expect((await Promise.all(pending)).map(r => r.status)).toEqual([200, 200]);
    expect(fetcher).toHaveBeenCalledTimes(4);
    const retry = fetcher.mock.calls[2][0] as Request;
    expect(retry.headers.get("apikey")).toBe("unchanged-key");
    expect(await retry.text()).toBe('{"amount":50}');
  });

  it("does not intercept or retry auth endpoints", async () => {
    const s = setup(vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 })));
    await s.sessionSafeFetch("https://example.test/auth/v1/user");
    expect(s.auth.refreshSession).not.toHaveBeenCalled();
    expect(s.fetcher).toHaveBeenCalledTimes(1);
  });

  it("signs out and returns to login if refreshing fails, without retrying", async () => {
    const s = setup(vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 })));
    s.auth.refreshSession.mockResolvedValue({ data: { session: null }, error: { status: 401 } });
    await s.sessionSafeFetch("https://example.test/rest/v1/orders");
    expect(s.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(s.expired).toHaveBeenCalledTimes(1);
    expect(s.fetcher).toHaveBeenCalledTimes(1);
  });

  it("never retries a request more than once, even if the new token is rejected", async () => {
    const s = setup(vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 })));
    await s.sessionSafeFetch("https://example.test/rest/v1/orders");
    expect(s.fetcher).toHaveBeenCalledTimes(2);
    expect(s.auth.refreshSession).toHaveBeenCalledTimes(1);
    expect(s.expired).toHaveBeenCalledTimes(1);
  });

  it("validates saved sessions on startup and recovers JWT failures", async () => {
    const s = setup();
    s.auth.getUser.mockResolvedValue({ error: { status: 401, message: "JWT expired" } });
    await s.verifySessionOnStart();
    expect(s.auth.getUser).toHaveBeenCalledTimes(1);
    expect(s.auth.refreshSession).toHaveBeenCalledTimes(1);
  });

  it("leaves signed-out startup and non-auth errors alone", async () => {
    const s = setup();
    s.auth.getSession.mockResolvedValueOnce({ data: { session: null } });
    await s.verifySessionOnStart();
    expect(s.auth.getUser).not.toHaveBeenCalled();
    s.auth.getUser.mockResolvedValue({ error: { status: 503, message: "Offline" } });
    await s.verifySessionOnStart();
    expect(s.auth.refreshSession).not.toHaveBeenCalled();
  });
});