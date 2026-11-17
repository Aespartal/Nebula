import type { RecentItem } from "@nebula/shared";
import type { Db } from "./db/index.js";

/** Los episodios que entran juntos (misma descarga, mismo escaneo) cuentan como una sola novedad de la serie. */
export const BATCH_MS = 24 * 3600 * 1000;

const added = "COALESCE(f.added_at, f.mtime_ms)";

/** Lo último que ha entrado en el catálogo, de más nuevo a más antiguo: películas y series (con sus episodios nuevos agrupados). */
export function recentlyAdded(db: Db, limit = 12): RecentItem[] {
  const movies = db.prepare(`
    SELECT m.id, m.title, m.year, m.poster_path IS NOT NULL AS hasPoster, MIN(f.id) AS fileId, MAX(${added}) AS addedAt
    FROM movies m JOIN media_files f ON f.movie_id = m.id
    GROUP BY m.id ORDER BY addedAt DESC, fileId DESC LIMIT ?`).all(limit) as any[];

  const series = db.prepare(`
    SELECT s.id, s.title, s.year, s.poster_path IS NOT NULL AS hasPoster, x.addedAt,
           (SELECT COUNT(DISTINCT f2.episode_id)
              FROM media_files f2
              JOIN episodes e2 ON e2.id = f2.episode_id
              JOIN seasons se2 ON se2.id = e2.season_id
              WHERE se2.series_id = s.id AND COALESCE(f2.added_at, f2.mtime_ms) > x.addedAt - ?) AS newEpisodes
    FROM (SELECT se.series_id AS seriesId, MAX(${added}) AS addedAt
          FROM media_files f JOIN episodes e ON e.id = f.episode_id JOIN seasons se ON se.id = e.season_id
          GROUP BY se.series_id ORDER BY addedAt DESC LIMIT ?) x
    JOIN series s ON s.id = x.seriesId`).all(BATCH_MS, limit) as any[];

  const items: RecentItem[] = [
    ...movies.map((r): RecentItem => ({
      kind: "movie", id: r.id, title: r.title, year: r.year, fileId: r.fileId, newEpisodes: 0, addedAt: r.addedAt,
      poster: r.hasPoster ? `/api/posters/movie/${r.id}` : null,
    })),
    ...series.map((r): RecentItem => ({
      kind: "series", id: r.id, title: r.title, year: r.year, fileId: null, newEpisodes: r.newEpisodes, addedAt: r.addedAt,
      poster: r.hasPoster ? `/api/posters/series/${r.id}` : null,
    })),
  ];
  // Mismo instante: primero lo de id mayor (lo último en entrar), y las películas antes que las series para que el orden sea estable.
  items.sort((a, b) => b.addedAt - a.addedAt || (a.kind === b.kind ? b.id - a.id : a.kind === "movie" ? -1 : 1));
  return items.slice(0, limit);
}
