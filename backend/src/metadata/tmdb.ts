// Cliente mínimo de TMDB (API v3). Solo envía el título (y el año) de lo que buscas; nada de tus archivos ni de tus cuentas.
export class TmdbError extends Error {
  constructor(readonly code: "invalid_key" | "network" | "rate_limited" | "http", readonly status?: number) { super(code); }
}

export interface TmdbOptions {
  apiKey: string;
  language: string;
  baseUrl?: string;
  imageBase?: string;
  fetch?: typeof fetch;
}

export interface MovieHit { id: number; title: string; originalTitle: string; year: number | null; overview: string | null; posterPath: string | null }
export interface TvHit { id: number; name: string; originalName: string; year: number | null; overview: string | null; posterPath: string | null }
/** Un resultado de TMDB tal cual, para que una persona elija (a diferencia de findMovie/findTv, que deciden solos). */
export interface Candidate { tmdbId: number; title: string; originalTitle: string; year: number | null; overview: string | null; posterPath: string | null }

export interface EpisodeInfo { number: number; name: string | null; overview: string | null }

/** Minúsculas, sin acentos ni signos: «Amélie» y «amelie!» comparan igual. */
export const normTitle = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

const yearOf = (d: unknown) => (typeof d === "string" && /^\d{4}/.test(d) ? Number(d.slice(0, 4)) : null);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * Elige el resultado que corresponde de verdad; si no hay uno claro, ninguno (una carátula equivocada es peor que ninguna).
 * Se acepta: mismo título (o título original) y, si se sabe el año, a ±1; o, sin coincidencia de título, el primer resultado
 * solo cuando el año coincide exactamente.
 */
export function pickMatch<T extends { title: string; originalTitle: string; year: number | null }>(hits: T[], title: string, year: number | null): T | null {
  const want = normTitle(title);
  const near = (h: T) => year === null || h.year === null || Math.abs(h.year - year) <= 1;
  const sameTitle = hits.filter((h) => normTitle(h.title) === want || normTitle(h.originalTitle) === want);
  const byTitle = sameTitle.find((h) => near(h)) ?? (year === null ? sameTitle[0] : undefined);
  if (byTitle) return byTitle;
  const first = hits[0];
  return first && year !== null && first.year === year ? first : null;
}

export class Tmdb {
  private readonly base: string;
  private readonly f: typeof fetch;
  private readonly bearer: boolean;
  constructor(private readonly o: TmdbOptions) {
    this.base = (o.baseUrl ?? "https://api.themoviedb.org/3").replace(/\/$/, "");
    this.f = o.fetch ?? fetch;
    this.bearer = o.apiKey.startsWith("eyJ"); // el token v4 es un JWT; la clave v3 son 32 hex
  }

  get language() { return this.o.language; }
  imageUrl(posterPath: string, size = "w342") { return `${(this.o.imageBase ?? "https://image.tmdb.org/t/p").replace(/\/$/, "")}/${size}${posterPath}`; }

  private async get(path: string, params: Record<string, string | number | undefined>, attempt = 0): Promise<any> {
    const url = new URL(this.base + path);
    for (const [k, v] of Object.entries({ language: this.o.language, ...params })) if (v !== undefined) url.searchParams.set(k, String(v));
    if (!this.bearer) url.searchParams.set("api_key", this.o.apiKey);
    let r: Response;
    try {
      r = await this.f(url, { headers: { accept: "application/json", ...(this.bearer ? { authorization: `Bearer ${this.o.apiKey}` } : {}) }, signal: AbortSignal.timeout(15_000) });
    } catch {
      throw new TmdbError("network");
    }
    if (r.status === 401) throw new TmdbError("invalid_key", 401);
    if (r.status === 429 && attempt < 2) {
      const wait = Math.min(10, Number(r.headers.get("retry-after")) || 2);
      await new Promise((res) => setTimeout(res, wait * 1000));
      return this.get(path, params, attempt + 1);
    }
    if (r.status === 404) return null;
    if (!r.ok) throw new TmdbError(r.status === 429 ? "rate_limited" : "http", r.status);
    return r.json();
  }

