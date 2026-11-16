import type { FastifyInstance } from "fastify";
import type { Db } from "./db/index.js";
import { SubtitleCache, SubtitleError } from "./subtitles.js";

export function registerSubtitleRoutes(app: FastifyInstance, db: Db, cache: SubtitleCache) {
  // /api/subtitles/12/3.vtt → pista 3 del archivo 12. Solo por id de BD: la ruta del subtítulo nunca viene del cliente.
  app.get<{ Params: { id: string; idx: string } }>("/api/subtitles/:id/:idx", async (req, reply) => {
    const m = /^(\d+)\.vtt$/.exec(req.params.idx);
    if (!m) return reply.code(404).send({ error: "not_found" });
    const row = db.prepare(`
      SELECT f.path AS videoPath, s.idx AS streamIdx, s.codec, s.external_path AS externalPath
      FROM media_streams s JOIN media_files f ON f.id = s.file_id
      WHERE f.id = ? AND s.idx = ? AND s.kind = 'subtitle'`).get(Number(req.params.id), Number(m[1])) as
      | { videoPath: string; streamIdx: number; codec: string | null; externalPath: string | null } | undefined;
    if (!row) return reply.code(404).send({ error: "not_found" });
    try {
      const vtt = await cache.get(row);
      return reply.type("text/vtt; charset=utf-8").header("Cache-Control", "private, max-age=3600").send(vtt);
    } catch (e) {
      if (e instanceof SubtitleError) {
        const status = e.code === "unsupported" ? 415 : e.code === "unreadable" ? 404 : e.code === "timeout" ? 504 : 500;
        return reply.code(status).send({ error: `subtitle_${e.code}` });
      }
      throw e;
    }
  });
}
