/** Cliente mínimo de la API web v2 de qBittorrent (hito 0: conexión, lectura y categorías). */

export type QbErrorCode = "unreachable" | "auth" | "banned" | "http";
export class QbError extends Error {
  constructor(public code: QbErrorCode, message: string, public status?: number) { super(message); }
}

export interface QbOptions {
  /** Dirección de la interfaz web, p. ej. http://127.0.0.1:8080 */
  url: string;
  username: string;
  password: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export interface QbTorrent {
  hash: string; name: string; state: string; progress: number; size: number;
  dlspeed: number; eta: number; category: string; save_path: string;
}

export class QBittorrent {
  private sid: string | null = null;
  private readonly base: string;
  private readonly f: typeof fetch;

  constructor(private o: QbOptions) {
    this.base = o.url.replace(/\/+$/, "");
    this.f = o.fetch ?? fetch;
  }

  private async raw(method: "GET" | "POST", path: string, form?: Record<string, string>): Promise<Response> {
    const headers: Record<string, string> = {
      // qBittorrent rechaza peticiones cuyo Origin/Referer no coincida con su propio host (protección CSRF).
      Referer: this.base, Origin: new URL(this.base).origin,
    };
    if (this.sid) headers.Cookie = `SID=${this.sid}`;
    let body: string | undefined;
    if (form) { body = new URLSearchParams(form).toString(); headers["Content-Type"] = "application/x-www-form-urlencoded"; }
    try {
      return await this.f(`${this.base}/api/v2/${path}`, { method, headers, body, signal: AbortSignal.timeout(this.o.timeoutMs ?? 8000) });
    } catch (e) {
      throw new QbError("unreachable", `No se pudo conectar con ${this.base} (${(e as Error).message})`);
    }
  }

  async login(): Promise<void> {
    this.sid = null;
    const r = await this.raw("POST", "auth/login", { username: this.o.username, password: this.o.password });
    if (r.status === 403) throw new QbError("banned", "qBittorrent ha bloqueado temporalmente esta dirección por demasiados intentos fallidos", 403);
    const text = (await r.text()).trim();
    // Solo «Fails.» es un rechazo de credenciales; cualquier otra respuesta se enseña tal cual para poder diagnosticarla.
    if (r.status !== 200) throw new QbError("http", `qBittorrent respondió ${r.status} al iniciar sesión: «${text.slice(0, 120)}»`, r.status);
    if (text !== "Ok.") throw new QbError("auth", text === "Fails." ? "Usuario o contraseña incorrectos" : `Respuesta inesperada al iniciar sesión: «${text.slice(0, 120)}»`, r.status);
    const cookie = r.headers.getSetCookie().map((c) => /(?:^|;\s*)SID=([^;]+)/.exec(c)?.[1]).find(Boolean);
    if (!cookie) throw new QbError("auth", "qBittorrent no devolvió la cookie de sesión");
    this.sid = cookie;
  }

  /** Petición autenticada: si la sesión ha caducado (403), inicia sesión otra vez y reintenta una vez. */
  private async call(method: "GET" | "POST", path: string, form?: Record<string, string>): Promise<Response> {
    if (!this.sid) await this.login();
    let r = await this.raw(method, path, form);
    if (r.status === 403) { await this.login(); r = await this.raw(method, path, form); }
    if (!r.ok) throw new QbError("http", `qBittorrent respondió ${r.status} en ${path}`, r.status);
    return r;
  }

  async version(): Promise<string> { return (await (await this.call("GET", "app/version")).text()).trim(); }
  async webApiVersion(): Promise<string> { return (await (await this.call("GET", "app/webapiVersion")).text()).trim(); }
  async preferences(): Promise<Record<string, unknown>> { return (await this.call("GET", "app/preferences")).json() as Promise<Record<string, unknown>>; }
  async categories(): Promise<Record<string, { name: string; savePath: string }>> { return (await this.call("GET", "torrents/categories")).json() as Promise<Record<string, { name: string; savePath: string }>>; }
  async list(): Promise<QbTorrent[]> { return (await this.call("GET", "torrents/info")).json() as Promise<QbTorrent[]>; }
  async createCategory(name: string, savePath: string): Promise<void> { await this.call("POST", "torrents/createCategory", { category: name, savePath }); }
  async removeCategories(names: string[]): Promise<void> { await this.call("POST", "torrents/removeCategories", { categories: names.join("\n") }); }
}
