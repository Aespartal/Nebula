/** Cliente de la API web v2 de qBittorrent: conexión, lectura, categorías y control de descargas. */
import { TorrentError, type AddOptions, type CheckError, type TorrentClient, type TorrentInfo, type TorrentState } from "./client.js";
import { magnetHash, torrentHash } from "./torrent-meta.js";

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
  upspeed?: number; downloaded?: number; added_on?: number; completion_on?: number;
}

/** Estados internos de qBittorrent → estados de Nebula. */
export function mapState(s: string): TorrentState {
  switch (s) {
    case "error": case "missingFiles": return "error";
    case "moving": return "moving";
    case "allocating": case "checkingDL": case "checkingUP": case "checkingResumeData": return "checking";
    case "pausedDL": case "stoppedDL": case "pausedUP": case "stoppedUP": return "paused";
    case "queuedDL": case "queuedUP": return "queued";
    case "stalledDL": return "stalled";
    case "downloading": case "forcedDL": case "metaDL": case "forcedMetaDL": return "downloading";
    case "uploading": case "forcedUP": case "stalledUP": return "seeding";
    default: return "unknown";
  }
}

const NO_ETA = 8_640_000; // qBittorrent usa 100 días como «infinito»

export function toTorrentInfo(t: QbTorrent): TorrentInfo {
  const progress = Math.max(0, Math.min(1, Number(t.progress) || 0));
  const completedAt = t.completion_on && t.completion_on > 0 ? t.completion_on * 1000 : null;
  return {
    hash: String(t.hash).toLowerCase(),
    name: t.name,
    state: mapState(t.state),
    progress,
    done: progress >= 1,
    sizeBytes: t.size ?? 0,
    downloadedBytes: t.downloaded ?? Math.round((t.size ?? 0) * progress),
    speedDown: t.dlspeed ?? 0,
    speedUp: t.upspeed ?? 0,
    etaS: t.eta === undefined || t.eta < 0 || t.eta >= NO_ETA ? null : t.eta,
    category: t.category ?? "",
    savePath: t.save_path ?? "",
    addedAt: t.added_on && t.added_on > 0 ? t.added_on * 1000 : null,
    completedAt,
  };
}

export class QBittorrent implements TorrentClient {
  /** Cookie de sesión tal cual la manda qBittorrent: «SID=…» (4.x) o «QBT_SID_<puerto>=…» (5.x). */
  private sid: string | null = null;
  /** true si qBittorrent no pide sesión (p. ej. «omitir autenticación para clientes en localhost»). */
  private open = false;
  private readonly base: string;
  private readonly f: typeof fetch;

  constructor(private o: QbOptions) {
    this.base = o.url.replace(/\/+$/, "");
    this.f = o.fetch ?? fetch;
  }

  private async raw(method: "GET" | "POST", path: string, form?: Record<string, string> | FormData): Promise<Response> {
    const headers: Record<string, string> = {
      // qBittorrent rechaza peticiones cuyo Origin/Referer no coincida con su propio host (protección CSRF).
      Referer: this.base, Origin: new URL(this.base).origin,
    };
    if (this.sid) headers.Cookie = this.sid;
    let body: string | FormData | undefined;
    if (form instanceof FormData) body = form; // el Content-Type con su «boundary» lo pone fetch
    else if (form) { body = new URLSearchParams(form).toString(); headers["Content-Type"] = "application/x-www-form-urlencoded"; }
    try {
      return await this.f(`${this.base}/api/v2/${path}`, { method, headers, body, signal: AbortSignal.timeout(this.o.timeoutMs ?? 8000) });
    } catch (e) {
      throw new QbError("unreachable", `No se pudo conectar con ${this.base} (${(e as Error).message})`);
    }
  }

  async login(): Promise<void> {
    this.sid = null;
    this.open = false;
    const r = await this.raw("POST", "auth/login", { username: this.o.username, password: this.o.password });
    if (r.status === 403) throw new QbError("banned", "qBittorrent ha bloqueado temporalmente esta dirección por demasiados intentos fallidos", 403);
    const text = (await r.text()).trim();
    // qBittorrent 5.x: login correcto = 204 (o 200 «Ok.» en la 4.x) con la cookie SID; credenciales malas = 401 (o 200 «Fails.»).
    if (r.status === 401) throw new QbError("auth", "Usuario o contraseña incorrectos", 401);
    const cookie = r.headers.getSetCookie().map((c) => /^\s*((?:QBT_)?SID[A-Za-z0-9_]*=[^;]+)/.exec(c)?.[1]).find(Boolean);
    const ok = r.status === 204 || (r.status === 200 && text === "Ok.");
    if (ok && cookie) { this.sid = cookie; return; }
    // Autenticación omitida para localhost: no hay cookie, pero la API responde sin sesión.
    if (ok) {
      const probe = await this.raw("GET", "app/version");
      if (probe.ok) { this.open = true; return; }
      throw new QbError("auth", "qBittorrent no devolvió la cookie de sesión y la API no responde sin ella");
    }
    if (r.status === 200) throw new QbError("auth", text === "Fails." ? "Usuario o contraseña incorrectos" : `Respuesta inesperada al iniciar sesión: «${text.slice(0, 120)}»`, r.status);
    throw new QbError("http", `qBittorrent respondió ${r.status} al iniciar sesión: «${text.slice(0, 120)}»`, r.status);
  }

