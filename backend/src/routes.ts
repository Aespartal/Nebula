import { stat } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type {
  Library, MediaFileInfo, MovieSummary, NextEpisode, ScanStats, SeriesDetail, SeriesSummary,
} from "@nebula/shared";
import type { Db } from "./db/index.js";
import { requireAdmin } from "./auth/plugin.js";
import { getStreams } from "./media-queries.js";
import { getProgress } from "./progress.js";
import { scanLibrary, type LibraryRow } from "./scanner.js";
import { sendRanged } from "./stream.js";

const toLibrary = (r: LibraryRow): Library => ({ id: r.id, name: r.name, type: r.type, rootPath: r.root_path });

export function registerRoutes(app: FastifyInstance, db: Db) {
  const libs = () => db.prepare("SELECT * FROM libraries ORDER BY id").all() as LibraryRow[];
  const scanOne = (lib: LibraryRow) => scanLibrary(db, lib);

  app.get("/api/health", async () => ({ ok: true }));

  // --- Bibliotecas ---
  // Las rutas del servidor y la gestión de bibliotecas son solo para administradores.
  app.get("/api/libraries", { preHandler: requireAdmin }, async () => libs().map(toLibrary));

  app.post<{ Body: { name: string; type: "movies" | "series"; rootPath: string } }>(
    "/api/libraries",
    {
      preHandler: requireAdmin,
      schema: {
        body: {
          type: "object",
          required: ["name", "type", "rootPath"],
          properties: {
            name: { type: "string", minLength: 1 },
            type: { enum: ["movies", "series"] },
            rootPath: { type: "string", minLength: 1 },
          },
        },
      },
    },
    async (req, reply) => {
      const root = path.resolve(req.body.rootPath);
      const s = await stat(root).catch(() => null);
      if (!s?.isDirectory()) return reply.code(400).send({ error: "root_path_not_a_directory" });
      try {
        const info = db
          .prepare("INSERT INTO libraries(name,type,root_path) VALUES(?,?,?)")
          .run(req.body.name, req.body.type, root);
        return reply.code(201).send(
          toLibrary(db.prepare("SELECT * FROM libraries WHERE id=?").get(info.lastInsertRowid) as LibraryRow),
        );
      } catch {
        return reply.code(409).send({ error: "library_already_exists" });
      }
    },
  );

  app.post<{ Params: { id: string } }>("/api/libraries/:id/scan", { preHandler: requireAdmin }, async (req, reply) => {
    const lib = db.prepare("SELECT * FROM libraries WHERE id=?").get(Number(req.params.id)) as LibraryRow | undefined;
    if (!lib) return reply.code(404).send({ error: "not_found" });
    return scanOne(lib);
  });

  app.post("/api/scan", { preHandler: requireAdmin }, async () => {
    const out: Record<number, ScanStats> = {};
    for (const lib of libs()) out[lib.id] = await scanOne(lib);
    return out;
  });

  // --- Catálogo ---
  app.get("/api/movies", async (req): Promise<MovieSummary[]> => {
    const rows = db.prepare(`
      SELECT x.id, x.title, x.year, x.fileId, COALESCE(wp.watched,0) AS watched,
             CASE WHEN wp.duration_s > 0 THEN MIN(1.0, wp.position_s / wp.duration_s) ELSE 0 END AS progress
      FROM (SELECT m.id, m.title, m.year, MIN(f.id) AS fileId
            FROM movies m JOIN media_files f ON f.movie_id = m.id GROUP BY m.id) x
      LEFT JOIN watch_progress wp ON wp.file_id = x.fileId AND wp.user_id = ?
      ORDER BY x.title COLLATE NOCASE`).all(req.user!.id) as any[];
    return rows.map((r) => ({ ...r, watched: !!r.watched }));
  });

  app.get("/api/series", async (req): Promise<SeriesSummary[]> =>
    db.prepare(`
      SELECT s.id, s.title,
             COUNT(DISTINCT se.id) AS seasons, COUNT(DISTINCT e.id) AS episodes,
             COUNT(DISTINCT CASE WHEN wp.watched = 1 THEN e.id END) AS watchedEpisodes
      FROM series s
      JOIN seasons se ON se.series_id = s.id
      JOIN episodes e ON e.season_id = se.id
      LEFT JOIN media_files f ON f.episode_id = e.id
      LEFT JOIN watch_progress wp ON wp.file_id = f.id AND wp.user_id = ?
      GROUP BY s.id ORDER BY s.title COLLATE NOCASE`).all(req.user!.id) as SeriesSummary[],
  );

  app.get<{ Params: { id: string } }>("/api/series/:id", async (req, reply): Promise<SeriesDetail | void> => {
    const s = db.prepare("SELECT id,title FROM series WHERE id=?").get(Number(req.params.id)) as
      | { id: number; title: string } | undefined;
    if (!s) return reply.code(404).send({ error: "not_found" });
    const rows = db.prepare(`
      SELECT x.*, COALESCE(wp.watched,0) AS watched,
             CASE WHEN wp.duration_s > 0 THEN MIN(1.0, wp.position_s / wp.duration_s) ELSE 0 END AS progress
      FROM (SELECT se.id AS seasonId, se.number AS seasonNumber, e.id AS episodeId, e.number, e.title, MIN(f.id) AS fileId
            FROM seasons se JOIN episodes e ON e.season_id = se.id JOIN media_files f ON f.episode_id = e.id
            WHERE se.series_id = ? GROUP BY e.id) x
      LEFT JOIN watch_progress wp ON wp.file_id = x.fileId AND wp.user_id = ?
      ORDER BY x.seasonNumber, x.number`).all(s.id, req.user!.id) as any[];
    const seasons = new Map<number, SeriesDetail["seasons"][number]>();
    for (const r of rows) {
      if (!seasons.has(r.seasonId)) seasons.set(r.seasonId, { id: r.seasonId, number: r.seasonNumber, episodes: [] });
      seasons.get(r.seasonId)!.episodes.push({ id: r.episodeId, number: r.number, title: r.title, fileId: r.fileId, watched: !!r.watched, progress: r.progress });
    }
    return { id: s.id, title: s.title, seasons: [...seasons.values()] };
  });

  // --- Archivos ---
  app.get<{ Params: { id: string } }>("/api/files/:id", async (req, reply): Promise<MediaFileInfo | void> => {
    const f = db.prepare(`
      SELECT f.id, f.rel_path AS relPath, f.size_bytes AS sizeBytes, f.container,
             f.duration_s AS durationS, f.bitrate,
             m.title AS movieTitle, m.year AS movieYear, m.overview AS movieOverview, e.overview AS epOverview,
             e.number AS epNumber, e.title AS epTitle,
             se.number AS seasonNumber, s.id AS seriesId, s.title AS seriesTitle
      FROM media_files f
      LEFT JOIN movies m ON m.id = f.movie_id
      LEFT JOIN episodes e ON e.id = f.episode_id
      LEFT JOIN seasons se ON se.id = e.season_id
      LEFT JOIN series s ON s.id = se.series_id
      WHERE f.id = ?`).get(Number(req.params.id)) as any;
    if (!f) return reply.code(404).send({ error: "not_found" });

    const isEpisode = f.epNumber !== null;
    let next: NextEpisode | null = null;
    if (isEpisode) {
      const n = db.prepare(`
        SELECT se2.number AS sn, e2.number AS en, e2.title, MIN(f2.id) AS fileId
        FROM episodes e2
        JOIN seasons se2 ON se2.id = e2.season_id
        JOIN media_files f2 ON f2.episode_id = e2.id
        WHERE se2.series_id = ? AND (se2.number > ? OR (se2.number = ? AND e2.number > ?))
        GROUP BY e2.id ORDER BY se2.number, e2.number LIMIT 1`)
        .get(f.seriesId, f.seasonNumber, f.seasonNumber, f.epNumber) as any;
      if (n) next = { fileId: n.fileId, label: `T${n.sn} E${n.en}${n.title ? ` · ${n.title}` : ""}` };
    }

    const streams = getStreams(db, f.id);

    return {
      id: f.id,
      kind: isEpisode ? "episode" : "movie",
      title: isEpisode ? (f.epTitle ?? `Episodio ${f.epNumber}`) : f.movieTitle,
      subtitle: isEpisode
        ? `${f.seriesTitle} · T${f.seasonNumber} E${f.epNumber}`
        : f.movieYear ? String(f.movieYear) : null,
      seriesId: f.seriesId ?? null,
      next,
      relPath: f.relPath, sizeBytes: f.sizeBytes, container: f.container,
      durationS: f.durationS, bitrate: f.bitrate, streams,
      overview: (isEpisode ? f.epOverview : f.movieOverview) ?? null,
      resume: getProgress(db, req.user!.id, f.id),
    };
  });

  // Solo por id de BD (nunca por ruta del cliente). El tamaño se lee del disco en cada petición.
  app.get<{ Params: { id: string } }>("/api/stream/:id", async (req, reply) => {
    const f = db.prepare("SELECT path FROM media_files WHERE id=?").get(Number(req.params.id)) as
      | { path: string } | undefined;
    if (!f) return reply.code(404).send({ error: "not_found" });
    const s = await stat(f.path).catch(() => null);
    if (!s) return reply.code(404).send({ error: "file_missing" });
    return sendRanged(req, reply, { absPath: f.path, sizeBytes: s.size, ext: path.extname(f.path).toLowerCase() });
  });
}
