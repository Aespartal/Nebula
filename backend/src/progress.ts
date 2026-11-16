import type { ContinueItem, WatchProgress } from "@nebula/shared";
import type { Db } from "./db/index.js";

/** A partir de este porcentaje (y sin llegar a los créditos finales) se da por vista. */
export const WATCHED_RATIO = 0.9;
/** Menos de esto no cuenta como «empezado»: evita que un clic accidental llene «Seguir viendo». */
export const MIN_RESUME_S = 10;

export function getProgress(db: Db, userId: number, fileId: number): WatchProgress {
  const r = db.prepare("SELECT position_s AS positionS, duration_s AS durationS, watched FROM watch_progress WHERE user_id=? AND file_id=?")
    .get(userId, fileId) as { positionS: number; durationS: number | null; watched: number } | undefined;
  return r ? { positionS: r.positionS, durationS: r.durationS, watched: !!r.watched } : { positionS: 0, durationS: null, watched: false };
}

/** Guarda la posición. Devuelve null si el archivo no existe. */
export function saveProgress(db: Db, userId: number, fileId: number, positionS: number, durationS?: number | null, now = Date.now()): WatchProgress | null {
  const f = db.prepare("SELECT duration_s AS durationS FROM media_files WHERE id=?").get(fileId) as { durationS: number | null } | undefined;
  if (!f) return null;
  const dur = durationS && durationS > 0 ? durationS : f.durationS;
  const pos = Math.max(0, dur ? Math.min(positionS, dur) : positionS);
  const finished = !!dur && pos / dur >= WATCHED_RATIO;
  // Una vez vista, la marca se conserva aunque se vuelva a ver desde el principio; solo se quita a mano.
  db.prepare(`
    INSERT INTO watch_progress(user_id,file_id,position_s,duration_s,watched,updated_at) VALUES(?,?,?,?,?,?)
    ON CONFLICT(user_id,file_id) DO UPDATE SET
      position_s=excluded.position_s, duration_s=excluded.duration_s,
      watched=MAX(watch_progress.watched, excluded.watched), updated_at=excluded.updated_at`)
    .run(userId, fileId, pos, dur ?? null, finished ? 1 : 0, now);
  return getProgress(db, userId, fileId);
}

export function setWatched(db: Db, userId: number, fileId: number, watched: boolean, now = Date.now()): WatchProgress | null {
  const f = db.prepare("SELECT duration_s AS durationS FROM media_files WHERE id=?").get(fileId) as { durationS: number | null } | undefined;
  if (!f) return null;
  db.prepare(`
    INSERT INTO watch_progress(user_id,file_id,position_s,duration_s,watched,updated_at) VALUES(?,?,0,?,?,?)
    ON CONFLICT(user_id,file_id) DO UPDATE SET position_s=0, watched=excluded.watched, updated_at=excluded.updated_at`)
    .run(userId, fileId, f.durationS, watched ? 1 : 0, now);
  return getProgress(db, userId, fileId);
}

/** Marca (o desmarca) todos los episodios de una serie. Devuelve cuántos archivos se tocaron. */
export function setSeriesWatched(db: Db, userId: number, seriesId: number, watched: boolean, now = Date.now()): number {
  const files = db.prepare(`
    SELECT MIN(f.id) AS id FROM media_files f JOIN episodes e ON e.id=f.episode_id JOIN seasons se ON se.id=e.season_id
    WHERE se.series_id=? GROUP BY e.id`).all(seriesId) as { id: number }[];
  db.transaction(() => { for (const f of files) setWatched(db, userId, f.id, watched, now); })();
  return files.length;
}

/** Marca (o desmarca) todos los episodios de una temporada. Devuelve cuántos archivos se tocaron. */
export function setSeasonWatched(db: Db, userId: number, seasonId: number, watched: boolean, now = Date.now()): number {
  const files = db.prepare("SELECT MIN(f.id) AS id FROM media_files f JOIN episodes e ON e.id=f.episode_id WHERE e.season_id=? GROUP BY e.id").all(seasonId) as { id: number }[];
  db.transaction(() => { for (const f of files) setWatched(db, userId, f.id, watched, now); })();
  return files.length;
}

