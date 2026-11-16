import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AuthStatus, SessionUser } from "@nebula/shared";
import { sendJson, UNAUTHORIZED_EVENT, type ApiResult } from "./useApi";

type State = { phase: "loading" } | { phase: "error" } | { phase: "ready"; setupRequired: boolean; user: SessionUser | null };

interface AuthApi {
  state: State;
  user: SessionUser | null;
  login: (username: string, password: string) => Promise<ApiResult<SessionUser>>;
  setup: (username: string, password: string) => Promise<ApiResult<SessionUser>>;
  logout: () => Promise<void>;
  retry: () => void;
}

const Ctx = createContext<AuthApi | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    fetch("/api/auth/status")
      .then((r) => r.json() as Promise<AuthStatus>)
      .then((s) => alive && setState({ phase: "ready", setupRequired: s.setupRequired, user: s.user }))
      .catch(() => alive && setState({ phase: "error" }));
    return () => { alive = false; };
  }, [tick]);

  // La sesión caducó o se revocó: se vuelve al acceso sin perder la dirección en la que estabas.
  useEffect(() => {
    const onUnauthorized = () => setState((s) => (s.phase === "ready" ? { ...s, user: null } : s));
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const enter = useCallback(async (path: string, username: string, password: string) => {
    const r = await sendJson<SessionUser>("POST", path, { username, password });
    if (r.ok) setState({ phase: "ready", setupRequired: false, user: r.data });
    return r;
  }, []);

  const api = useMemo<AuthApi>(() => ({
    state,
    user: state.phase === "ready" ? state.user : null,
    login: (u, p) => enter("/api/auth/login", u, p),
    setup: (u, p) => enter("/api/auth/setup", u, p),
    logout: async () => {
      await sendJson("POST", "/api/auth/logout");
      setState((s) => (s.phase === "ready" ? { ...s, user: null } : s));
    },
    retry: () => { setState({ phase: "loading" }); setTick((t) => t + 1); },
  }), [state, enter]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth fuera de AuthProvider");
  return v;
}

/** Usuario con sesión iniciada (solo dentro de las pantallas protegidas). */
export function useUser(): SessionUser {
  const { user } = useAuth();
  if (!user) throw new Error("useUser sin sesión");
  return user;
}