  /** Petición autenticada: si la sesión ha caducado (403), inicia sesión otra vez y reintenta una vez. */
  private async call(method: "GET" | "POST", path: string, form?: Record<string, string> | FormData): Promise<Response> {
    if (!this.sid && !this.open) await this.login();
    let r = await this.raw(method, path, form);
    if ((r.status === 403 || r.status === 401) && !this.open) { await this.login(); r = await this.raw(method, path, form); }
    if (!r.ok) throw new QbError("http", `qBittorrent respondió ${r.status} en ${path}`, r.status);
    return r;
  }

  async version(): Promise<string> { return (await (await this.call("GET", "app/version")).text()).trim(); }
  async webApiVersion(): Promise<string> { return (await (await this.call("GET", "app/webapiVersion")).text()).trim(); }
  async preferences(): Promise<Record<string, unknown>> { return (await this.call("GET", "app/preferences")).json() as Promise<Record<string, unknown>>; }
  async categories(): Promise<Record<string, { name: string; savePath: string }>> { return (await this.call("GET", "torrents/categories")).json() as Promise<Record<string, { name: string; savePath: string }>>; }
  async createCategory(name: string, savePath: string): Promise<void> { await this.call("POST", "torrents/createCategory", { category: name, savePath }); }
  async removeCategories(names: string[]): Promise<void> { await this.call("POST", "torrents/removeCategories", { categories: names.join("\n") }); }

  // --- Contrato TorrentClient ---

  async check(): Promise<{ ok: boolean; version?: string; error?: CheckError; message?: string }> {
    try {
      const [version, api] = await Promise.all([this.version(), this.webApiVersion()]);
      return { ok: true, version: `${version} (API ${api})` };
    } catch (e) {
      if (e instanceof QbError) {
        const error: CheckError = e.code === "unreachable" ? "unreachable" : e.code === "http" ? "unsupported" : "auth";
        return { ok: false, error, message: e.message };
      }
      throw e;
    }
  }

  /** qBittorrent 5.0 (API 2.11) renombró pausar/reanudar a parar/iniciar. */
  private apiVersionCache?: [number, number];
  private async apiAtLeast(major: number, minor: number): Promise<boolean> {
    if (!this.apiVersionCache) {
      const m = /^(\d+)\.(\d+)/.exec(await this.webApiVersion());
      this.apiVersionCache = m ? [Number(m[1]), Number(m[2])] : [2, 0];
    }
    const [a, b] = this.apiVersionCache;
    return a > major || (a === major && b >= minor);
  }

  async list(): Promise<TorrentInfo[]> {
    return (await this.listRaw()).map(toTorrentInfo);
  }
  private async listRaw(): Promise<QbTorrent[]> { return (await this.call("GET", "torrents/info")).json() as Promise<QbTorrent[]>; }

  private addForm(opts: AddOptions | undefined, fd: FormData) {
    if (opts?.category) fd.set("category", opts.category);
    if (opts?.paused) { fd.set("paused", "true"); fd.set("stopped", "true"); } // 4.x y 5.x lo llaman distinto
    return fd;
  }

  private async add(fd: FormData): Promise<void> {
    const r = await this.call("POST", "torrents/add", fd);
    const text = (await r.text()).trim();
    if (text === "Fails.") throw new TorrentError("rejected", "qBittorrent no aceptó el torrent (¿ya estaba añadido o es inválido?)");
  }

  async addMagnet(uri: string, opts?: AddOptions): Promise<string> {
    const hash = magnetHash(uri);
    const fd = this.addForm(opts, new FormData());
    fd.set("urls", uri.trim());
    await this.add(fd);
    return hash;
  }

  async addFile(data: Buffer, opts?: AddOptions): Promise<string> {
    const hash = torrentHash(data);
    const fd = this.addForm(opts, new FormData());
    fd.set("torrents", new Blob([new Uint8Array(data)], { type: "application/x-bittorrent" }), "nebula.torrent");
    await this.add(fd);
    return hash;
  }

  private assertHash(hash: string): string {
    if (!/^[0-9a-f]{40}$/i.test(hash)) throw new TorrentError("rejected", "Hash de torrent no válido");
    return hash.toLowerCase();
  }

  async pause(hash: string): Promise<void> {
    await this.call("POST", (await this.apiAtLeast(2, 11)) ? "torrents/stop" : "torrents/pause", { hashes: this.assertHash(hash) });
  }
  async resume(hash: string): Promise<void> {
    await this.call("POST", (await this.apiAtLeast(2, 11)) ? "torrents/start" : "torrents/resume", { hashes: this.assertHash(hash) });
  }
  async ensureCategory(name: string, savePath: string): Promise<void> {
    const have = (await this.categories())[name];
    if (!have) { await this.createCategory(name, savePath); return; }
    // qBittorrent guarda las rutas con «/»; se comparan sin distinguir el separador ni el final.
    const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
    if (norm(have.savePath ?? "") !== norm(savePath)) await this.call("POST", "torrents/editCategory", { category: name, savePath });
  }

  async freeSpaceBytes(): Promise<number | null> {
    const data = (await (await this.call("GET", "sync/maindata?rid=0")).json()) as { server_state?: { free_space_on_disk?: number } };
    const n = data.server_state?.free_space_on_disk;
    return typeof n === "number" && n >= 0 ? n : null;
  }

  async remove(hash: string, deleteFiles: boolean): Promise<void> {
    await this.call("POST", "torrents/delete", { hashes: this.assertHash(hash), deleteFiles: deleteFiles ? "true" : "false" });
  }
}
