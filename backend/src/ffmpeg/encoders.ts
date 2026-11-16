import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ProfileName } from "./args.js";

const run = promisify(execFile);

export interface EncoderInfo {
  ffmpegVersion: string | null;
  /** h264_nvenc aparece en la lista de codificadores de FFmpeg. */
  nvencListed: boolean;
  /** Una codificación de prueba con NVENC funcionó de verdad (hay GPU y driver). */
  nvenc: boolean;
  x264: boolean;
  /** Rutas de conversión por orden de preferencia. */
  profiles: ProfileName[];
}

async function out(bin: string, args: string[], timeout = 20_000): Promise<string | null> {
  try {
    const r = await run(bin, args, { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    return r.stdout + r.stderr;
  } catch {
    return null;
  }
}

export async function detectEncoders(ffmpegPath: string): Promise<EncoderInfo> {
  const version = await out(ffmpegPath, ["-version"]);
  if (!version) return { ffmpegVersion: null, nvencListed: false, nvenc: false, x264: false, profiles: [] };
  const list = (await out(ffmpegPath, ["-hide_banner", "-encoders"])) ?? "";
  const nvencListed = /\bh264_nvenc\b/.test(list);
  const x264 = /\blibx264\b/.test(list);

  // Que figure en la lista no basta: sin GPU o con un driver antiguo falla al codificar.
  let nvenc = false;
  if (nvencListed) {
    const r = await out(ffmpegPath, [
      "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=256x256:d=0.2",
      "-c:v", "h264_nvenc", "-f", "null", "-",
    ]);
    nvenc = r !== null;
  }

  const profiles: ProfileName[] = [];
  if (nvenc) profiles.push("nvenc-gpu", "nvenc-cpu-decode");
  if (x264) profiles.push("x264");
  return {
    ffmpegVersion: /ffmpeg version (\S+)/.exec(version)?.[1] ?? null,
    nvencListed, nvenc, x264, profiles,
  };
}
