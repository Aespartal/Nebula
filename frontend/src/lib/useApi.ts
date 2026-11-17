import { useCallback, useEffect, useState } from "react";

interface State<T> { data: T | null; error: string | null; loading: boolean }

export function describeHttpError(status: number): string {
  if (status === 404) return "No se encontró lo que buscabas. Puede que se haya movido o borrado.";
  return `El servidor respondió con un error (código ${status}).`;
}

/** Las pantallas reaccionan a este aviso mostrando el acceso (la sesión caducó o se cerró en otro sitio). */
export const UNAUTHORIZED_EVENT = "nebula:unauthorized";

/** `path` null = no cargar nada (p. ej. secciones que solo ve un administrador). */
export function useApi<T>(path: string | null) {
  const [state, setState] = useState<State<T>>({ data: null, error: null, loading: path !== null });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (path === null) { setState({ data: null, error: null, loading: false }); return; }
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    fetch(path, { signal: ctrl.signal })
      .then((r) => {
        if (r.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
        if (!r.ok) throw Object.assign(new Error("http"), { status: r.status });
        return r.json() as Promise<T>;
      })
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((e) => {
        if (e?.name === "AbortError") return;
        setState({
          data: null,
          loading: false,
          error: e?.status ? describeHttpError(e.status) : "No se pudo conectar con el servidor de Nebula. ¿Está encendido?",
        });
      });
    return () => ctrl.abort();
  }, [path, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; code: string; status?: number; retryAfter?: number; body?: Record<string, unknown> };

export async function sendJson<T = unknown>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const r = await fetch(path, {
      method,
      headers: body !== undefined ? { "content-type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = await r.json().catch(() => ({}));
    // En el acceso, un 401 es «contraseña incorrecta», no «sesión caducada».
    if (r.status === 401 && !path.startsWith("/api/auth/")) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    if (!r.ok) return { ok: false, code: json?.error ?? `http_${r.status}`, status: r.status, retryAfter: json?.retryAfter, body: json };
    return { ok: true, data: json as T };
  } catch {
    return { ok: false, code: "network" };
  }
}

/** Sube un archivo tal cual (application/octet-stream): sin tocar su codificación. */
export async function sendBytes<T = unknown>(path: string, body: ArrayBuffer): Promise<ApiResult<T>> {
  try {
    const r = await fetch(path, { method: "POST", headers: { "content-type": "application/octet-stream" }, body });
    const json = await r.json().catch(() => ({}));
    if (r.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    if (!r.ok) return { ok: false, code: json?.error ?? `http_${r.status}`, status: r.status, body: json };
    return { ok: true, data: json as T };
  } catch {
    return { ok: false, code: "network" };
  }
}

export const postJson = <T,>(path: string, body?: unknown) => sendJson<T>("POST", path, body);
