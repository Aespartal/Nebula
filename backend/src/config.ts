import path from "node:path";

export const config = {
  port: Number(process.env.PORT ?? 3000),
  // Por seguridad solo localhost hasta tener auth (fase 4). Para LAN: HOST=0.0.0.0
  host: process.env.HOST ?? "127.0.0.1",
  dataDir: path.resolve(process.env.DATA_DIR ?? "./data"),
  ffprobePath: process.env.FFPROBE_PATH ?? "ffprobe",
  // Bootstrap opcional de bibliotecas al arrancar
  moviesDir: process.env.MOVIES_DIR ? path.resolve(process.env.MOVIES_DIR) : undefined,
  seriesDir: process.env.SERIES_DIR ? path.resolve(process.env.SERIES_DIR) : undefined,
  probeConcurrency: Number(process.env.PROBE_CONCURRENCY ?? 4),
};

export const VIDEO_EXTS = new Set([".mp4", ".mkv", ".webm", ".m4v", ".mov"]);
export const SUB_EXTS = new Set([".srt", ".vtt", ".ass"]);
