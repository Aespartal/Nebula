import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { SubtitleUploadResult } from "@nebula/shared";
import { requireAdmin } from "./auth/plugin.js";
import type { Db } from "./db/index.js";
import { refreshExternalSubs } from "./scanner.js";
import { MAX_SUBTITLE_UPLOAD_BYTES, normalizeUploadedSrt, SubtitleCache, SubtitleError } from "./subtitles.js";

export function registerSubtitleRoutes(app: FastifyInstance, db: Db, cache: SubtitleCache) {
  // Subida rápida de un .srt: se guarda junto al vídeo como «Nombre.es.srt», que es donde el escaneo ya busca subtítulos.
  // Solo administradores (escribe en la biblioteca). La ruta destino sale de la base de datos y de un idioma validado: nunca del cliente.
  // Los bytes llegan crudos (application/octet-stream) para no estropear la codificación de los .srt antiguos.
  app.register(async (up) => {
    up.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: MAX_SUBTITLE_UPLOAD_BYTES }, (_req, body, done) => done(null, body));
    up.post<{ Params: { id: string }; Querystring: { lang?: string } }>(
      "/api/files/:id/subtitles",
      { onRequest: requireAdmin, bodyLimit: MAX_SUBTITLE_UPLOAD_BYTES },
      async (req, reply): Promise<SubtitleUploadResult | void> => {
        const lang = (req.query.lang ?? "es").toLowerCase();
        if (!/^[a-z]{2,3}$/.test(lang)) return reply.code(400).send({ error: "bad_language" });
        const id = Number(req.params.id);
        const file = db.prepare("SELECT path FROM media_files WHERE id=?").get(id) as { path: string } | undefined;
        if (!file) return reply.code(404).send({ error: "not_found" });

        const text = Buffer.isBuffer(req.body) ? normalizeUploadedSrt(req.body) : null;
        if (text === null) return reply.code(422).send({ error: "invalid_subtitle" });

        const target = path.join(path.dirname(file.path), `${path.basename(file.path, path.extname(file.path))}.${lang}.srt`);
        try {
          await writeFile(target, text, { flag: "wx" }); // nunca pisa un subtítulo que ya exista
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === "EEXIST") return reply.code(409).send({ error: "already_exists" });
          req.log.warn({ err: e }, "no se pudo guardar el subtítulo");
          return reply.code(500).send({ error: "write_failed" });
        }
        await refreshExternalSubs(db, id);
        const row = db.prepare("SELECT idx FROM media_streams WHERE file_id=? AND external_path=?").get(id, target) as { idx: number } | undefined;
        if (!row) return reply.code(500).send({ error: "write_failed" });
        return reply.code(201).send({ idx: row.idx, language: lang, title: path.basename(target) });
      },
    );
  });

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
