import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

/** Subtítulos de texto que FFmpeg sabe pasar a WebVTT. Los de imagen (PGS, DVD) no se pueden mostrar en el navegador. */
const TEXT_CODECS = new Set(["subrip", "srt", "ass", "ssa", "mov_text", "webvtt", "vtt", "text"]);
export const isTextSubtitle = (codec: string | null) => !!codec && TEXT_CODECS.has(codec.toLowerCase());

export class SubtitleError extends Error {
  constructor(readonly code: "unsupported" | "unreadable" | "conversion_failed" | "timeout") { super(code); }
}

/**
 * Los .srt antiguos suelen estar en Windows-1252 (ñ y acentos): se prueba UTF-8 estricto y, si no es válido, se lee como 1252.
 * También se admiten UTF-16 con BOM.
 */
export function decodeSubtitleText(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder("utf-16be").decode(buf.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(buf).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(buf);
  }
}

/** Un SRT de verdad tiene al menos una marca «00:01:02,500 --> 00:01:04,000». */
const SRT_CUE = /\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}[ \t]*-->[ \t]*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}/;
/** Tope de lo que se acepta al subir un subtítulo a mano: un .srt largo ronda los 150 KB. */
export const MAX_SUBTITLE_UPLOAD_BYTES = 2 * 1024 * 1024;

/**
 * Valida un .srt subido y lo devuelve normalizado a UTF-8 (sin BOM, con salto final), o null si no parece un SRT.
 * Guardarlo siempre en UTF-8 evita que la ñ y los acentos se rompan según quién lo lea después.
 */
export function normalizeUploadedSrt(buf: Buffer): string | null {
  if (buf.length === 0) return null;
  const text = decodeSubtitleText(buf).replace(/^\uFEFF/, "");
  if (text.includes("\u0000") || !SRT_CUE.test(text)) return null; // binario, imagen, o texto cualquiera
  return text.endsWith("\n") ? text : `${text}\n`;
}

function runFfmpeg(ffmpegPath: string, args: string[], stdin: string | null, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const out: Buffer[] = [];
    let size = 0, err = "", done = false;
    const finish = (fn: () => void) => { if (!done) { done = true; clearTimeout(timer); fn(); } };
    const timer = setTimeout(() => { p.kill(); finish(() => reject(new SubtitleError("timeout"))); }, timeoutMs);
    p.stdout.on("data", (d: Buffer) => {
      size += d.length;
      if (size > 8 * 1024 * 1024) { p.kill(); finish(() => reject(new SubtitleError("conversion_failed"))); return; }
      out.push(d);
    });
    p.stderr.on("data", (d) => { err = (err + d).slice(-1000); });
    p.on("error", () => finish(() => reject(new SubtitleError("conversion_failed"))));
    p.on("close", (code) => finish(() => (code === 0 ? resolve(Buffer.concat(out).toString("utf8")) : reject(new SubtitleError("conversion_failed")))));
    p.stdin.on("error", () => { /* ffmpeg pudo cerrar antes de leer todo */ });
    p.stdin.end(stdin ?? undefined);
  });
}

export interface SubtitleSource {
  videoPath: string;
  streamIdx: number;
  codec: string | null;
  externalPath: string | null;
}

/** Convierte un subtítulo (embebido o externo) a WebVTT. */
export async function convertToVtt(ffmpegPath: string, src: SubtitleSource): Promise<string> {
  if (!isTextSubtitle(src.codec)) throw new SubtitleError("unsupported");
  const common = ["-nostdin", "-hide_banner", "-loglevel", "error"];

  if (src.externalPath) {
    const raw = await readFile(src.externalPath).catch(() => { throw new SubtitleError("unreadable"); });
    const text = decodeSubtitleText(raw);
    const codec = src.codec!.toLowerCase();
    if (codec === "vtt" || codec === "webvtt") return text.startsWith("WEBVTT") ? text : `WEBVTT\n\n${text}`;
    const fmt = codec === "ass" || codec === "ssa" ? "ass" : "srt";
    return runFfmpeg(ffmpegPath, [...common, "-f", fmt, "-i", "pipe:0", "-f", "webvtt", "pipe:1"], text, 60_000);
  }
  // Los subtítulos embebidos van entremezclados con el vídeo: en un remux grande FFmpeg tiene que recorrer el archivo entero.
  return runFfmpeg(ffmpegPath, [...common, "-i", src.videoPath, "-map", `0:${src.streamIdx}`, "-f", "webvtt", "pipe:1"], null, 10 * 60_000);
}

/** Caché en disco de los VTT ya convertidos (clave: archivo + tamaño + fecha + pista) y control de conversiones simultáneas. */
export class SubtitleCache {
  private readonly inflight = new Map<string, Promise<string>>();
  constructor(private readonly dir: string, private readonly ffmpegPath: string) {}

  private async key(src: SubtitleSource): Promise<string> {
    const file = src.externalPath ?? src.videoPath;
    const s = await stat(file).catch(() => null);
    if (!s) throw new SubtitleError("unreadable");
    return createHash("sha1").update(`${file}|${s.size}|${s.mtimeMs}|${src.streamIdx}|v1`).digest("hex");
  }

  async get(src: SubtitleSource): Promise<string> {
    if (!isTextSubtitle(src.codec)) throw new SubtitleError("unsupported");
    const key = await this.key(src);
    const cached = path.join(this.dir, `${key}.vtt`);
    try { return await readFile(cached, "utf8"); } catch { /* no estaba */ }

    let job = this.inflight.get(key);
    if (!job) {
      job = (async () => {
        const vtt = await convertToVtt(this.ffmpegPath, src);
        await mkdir(this.dir, { recursive: true });
        const tmp = `${cached}.${process.pid}.tmp`;
        await writeFile(tmp, vtt);
        await rename(tmp, cached);
        return vtt;
      })().finally(() => this.inflight.delete(key));
      this.inflight.set(key, job);
    }
    return job;
  }
}
