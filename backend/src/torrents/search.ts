import { createHash } from "node:crypto";
import { magnetHash } from "./torrent-meta.js";

export type SearchErrorCode = "not_found" | "auth" | "unreachable" | "bad_source" | "fetch_failed";
export class SearchError extends Error {
  constructor(public code: SearchErrorCode, message: string) { super(message); }
}

export interface SearchResult {
  /** Identificador opaco de este resultado; solo vale en esta ejecución y mientras siga en la caché. */
  id: string;
  title: string;
  sizeBytes: number;
  seeders: number;
  leechers: number;
  indexer: string;
  publishedAt: number | null;
  infoUrl: string | null;
  /** Hash del torrent si se conoce (para avisar de lo que ya está añadido). */
  hash: string | null;
}

/** Lo que hace falta para añadirlo al cliente: un magnet o el contenido del .torrent. */
export type Resolved = { magnet: string; file?: undefined } | { file: Buffer; magnet?: undefined };

interface Raw {
  guid?: string; title?: string; size?: number; seeders?: number; leechers?: number; indexer?: string;
  publishDate?: string; infoUrl?: string; downloadUrl?: string; magnetUrl?: string; infoHash?: string; protocol?: string;
}

export interface ProwlarrOptions {
  url: string;
  apiKey: string;
  fetch?: typeof fetch;
  searchTimeoutMs?: number;
  maxTorrentBytes?: number;
}

const CACHE_TTL_MS = 30 * 60_000;
const CACHE_MAX = 500;
const HEX40 = /^[0-9a-f]{40}$/i;

export class Prowlarr {
  private base: URL;
  private f: typeof fetch;
  private cache = new Map<string, { raw: Raw; at: number }>();

  constructor(private opts: ProwlarrOptions) {
    this.base = new URL(opts.url.endsWith("/") ? opts.url : opts.url + "/");
    this.f = opts.fetch ?? fetch;
  }

  private headers() { return { "X-Api-Key": this.opts.apiKey, Accept: "application/json" }; }

