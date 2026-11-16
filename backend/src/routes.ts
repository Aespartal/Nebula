import { stat } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type {
  Library, MediaFileInfo, MovieSummary, ScanStats, SeriesDetail, SeriesSummary,
} from "@nebula/shared";
import type { Db } from "./db/index.js";
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
    const f = db.prepare(
      "SELECT id, rel_path AS relPath, size_bytes AS sizeBytes, container, duration_s AS durationS, bitrate FROM media_files WHERE id=?",
    ).get(Number(req.params.id)) as Omit<MediaFileInfo, "streams"> | undefined;
    if (!f) return reply.code(404).send({ error: "not_found" });
    const streams = (db.prepare(`
      SELECT idx, kind, codec, profile, pix_fmt AS pixFmt, width, height, channels, language, title,
             is_default AS isDefault, is_forced AS isForced, is_external AS isExternal
      FROM media_streams WHERE file_id=? ORDER BY idx`).all(f.id) as any[]).map((s) => ({
      ...s, isDefault: !!s.isDefault, isForced: !!s.isForced, isExternal: !!s.isExternal,
    }));
    return { ...f, streams };
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
