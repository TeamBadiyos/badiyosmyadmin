import type { SupabaseClient } from "@supabase/supabase-js";

type Auth = Pick<SupabaseClient["auth"], "refreshSession" | "signOut" | "getSession" | "getUser">;

export function isInvalidSession(error: { status?: number; code?: string; message?: string } | null) {
  return Boolean(error && (error.status === 401 || /jwt|token.*(?:invalid|expired)/i.test(error.message ?? "") || error.code === "session_not_found"));
}

// Dependencies keep recovery testable without real accounts or network requests.
export function createSessionRecovery(getAuth: () => Auth, fetcher: typeof fetch, onExpired: () => void) {
  let refresh: Promise<string | null> | undefined;
  let relogin: Promise<void> | undefined;

  function forceRelogin() {
    if (!relogin) {
      relogin = (async () => {
        try {
          await getAuth().signOut({ scope: "local" });
        } finally {
          onExpired();
        }
      })();
    }
    return relogin;
  }

  function refreshOrSignOut(): Promise<string | null> {
    if (!refresh) {
      refresh = (async () => {
        try {
          const { data, error } = await getAuth().refreshSession();
          if (!error && data.session?.access_token) return data.session.access_token;
        } catch {
          // A failed refresh must not leave unusable protected content open.
        }
        await forceRelogin();
        return null;
      })().finally(() => { refresh = undefined; });
    }
    return refresh;
  }

  const sessionSafeFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    // Auth requests must bypass recovery to avoid refresh recursion.
    if (new URL(request.url).pathname.startsWith("/auth/v1/")) return fetcher(input, init);
    const response = await fetcher(request.clone());
    if (response.status !== 401) return response;
    const token = await refreshOrSignOut();
    if (!token) return response;
    const headers = new Headers(request.headers);
    headers.set("Authorization", `Bearer ${token}`);
    const retry = await fetcher(new Request(request, { headers }));
    if (retry.status === 401) await forceRelogin();
    return retry;
  };

  async function verifySessionOnStart() {
    const { data } = await getAuth().getSession();
    if (!data.session) return;
    const { error } = await getAuth().getUser();
    if (isInvalidSession(error)) await refreshOrSignOut();
  }

  return { sessionSafeFetch, refreshOrSignOut, verifySessionOnStart };
}