import path from "node:path";

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? "0.0.0.0",
  mediaDir: path.resolve(process.env.MEDIA_DIR ?? "./media-test"),
};

export const VIDEO_EXTS = new Set([".mp4", ".mkv", ".webm", ".m4v", ".mov"]);