  private async get(pathAndQuery: string, timeoutMs: number): Promise<Response> {
    let res: Response;
    try {
      res = await this.f(new URL(pathAndQuery, this.base), { headers: this.headers(), signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      throw new SearchError("unreachable", (e as Error).message);
    }
    if (res.status === 401 || res.status === 403) throw new SearchError("auth", "API key rechazada");
    if (!res.ok) throw new SearchError("unreachable", `Prowlarr respondió ${res.status}`);
    return res;
  }

  async check(): Promise<{ ok: true; version: string } | { ok: false; error: "unreachable" | "auth"; message: string }> {
    try {
      const j = (await (await this.get("api/v1/system/status", 5000)).json()) as { version?: string };
      return { ok: true, version: j.version ?? "desconocida" };
    } catch (e) {
      if (e instanceof SearchError && (e.code === "auth" || e.code === "unreachable")) return { ok: false, error: e.code, message: e.message };
      return { ok: false, error: "unreachable", message: (e as Error).message };
    }
  }

  async search(query: string, kind?: "movies" | "series", limit = 60): Promise<SearchResult[]> {
    const qs = new URLSearchParams({ query, type: "search", limit: String(limit), indexerIds: "-2" });
    if (kind) qs.append("categories", kind === "movies" ? "2000" : "5000");
    const res = await this.get(`api/v1/search?${qs}`, this.opts.searchTimeoutMs ?? 30_000);
    const body = (await res.json().catch(() => null)) as unknown;
    if (!Array.isArray(body)) throw new SearchError("unreachable", "Respuesta inesperada de Prowlarr");

    const best = new Map<string, SearchResult>();
    const now = Date.now();
    for (const raw of body as Raw[]) {
      if (!raw || typeof raw.title !== "string") continue;
      if (raw.protocol && raw.protocol !== "torrent") continue;
      const hash = this.hashOf(raw);
      if (!hash && !raw.downloadUrl) continue;
      const id = createHash("sha1").update(String(raw.guid ?? raw.downloadUrl ?? raw.title)).digest("hex").slice(0, 16);
      const r: SearchResult = {
        id, title: raw.title.slice(0, 300), sizeBytes: num(raw.size), seeders: num(raw.seeders), leechers: num(raw.leechers),
        indexer: String(raw.indexer ?? "").slice(0, 80),
        publishedAt: raw.publishDate && !Number.isNaN(Date.parse(raw.publishDate)) ? Date.parse(raw.publishDate) : null,
        infoUrl: safeHttp(raw.infoUrl), hash,
      };
      const key = hash ?? id;
      const prev = best.get(key);
      if (!prev || r.seeders > prev.seeders) { best.set(key, r); this.remember(id, raw, now); }
    }
    return [...best.values()].sort((a, b) => b.seeders - a.seeders || b.sizeBytes - a.sizeBytes);
  }

  private hashOf(raw: Raw): string | null {
    if (raw.infoHash && HEX40.test(raw.infoHash)) return raw.infoHash.toLowerCase();
    if (raw.magnetUrl?.startsWith("magnet:")) { try { return magnetHash(raw.magnetUrl); } catch { /* sin hash */ } }
    return null;
  }

  private remember(id: string, raw: Raw, now: number) {
    this.cache.set(id, { raw, at: now });
    if (this.cache.size > CACHE_MAX) for (const [k, v] of this.cache) { if (now - v.at > CACHE_TTL_MS || this.cache.size > CACHE_MAX) this.cache.delete(k); else break; }
  }

  /** Obtiene un magnet o el .torrent de un resultado de la última búsqueda. Nunca acepta URLs del cliente. */
  async resolve(id: string): Promise<Resolved> {
    const hit = this.cache.get(id);
    if (!hit || Date.now() - hit.at > CACHE_TTL_MS) throw new SearchError("not_found", "El resultado ya no está; vuelve a buscar");
    const raw = hit.raw;
    if (raw.magnetUrl?.startsWith("magnet:")) { try { magnetHash(raw.magnetUrl); return { magnet: raw.magnetUrl }; } catch { /* sigue */ } }
    const hash = this.hashOf(raw);
    if (hash) return { magnet: `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(raw.title ?? hash).slice(0, 400)}` };
    return this.fetchTorrent(raw.downloadUrl);
  }

  /** El .torrent solo se descarga del propio Prowlarr (mismo origen): así un resultado no puede hacer que Nebula pida otras direcciones. */
  private async fetchTorrent(url: string | undefined): Promise<Resolved> {
    let u: URL;
    try { u = new URL(url ?? ""); } catch { throw new SearchError("bad_source", "Resultado sin enlace utilizable"); }
    if (u.origin !== this.base.origin) throw new SearchError("bad_source", "El enlace no es de Prowlarr");
    let res: Response;
    try {
      res = await this.f(u, { headers: { "X-Api-Key": this.opts.apiKey }, redirect: "manual", signal: AbortSignal.timeout(30_000) });
    } catch (e) { throw new SearchError("fetch_failed", (e as Error).message); }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location") ?? "";
      if (loc.startsWith("magnet:")) { try { magnetHash(loc); return { magnet: loc }; } catch { /* abajo */ } }
      throw new SearchError("fetch_failed", "Redirección no admitida");
    }
    if (!res.ok) throw new SearchError("fetch_failed", `Prowlarr respondió ${res.status}`);
    const max = this.opts.maxTorrentBytes ?? 1024 * 1024;
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > max) throw new SearchError("fetch_failed", "El .torrent es demasiado grande");
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > max) throw new SearchError("fetch_failed", "El .torrent es demasiado grande");
    return { file: buf };
  }
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
const safeHttp = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  try { const u = new URL(v); return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null; } catch { return null; }
};
