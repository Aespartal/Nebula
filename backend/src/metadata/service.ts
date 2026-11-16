import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MetadataStatus } from "@nebula/shared";
import type { Db } from "../db/index.js";
import { Tmdb, TmdbError } from "./tmdb.js";

const DAY = 24 * 3600_000;
const RETRY_MISSES_AFTER = 7 * DAY; // lo que no se encontró se vuelve a intentar cada semana (por si TMDB lo añade o se renombra)
const EPISODES_RECHECK_AFTER = DAY;

export class MetadataService {
  private running = false;
  private again = false;
  private lastError: MetadataStatus["lastError"] = null;
  private readonly downloads = new Map<string, Promise<string | null>>();

  constructor(private readonly db: Db, private readonly tmdb: Tmdb | null, private readonly postersDir: string, private readonly log: (m: string) => void = () => {}) {}

  get enabled() { return !!this.tmdb; }

  status(): MetadataStatus {
    const count = (table: "movies" | "series") => {
      const r = this.db.prepare(`
        SELECT COUNT(*) AS total, COUNT(poster_path) AS withPoster,
               SUM(CASE WHEN meta_checked_at IS NULL OR (tmdb_id IS NULL AND meta_checked_at < ?) THEN 1 ELSE 0 END) AS pending
        FROM ${table}`).get(Date.now() - RETRY_MISSES_AFTER) as { total: number; withPoster: number; pending: number | null };
      return { total: r.total, withPoster: r.withPoster, pending: r.pending ?? 0 };
    };
    return { enabled: this.enabled, running: this.running, movies: count("movies"), series: count("series"), lastError: this.lastError };
  }

  /** Lanza la búsqueda en segundo plano (tras un escaneo). Si ya hay una en marcha, repite al terminar para no perder lo nuevo. */
  kick(force = false) {
    if (!this.tmdb) return;
    if (this.running) { this.again = true; return; }
    void this.run(force);
  }

  private async run(force: boolean) {
    this.running = true;
    this.lastError = null;
    try {
      await this.refresh(force);
    } catch (e) {
      this.lastError = e instanceof TmdbError && e.code === "invalid_key" ? "invalid_key" : "network";
      this.log(`metadatos: ${this.lastError}`);
    } finally {
      this.running = false;
      if (this.again && !this.lastError) { this.again = false; void this.run(false); }
      this.again = false;
    }
  }

  async refresh(force: boolean): Promise<void> {
    const tmdb = this.tmdb!;
    const now = Date.now();
    const stale = now - RETRY_MISSES_AFTER;

    const movies = this.db.prepare(`SELECT id, title, year FROM movies WHERE ? OR meta_checked_at IS NULL OR (tmdb_id IS NULL AND meta_checked_at < ?)`)
      .all(force ? 1 : 0, stale) as { id: number; title: string; year: number | null }[];
    const setMovie = this.db.prepare("UPDATE movies SET tmdb_id=?, overview=?, poster_path=?, meta_checked_at=? WHERE id=?");
    for (const m of movies) {
      const hit = await tmdb.findMovie(m.title, m.year); // un fallo de red o de clave corta todo el proceso: se reintenta en el próximo escaneo
      if (hit) setMovie.run(hit.id, hit.overview, hit.posterPath, Date.now(), m.id);
      else this.db.prepare("UPDATE movies SET meta_checked_at=? WHERE id=?").run(Date.now(), m.id);
    }

    const series = this.db.prepare(`SELECT id, title FROM series WHERE ? OR meta_checked_at IS NULL OR (tmdb_id IS NULL AND meta_checked_at < ?)`)
      .all(force ? 1 : 0, stale) as { id: number; title: string }[];
    const matchedNow = new Set<number>();
    for (const s of series) {
      const hit = await tmdb.findTv(s.title);
      if (hit) {
        this.db.prepare("UPDATE series SET tmdb_id=?, overview=?, poster_path=?, meta_checked_at=? WHERE id=?").run(hit.id, hit.overview, hit.posterPath, Date.now(), s.id);
        matchedNow.add(s.id);
      } else {
        this.db.prepare("UPDATE series SET meta_checked_at=? WHERE id=?").run(Date.now(), s.id);
      }
    }

    // Episodios: series ya reconocidas con episodios sin sinopsis (los nuevos se rellenan, como mucho una vez al día).
    const needAll = this.db.prepare(`
      SELECT s.id, s.tmdb_id AS tmdbId, s.meta_checked_at AS checkedAt FROM series s
      WHERE s.tmdb_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM seasons se JOIN episodes e ON e.season_id = se.id WHERE se.series_id = s.id AND e.overview IS NULL)`)
      .all() as { id: number; tmdbId: number; checkedAt: number | null }[];
    const need = needAll.filter((s) => matchedNow.has(s.id) || !s.checkedAt || s.checkedAt < now - EPISODES_RECHECK_AFTER);
    const setEp = this.db.prepare("UPDATE episodes SET overview=COALESCE(overview, ?), title=COALESCE(title, ?) WHERE season_id=? AND number=?");
    for (const s of need) {
      const seasons = this.db.prepare("SELECT id, number FROM seasons WHERE series_id=?").all(s.id) as { id: number; number: number }[];
      for (const se of seasons) {
        for (const ep of await tmdb.seasonEpisodes(s.tmdbId, se.number)) setEp.run(ep.overview, ep.name, se.id, ep.number);
      }
      this.db.prepare("UPDATE series SET meta_checked_at=? WHERE id=?").run(Date.now(), s.id);
    }
    this.log(`metadatos: ${movies.length} películas y ${series.length} series consultadas, ${need.length} series con episodios`);
  }

  /** Ruta del archivo de carátula (descargándola la primera vez). null si no hay. */
  async posterFile(kind: "movie" | "series", id: number): Promise<string | null> {
    const row = this.db.prepare(`SELECT tmdb_id AS tmdbId, poster_path AS posterPath FROM ${kind === "movie" ? "movies" : "series"} WHERE id=?`)
      .get(id) as { tmdbId: number | null; posterPath: string | null } | undefined;
    if (!row?.posterPath || !row.tmdbId) return null;
    // El nombre lleva el id de TMDB: si un id local se reutiliza para otra película, no se sirve la carátula equivocada.
    const file = path.join(this.postersDir, `${kind === "movie" ? "m" : "t"}-${row.tmdbId}-${path.basename(row.posterPath, path.extname(row.posterPath)).replace(/[^\w-]/g, "")}.jpg`);
    try { await readFile(file); return file; } catch { /* no estaba descargada */ }
    if (!this.tmdb) return null;
    let job = this.downloads.get(file);
    if (!job) {
      job = (async () => {
        try {
          const buf = await this.tmdb!.downloadPoster(row.posterPath!);
          await mkdir(this.postersDir, { recursive: true });
          const tmp = `${file}.${process.pid}.tmp`;
          await writeFile(tmp, buf);
          await rename(tmp, file);
          return file;
        } catch { return null; }
      })().finally(() => this.downloads.delete(file));
      this.downloads.set(file, job);
    }
    return job;
  }
}
