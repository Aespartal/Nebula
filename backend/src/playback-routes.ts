import { createReadStream } from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { PlaybackDecision, PlaybackRequest, SystemInfo } from "@nebula/shared";
import type { Db } from "./db/index.js";
import { decidePlayback } from "./ffmpeg/decide.js";
import type { EncoderInfo } from "./ffmpeg/encoders.js";
import type { HlsSessions } from "./ffmpeg/hls-sessions.js";
import { getStreams } from "./media-queries.js";

const SEG_RE = /^seg_\d{5}\.ts$/;

export function registerPlaybackRoutes(app: FastifyInstance, db: Db, hls: HlsSessions | null, enc: EncoderInfo, maxSessions: number) {
  app.get("/api/system", async (): Promise<SystemInfo> => ({
    ffmpeg: enc.ffmpegVersion, nvenc: enc.nvenc, profiles: enc.profiles,
    maxSessions, activeSessions: hls?.activeCount ?? 0,
  }));

  app.post<{ Params: { id: string }; Body: PlaybackRequest }>(
    "/api/playback/:id/decide",
    {
      schema: {
        body: {
          type: "object",
          required: ["capabilities"],
          properties: {
            capabilities: { type: "object" },
            audioStreamIdx: { type: "integer" },
            forceTranscode: { type: "boolean" },
          },
        },
      },
    },
    async (req, reply): Promise<PlaybackDecision | void> => {
      const id = Number(req.params.id);
      const f = db.prepare("SELECT path, container, duration_s AS durationS, bitrate FROM media_files WHERE id=?").get(id) as
        | { path: string; container: string | null; durationS: number | null; bitrate: number | null } | undefined;
      if (!f) return reply.code(404).send({ error: "not_found" });

      const caps = req.body.capabilities;
      const d = decidePlayback({
        ext: path.extname(f.path).toLowerCase(), container: f.container, bitrate: f.bitrate,
        streams: getStreams(db, id), caps,
        audioStreamIdx: req.body.audioStreamIdx, forceTranscode: req.body.forceTranscode,
      });

      if (d.mode === "unplayable") return reply.code(422).send({ error: "cannot_play" });
      if (d.mode === "direct") {
        return { mode: "direct", url: `/api/stream/${id}`, reasons: d.reasons, durationS: f.durationS };
      }
      if (!hls) return reply.code(503).send({ error: "transcoding_unavailable" });
      if (!f.durationS || d.videoIdx === null) return reply.code(422).send({ error: "unknown_duration" });

      const video = getStreams(db, id).find((s) => s.idx === d.videoIdx);
      const session = await hls.create({
        fileId: id, input: f.path, durationS: f.durationS, videoIdx: d.videoIdx, audioIdx: d.audioIdx,
        sourceWidth: video?.width ?? null, sourceHeight: d.sourceHeight,
        maxHeight: Math.min(caps.maxHeight ?? 1080, 1080),
      });
      return {
        mode: "transcode", url: `/api/hls/${session.id}/index.m3u8`, sessionId: session.id,
        reasons: d.reasons, encoder: hls.encoder, durationS: f.durationS,
      };
    },
  );

  if (!hls) return;

  app.get<{ Params: { sid: string } }>("/api/hls/:sid/index.m3u8", async (req, reply) => {
    const s = hls.get(req.params.sid);
    if (!s) return reply.code(410).send({ error: "session_expired" });
    return reply.type("application/vnd.apple.mpegurl").header("Cache-Control", "no-store").send(hls.playlist(s));
  });

  app.get<{ Params: { sid: string; seg: string } }>("/api/hls/:sid/:seg", async (req, reply) => {
    if (!SEG_RE.test(req.params.seg)) return reply.code(404).send({ error: "not_found" });
    const s = hls.get(req.params.sid);
    if (!s) return reply.code(410).send({ error: "session_expired" });
    const n = Number(req.params.seg.slice(4, 9));
    const file = await hls.segment(s, n);
    if (!file) return reply.code(s.failed ? 500 : 404).send({ error: s.failed ? "transcode_failed" : "not_found" });
    return reply.type("video/mp2t").header("Cache-Control", "private, max-age=600").send(createReadStream(file));
  });

  app.post<{ Params: { sid: string } }>("/api/hls/:sid/stop", async (req, reply) => {
    await hls.stop(req.params.sid);
    return reply.code(204).send();
  });
}
