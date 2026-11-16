import { statfs } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import type { ConversionsInfo, StorageLibrary } from "@nebula/shared";
import { requireAdmin } from "./auth/plugin.js";
import type { Db } from "./db/index.js";
import type { EncoderInfo } from "./ffmpeg/encoders.js";
import type { HlsSessions } from "./ffmpeg/hls-sessions.js";

const TITLE_SQL = `
  SELECT COALESCE(m.title, s.title || ' · T' || se.number || ' E' || e.number) AS title
  FROM media_files f
  LEFT JOIN movies m ON m.id = f.movie_id
  LEFT JOIN episodes e ON e.id = f.episode_id
  LEFT JOIN seasons se ON se.id = e.season_id
  LEFT JOIN series s ON s.id = se.series_id
  WHERE f.id = ?`;

/** Páginas de «Sistema»: conversiones en curso y almacenamiento. Solo administradores. */
export function registerSystemRoutes(app: FastifyInstance, db: Db, hls: HlsSessions | null, enc: EncoderInfo, maxSessions: number) {
  app.get("/api/system/conversions", { preHandler: requireAdmin }, async (): Promise<ConversionsInfo> => {
    const titleOf = db.prepare(TITLE_SQL);
    return {
      ffmpeg: enc.ffmpegVersion, nvenc: enc.nvenc, profiles: enc.profiles, maxSessions,
      sessions: (hls?.snapshot() ?? []).map((s) => ({
        id: s.id, fileId: s.fileId, profile: s.profile, running: s.running, failed: s.failed,
        title: (titleOf.get(s.fileId) as { title: string } | undefined)?.title ?? `Archivo ${s.fileId}`,
        positionS: s.positionS, durationS: s.durationS, maxHeight: s.maxHeight, idleS: s.idleS, ageS: s.ageS,
      })),
    };
  });

  app.post<{ Params: { id: string } }>("/api/system/conversions/:id/stop", { preHandler: requireAdmin }, async (req, reply) => {
    if (!hls?.get(req.params.id)) return reply.code(404).send({ error: "not_found" });
    await hls.stop(req.params.id);
    return { ok: true };
  });

  app.get("/api/system/storage", { preHandler: requireAdmin }, async (): Promise<StorageLibrary[]> => {
    const libs = db.prepare(`
      SELECT l.id, l.name, l.type, l.root_path AS rootPath, COUNT(f.id) AS files, COALESCE(SUM(f.size_bytes), 0) AS sizeBytes
      FROM libraries l LEFT JOIN media_files f ON f.library_id = l.id GROUP BY l.id ORDER BY l.id`).all() as Omit<StorageLibrary, "disk">[];
    return Promise.all(libs.map(async (l) => {
      try {
        const s = await statfs(l.rootPath);
        return { ...l, disk: { totalBytes: s.blocks * s.bsize, freeBytes: s.bavail * s.bsize } };
      } catch { return { ...l, disk: null }; }
    }));
  });
}
