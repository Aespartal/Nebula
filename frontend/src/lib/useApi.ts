import { useCallback, useEffect, useState } from "react";

interface State<T> { data: T | null; error: string | null; loading: boolean }

export function describeHttpError(status: number): string {
  if (status === 404) return "No se encontró lo que buscabas. Puede que se haya movido o borrado.";
  return `El servidor respondió con un error (código ${status}).`;
}

export function useApi<T>(path: string) {
  const [state, setState] = useState<State<T>>({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    fetch(path, { signal: ctrl.signal })
      .then((r) => {
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

export async function postJson<T>(path: string, body?: unknown): Promise<{ ok: true; data: T } | { ok: false; code: string }> {
  try {
    const r = await fetch(path, {
      method: "POST",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, code: json?.error ?? `http_${r.status}` };
    return { ok: true, data: json as T };
  } catch {
    return { ok: false, code: "network" };
  }
}
