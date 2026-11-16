import path from "node:path";

export const config = {
  port: Number(process.env.PORT ?? 3000),
  // Por defecto solo localhost. Para la red local: HOST=0.0.0.0 (ya hay cuentas, pero sin HTTPS aún: fase 6).
  host: process.env.HOST ?? "127.0.0.1",
  // Pon TRUST_PROXY=1 cuando haya un proxy inverso delante (fase 6) para que la IP y el protocolo sean los reales.
  trustProxy: process.env.TRUST_PROXY === "1",
  dataDir: path.resolve(process.env.DATA_DIR ?? "./data"),
  ffprobePath: process.env.FFPROBE_PATH ?? "ffprobe",
  // Bootstrap opcional de bibliotecas al arrancar
  moviesDir: process.env.MOVIES_DIR ? path.resolve(process.env.MOVIES_DIR) : undefined,
  seriesDir: process.env.SERIES_DIR ? path.resolve(process.env.SERIES_DIR) : undefined,
  ffmpegPath: process.env.FFMPEG_PATH ?? "ffmpeg",
  hlsDir: path.resolve(process.env.HLS_DIR ?? path.join(process.env.DATA_DIR ?? "./data", "transcode")),
  maxTranscodeSessions: Number(process.env.MAX_TRANSCODES ?? 3),
  probeConcurrency: Number(process.env.PROBE_CONCURRENCY ?? 4),
};

export const VIDEO_EXTS = new Set([".mp4", ".mkv", ".webm", ".m4v", ".mov"]);
export const SUB_EXTS = new Set([".srt", ".vtt", ".ass"]);