  async findMovie(title: string, year: number | null): Promise<MovieHit | null> {
    const search = async (y: number | null) => {
      const j = await this.get("/search/movie", { query: title, include_adult: "false", year: y ?? undefined });
      return ((j?.results ?? []) as any[]).map((r): MovieHit => ({
        id: r.id, title: String(r.title ?? ""), originalTitle: String(r.original_title ?? ""),
        year: yearOf(r.release_date), overview: str(r.overview), posterPath: str(r.poster_path),
      }));
    };
    // El filtro de año de TMDB es estricto: si no hay nada con él, se reintenta sin filtro y se comprueba el año a mano.
    return pickMatch(await search(year), title, year) ?? (year !== null ? pickMatch(await search(null), title, year) : null);
  }

  async findTv(name: string): Promise<TvHit | null> {
    const j = await this.get("/search/tv", { query: name, include_adult: "false" });
    const hits = ((j?.results ?? []) as any[]).map((r): TvHit & { title: string; originalTitle: string } => ({
      id: r.id, name: String(r.name ?? ""), originalName: String(r.original_name ?? ""), title: String(r.name ?? ""), originalTitle: String(r.original_name ?? ""),
      year: yearOf(r.first_air_date), overview: str(r.overview), posterPath: str(r.poster_path),
    }));
    const best = pickMatch(hits, name, null);
    return best ?? (hits.length === 1 ? hits[0] : null); // una sola coincidencia: se acepta aunque el título cambie (p. ej. traducido)
  }

  private movieCandidate = (r: any): Candidate => ({
    tmdbId: Number(r.id), title: String(r.title ?? ""), originalTitle: String(r.original_title ?? ""),
    year: yearOf(r.release_date), overview: str(r.overview), posterPath: str(r.poster_path),
  });
  private tvCandidate = (r: any): Candidate => ({
    tmdbId: Number(r.id), title: String(r.name ?? ""), originalTitle: String(r.original_name ?? ""),
    year: yearOf(r.first_air_date), overview: str(r.overview), posterPath: str(r.poster_path),
  });

  /** Hasta 10 resultados de búsqueda, en el orden de TMDB. */
  async searchMovies(query: string, year: number | null): Promise<Candidate[]> {
    const j = await this.get("/search/movie", { query, include_adult: "false", year: year ?? undefined });
    return ((j?.results ?? []) as any[]).slice(0, 10).map(this.movieCandidate);
  }
  async searchTv(query: string): Promise<Candidate[]> {
    const j = await this.get("/search/tv", { query, include_adult: "false" });
    return ((j?.results ?? []) as any[]).slice(0, 10).map(this.tvCandidate);
  }
  /** Una película o serie por su id de TMDB. null si no existe. */
  async movie(id: number): Promise<Candidate | null> { const j = await this.get(`/movie/${id}`, {}); return j ? this.movieCandidate(j) : null; }
  async tv(id: number): Promise<Candidate | null> { const j = await this.get(`/tv/${id}`, {}); return j ? this.tvCandidate(j) : null; }

  async seasonEpisodes(tvId: number, season: number): Promise<EpisodeInfo[]> {
    const j = await this.get(`/tv/${tvId}/season/${season}`, {});
    return ((j?.episodes ?? []) as any[]).map((e) => ({ number: Number(e.episode_number), name: str(e.name), overview: str(e.overview) }));
  }

  /** Descarga la imagen de una carátula. */
  async downloadPoster(posterPath: string, size = "w342"): Promise<Buffer> {
    let r: Response;
    try { r = await this.f(this.imageUrl(posterPath, size), { signal: AbortSignal.timeout(20_000) }); } catch { throw new TmdbError("network"); }
    if (!r.ok) throw new TmdbError("http", r.status);
    return Buffer.from(await r.arrayBuffer());
  }
}
