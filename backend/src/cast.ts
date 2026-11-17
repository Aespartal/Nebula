import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { CastSession } from "@nebula/shared";
import type { Db } from "./db/index.js";
import { decidePlayback } from "./ffmpeg/decide.js";
import type { HlsSessions } from "./ffmpeg/hls-sessions.js";
import { getStreams } from "./media-queries.js";

const SEG_RE = /^seg_\d{5}\.ts$/;
/** Duración del permiso. Cubre una película larga con pausas; la sesión de FFmpeg caduca antes si nadie pide segmentos. */
export const CAST_TTL_MS = 6 * 3600_000;
/** Calidad máxima para la tele: el túnel público tiene ancho de banda limitado. */
export const CAST_MAX_HEIGHT = 720;

/** Permisos firmados: `<sesión>.<caducidad>.<firma>`. Solo valen para una sesión de conversión concreta, nunca para la biblioteca. */
export class CastTickets {
  constructor(private secret: Buffer = randomBytes(32), private now: () => number = Date.now) {}

  private sign(body: string) { return createHmac("sha256", this.secret).update(body).digest("base64url"); }

  issue(sid: string): { ticket: string; expiresAt: number } {
    const expiresAt = this.now() + CAST_TTL_MS;
    const body = `${sid}.${expiresAt}`;
    return { ticket: `${body}.${this.sign(body)}`, expiresAt };
  }

  /** Devuelve la sesión si la firma es válida y no ha caducado. */
  verify(ticket: string): string | null {
    const parts = ticket.split(".");
    if (parts.length !== 3 || ticket.length > 200) return null;
    const [sid, exp, sig] = parts;
    if (!/^[0-9a-f-]{36}$/.test(sid) || !/^\d{10,15}$/.test(exp)) return null;
    const want = Buffer.from(this.sign(`${sid}.${exp}`));
    const got = Buffer.from(sig);
    if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
    return Number(exp) > this.now() ? sid : null;
  }
}

/** Rutas públicas (sin cookie) que solo sirven lo que un permiso firmado autoriza. La tele no tiene tu sesión. */
export const CAST_PUBLIC_PREFIX = "/api/cast/t/";

export function registerCastRoutes(
  app: FastifyInstance, db: Db, hls: HlsSessions | null,
  opts: { publicUrl: string | null; tickets?: CastTickets },
) {
  const tickets = opts.tickets ?? new CastTickets();
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Range", "Access-Control-Expose-Headers": "Content-Length, Content-Range" };

  // Crea la sesión de conversión para la tele y devuelve la dirección pública con permiso.
  app.post<{ Params: { id: string }; Body: { audioStreamIdx?: number } }>(
    "/api/cast/:id",
    { schema: { body: { type: "object", additionalProperties: false, properties: { audioStreamIdx: { type: "integer" } } } } },
    async (req, reply): Promise<CastSession | void> => {
      if (!opts.publicUrl) return reply.code(409).send({ error: "cast_not_configured" });
      if (!hls) return reply.code(503).send({ error: "transcoding_unavailable" });
      const id = Number(req.params.id);
      const f = db.prepare("SELECT path, container, duration_s AS durationS, bitrate FROM media_files WHERE id=?").get(id) as
        | { path: string; container: string | null; durationS: number | null; bitrate: number | null } | undefined;
      if (!f) return reply.code(404).send({ error: "not_found" });
      const streams = getStreams(db, id);
      const d = decidePlayback({
        ext: path.extname(f.path).toLowerCase(), container: f.container, bitrate: f.bitrate, streams,
        caps: { video: {}, audio: {}, containers: {}, hls: "mse" }, audioStreamIdx: req.body?.audioStreamIdx, forceTranscode: true,
      });
      if (d.mode === "unplayable") return reply.code(422).send({ error: "cannot_play" });
      if (!f.durationS || d.videoIdx === null) return reply.code(422).send({ error: "unknown_duration" });
      const video = streams.find((s) => s.idx === d.videoIdx);
      const session = await hls.create({
        fileId: id, input: f.path, durationS: f.durationS, videoIdx: d.videoIdx, audioIdx: d.audioIdx,
        sourceWidth: video?.width ?? null, sourceHeight: d.sourceHeight, maxHeight: CAST_MAX_HEIGHT,
      });
      const { ticket, expiresAt } = tickets.issue(session.id);
      return { url: `${opts.publicUrl}${CAST_PUBLIC_PREFIX}${ticket}/index.m3u8`, sessionId: session.id, durationS: f.durationS, expiresAt };
    },
  );

  if (!hls) return;
  const sessionFor = (ticket: string) => { const sid = tickets.verify(ticket); return sid ? hls.get(sid) : undefined; };

  app.options(`${CAST_PUBLIC_PREFIX}*`, async (_req, reply) => reply.headers({ ...cors, "Access-Control-Max-Age": "86400" }).code(204).send());

  app.get<{ Params: { ticket: string } }>(`${CAST_PUBLIC_PREFIX}:ticket/index.m3u8`, async (req, reply) => {
    if (!tickets.verify(req.params.ticket)) return reply.code(403).send({ error: "forbidden" });
    const s = sessionFor(req.params.ticket);
    if (!s) return reply.code(410).send({ error: "session_expired" });
    return reply.headers(cors).type("application/vnd.apple.mpegurl").header("Cache-Control", "no-store").send(hls.playlist(s));
  });

  app.get<{ Params: { ticket: string; seg: string } }>(`${CAST_PUBLIC_PREFIX}:ticket/:seg`, async (req, reply) => {
    if (!tickets.verify(req.params.ticket)) return reply.code(403).send({ error: "forbidden" });
    if (!SEG_RE.test(req.params.seg)) return reply.code(404).send({ error: "not_found" });
    const s = sessionFor(req.params.ticket);
    if (!s) return reply.code(410).send({ error: "session_expired" });
    const file = await hls.segment(s, Number(req.params.seg.slice(4, 9)));
    if (!file) return reply.code(s.failed ? 500 : 404).send({ error: s.failed ? "transcode_failed" : "not_found" });
    return reply.headers(cors).type("video/mp2t").header("Cache-Control", "private, max-age=600").send(createReadStream(file));
  });
}
