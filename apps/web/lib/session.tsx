"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createClient, type ApiClient, type SessionUser, type TokenResponse } from "@fleet/contracts";

interface SessionState {
  user: SessionUser | null;
  ready: boolean;
  api: ApiClient;
  signIn: (r: TokenResponse) => void;
  signOut: () => Promise<void>;
  /** Reload the signed-in user (after changing my name or password). */
  refreshUser: () => Promise<void>;
}

const Ctx = createContext<SessionState | null>(null);

/**
 * The access token lives only in memory; the refresh token is an HttpOnly cookie the
 * browser sends to /api/auth/refresh. A page reload restores the session from the cookie.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const token = useRef<string | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);
  const refreshing = useRef<Promise<string | null> | null>(null);

  const refresh = useCallback(() => {
    refreshing.current ??= fetch("/api/auth/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: "{}", credentials: "same-origin" })
      .then(async (r) => {
        if (!r.ok) {
          token.current = null;
          setUser(null);
          return null;
        }
        const body = (await r.json()) as TokenResponse;
        token.current = body.accessToken;
        setUser(body.user);
        return body.accessToken;
      })
      .catch(() => null)
      .finally(() => { refreshing.current = null; });
    return refreshing.current;
  }, []);

  const api = useMemo(() => createClient({
    baseUrl: "/api",
    credentials: "same-origin",
    getAccessToken: () => token.current,
    onUnauthorized: refresh,
  }), [refresh]);

  useEffect(() => {
    void refresh().finally(() => setReady(true));
  }, [refresh]);

  const value = useMemo<SessionState>(() => ({
    user,
    ready,
    api,
    signIn: (r) => { token.current = r.accessToken; setUser(r.user); },
    signOut: async () => {
      await api.call("logout", { body: {} }).catch(() => {});
      token.current = null;
      setUser(null);
    },
    refreshUser: async () => {
      const me = await api.call("me");
      setUser((u) => (u ? { ...u, ...me } : me));
    },
  }), [user, ready, api]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
}