const LIMIT = 12;

/** «Seguir viendo»: lo que está a medias y, de las series en curso, el siguiente episodio. */
export function continueWatching(db: Db, userId: number): ContinueItem[] {
  const out: (ContinueItem & { ts: number })[] = [];

  const resume = db.prepare(`
    SELECT f.id AS fileId, wp.position_s AS positionS, wp.duration_s AS durationS, wp.updated_at AS ts,
           m.title AS movieTitle, m.year AS movieYear,
           m.id AS movieId, m.poster_path AS moviePoster, s.id AS seriesId, s.poster_path AS seriesPoster,
           e.number AS en, e.title AS et, se.number AS sn, s.title AS seriesTitle
    FROM watch_progress wp
    JOIN media_files f ON f.id = wp.file_id
    LEFT JOIN movies m ON m.id = f.movie_id
    LEFT JOIN episodes e ON e.id = f.episode_id
    LEFT JOIN seasons se ON se.id = e.season_id
    LEFT JOIN series s ON s.id = se.series_id
    WHERE wp.user_id = ? AND wp.watched = 0 AND wp.position_s >= ?
    ORDER BY wp.updated_at DESC LIMIT ?`).all(userId, MIN_RESUME_S, LIMIT) as any[];
  const seen = new Set<number>();
  for (const r of resume) {
    seen.add(r.fileId);
    const ep = r.en !== null;
    out.push({
      fileId: r.fileId, kind: ep ? "episode" : "movie", reason: "resume", ts: r.ts,
      title: ep ? (r.et ?? `Episodio ${r.en}`) : r.movieTitle,
      subtitle: ep ? `${r.seriesTitle} · T${r.sn} E${r.en}` : r.movieYear ? String(r.movieYear) : null,
      positionS: r.positionS, durationS: r.durationS,
      poster: ep ? (r.seriesPoster ? `/api/posters/series/${r.seriesId}` : null) : (r.moviePoster ? `/api/posters/movie/${r.movieId}` : null),
    });
  }

  const last = db.prepare(`
    SELECT s.id AS seriesId, s.title AS seriesTitle, s.poster_path AS seriesPoster, se.number AS sn, e.number AS en, MAX(wp.updated_at) AS ts
    FROM watch_progress wp
    JOIN media_files f ON f.id = wp.file_id
    JOIN episodes e ON e.id = f.episode_id
    JOIN seasons se ON se.id = e.season_id
    JOIN series s ON s.id = se.series_id
    WHERE wp.user_id = ? AND wp.watched = 1
    GROUP BY s.id`).all(userId) as any[];
  const nextStmt = db.prepare(`
    SELECT se.number AS sn, e.number AS en, e.title AS et, MIN(f.id) AS fileId
    FROM episodes e JOIN seasons se ON se.id = e.season_id JOIN media_files f ON f.episode_id = e.id
    LEFT JOIN watch_progress wp ON wp.file_id = f.id AND wp.user_id = ?
    WHERE se.series_id = ? AND (se.number > ? OR (se.number = ? AND e.number > ?)) AND COALESCE(wp.watched, 0) = 0
    GROUP BY e.id ORDER BY se.number, e.number LIMIT 1`);
  for (const l of last) {
    const n = nextStmt.get(userId, l.seriesId, l.sn, l.sn, l.en) as any;
    if (!n || seen.has(n.fileId)) continue;
    out.push({
      fileId: n.fileId, kind: "episode", reason: "next", ts: l.ts,
      title: n.et ?? `Episodio ${n.en}`, subtitle: `${l.seriesTitle} · T${n.sn} E${n.en}`, positionS: 0, durationS: null,
      poster: l.seriesPoster ? `/api/posters/series/${l.seriesId}` : null,
    });
  }

  return out.sort((a, b) => b.ts - a.ts).slice(0, LIMIT).map(({ ts: _ts, ...i }) => i);
}
