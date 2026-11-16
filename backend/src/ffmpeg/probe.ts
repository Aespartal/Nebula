import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "../config.js";

const execFileAsync = promisify(execFile);

export interface ProbedStream {
  idx: number;
  kind: "video" | "audio" | "subtitle";
  codec: string | null;
  profile: string | null;
  pixFmt: string | null;
  width: number | null;
  height: number | null;
  channels: number | null;
  language: string | null;
  title: string | null;
  isDefault: boolean;
  isForced: boolean;
}

export interface ProbeResult {
  container: string | null;
  durationS: number | null;
  bitrate: number | null;
  streams: ProbedStream[];
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return v === undefined || v === null || Number.isNaN(n) ? null : n;
};

export function parseProbeJson(json: any): ProbeResult {
  const streams: ProbedStream[] = [];
  for (const s of json.streams ?? []) {
    const kind = s.codec_type;
    if (kind !== "video" && kind !== "audio" && kind !== "subtitle") continue;
    // Las carátulas incrustadas aparecen como vídeo "attached_pic": se ignoran.
    if (kind === "video" && s.disposition?.attached_pic === 1) continue;
    streams.push({
      idx: s.index,
      kind,
      codec: s.codec_name ?? null,
      profile: s.profile ?? null,
      pixFmt: s.pix_fmt ?? null,
      width: num(s.width),
      height: num(s.height),
      channels: num(s.channels),
      language: s.tags?.language && s.tags.language !== "und" ? s.tags.language : null,
      title: s.tags?.title ?? null,
      isDefault: s.disposition?.default === 1,
      isForced: s.disposition?.forced === 1,
    });
  }
  return {
    container: json.format?.format_name ?? null,
    durationS: num(json.format?.duration),
    bitrate: num(json.format?.bit_rate),
    streams,
  };
}

export async function probe(file: string): Promise<ProbeResult> {
  const { stdout } = await execFileAsync(
    config.ffprobePath,
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file],
    { maxBuffer: 16 * 1024 * 1024, timeout: 60_000 },
  );
  return parseProbeJson(JSON.parse(stdout));
}
