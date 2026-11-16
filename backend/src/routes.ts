import { stat } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type {
  Library, MediaFileInfo, MovieSummary, NextEpisode, ScanStats, SeriesDetail, SeriesSummary,
} from "@nebula/shared";
import type { Db } from "./db/index.js";
import { getStreams } from "./media-queries.js";
import { scanLibrary, type LibraryRow } from "./scanner.js";
import { sendRanged } from "./stream.js";

const toLibrary = (r: LibraryRow): Library => ({ id: r.id, name: r.name, type: r.type, rootPath: r.root_path });

export function registerRoutes(app: FastifyInstance, db: Db) {
  const libs = () => db.prepare("SELECT * FROM libraries ORDER BY id").all() as LibraryRow[];
  const scanOne = (lib: LibraryRow) => scanLibrary(db, lib);

  app.get("/api/health", async () => ({ ok: true }));

  // --- Bibliotecas ---
  app.get("/api/libraries", async () => libs().map(toLibrary));

  app.post<{ Body: { name: string; type: "movies" | "series"; rootPath: string } }>(
    "/api/libraries",
    {
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

  app.post<{ Params: { id: string } }>("/api/libraries/:id/scan", async (req, reply) => {
    const lib = db.prepare("SELECT * FROM libraries WHERE id=?").get(Number(req.params.id)) as LibraryRow | undefined;
    if (!lib) return reply.code(404).send({ error: "not_found" });
    return scanOne(lib);
  });

  app.post("/api/scan", async () => {
    const out: Record<number, ScanStats> = {};
    for (const lib of libs()) out[lib.id] = await scanOne(lib);
    return out;
  });

  // --- Catálogo ---
  app.get("/api/movies", async (): Promise<MovieSummary[]> =>
    db.prepare(`
      SELECT m.id, m.title, m.year, MIN(f.id) AS fileId
      FROM movies m JOIN media_files f ON f.movie_id = m.id
      GROUP BY m.id ORDER BY m.title COLLATE NOCASE`).all() as MovieSummary[],
  );

  app.get("/api/series", async (): Promise<SeriesSummary[]> =>
    db.prepare(`
      SELECT s.id, s.title,
             COUNT(DISTINCT se.id) AS seasons, COUNT(DISTINCT e.id) AS episodes
      FROM series s
      JOIN seasons se ON se.series_id = s.id
      JOIN episodes e ON e.season_id = se.id
      GROUP BY s.id ORDER BY s.title COLLATE NOCASE`).all() as SeriesSummary[],
  );

  app.get<{ Params: { id: string } }>("/api/series/:id", async (req, reply): Promise<SeriesDetail | void> => {
    const s = db.prepare("SELECT id,title FROM series WHERE id=?").get(Number(req.params.id)) as
      | { id: number; title: string } | undefined;
    if (!s) return reply.code(404).send({ error: "not_found" });
    const rows = db.prepare(`
      SELECT se.id AS seasonId, se.number AS seasonNumber, e.id AS episodeId, e.number, e.title, MIN(f.id) AS fileId
      FROM seasons se JOIN episodes e ON e.season_id = se.id JOIN media_files f ON f.episode_id = e.id
      WHERE se.series_id = ? GROUP BY e.id ORDER BY se.number, e.number`).all(s.id) as any[];
    const seasons = new Map<number, SeriesDetail["seasons"][number]>();
    for (const r of rows) {
      if (!seasons.has(r.seasonId)) seasons.set(r.seasonId, { id: r.seasonId, number: r.seasonNumber, episodes: [] });
      seasons.get(r.seasonId)!.episodes.push({ id: r.episodeId, number: r.number, title: r.title, fileId: r.fileId });
    }
    return { id: s.id, title: s.title, seasons: [...seasons.values()] };
  });

  // --- Archivos ---
  app.get<{ Params: { id: string } }>("/api/files/:id", async (req, reply): Promise<MediaFileInfo | void> => {
    const f = db.prepare(`
      SELECT f.id, f.rel_path AS relPath, f.size_bytes AS sizeBytes, f.container,
             f.duration_s AS durationS, f.bitrate,
             m.title AS movieTitle, m.year AS movieYear,
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
