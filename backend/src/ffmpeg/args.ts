export type ProfileName = "nvenc-gpu" | "nvenc-cpu-decode" | "x264";

export interface HlsJob {
  input: string;
  /** Primer segmento que debe producir esta ejecución y cuántos en total. */
  startSeg: number;
  segCount: number;
  segDur: number;
  videoIdx: number;
  audioIdx: number | null;
  sourceWidth: number | null;
  sourceHeight: number | null;
  maxHeight: number;
  profile: ProfileName;
}

/** Un resto final menor que esto se absorbe en el segmento anterior: con tan pocos fotogramas la GPU no consigue arrancar. */
const MIN_TAIL_S = 0.5;

export function segmentCount(durationS: number, segDur: number): number {
  const full = Math.floor(durationS / segDur + 1e-6);
  const rest = durationS - full * segDur;
  if (full >= 1 && rest < MIN_TAIL_S) return full;
  return Math.max(1, full + (rest > 1e-3 ? 1 : 0));
}

/** null = sin reescalar. Nunca se amplía. */
export function targetSize(w: number | null, h: number | null, maxHeight: number): { w: number; h: number } | null {
  if (!w || !h || h <= maxHeight) return null;
  const nh = maxHeight % 2 === 0 ? maxHeight : maxHeight - 1;
  const nw = Math.round((w * nh) / h / 2) * 2; // ancho par
  return { w: nw, h: nh };
}

/** Tope de bitrate en kbps según la altura de salida. */
export function maxrateKbps(height: number | null): number {
  if (!height) return 8000;
  if (height <= 480) return 2500;
  if (height <= 720) return 5000;
  if (height <= 1080) return 8000;
  return 16000;
}

export function buildHlsArgs(job: HlsJob): string[] {
  const start = job.startSeg * job.segDur;
  const size = targetSize(job.sourceWidth, job.sourceHeight, job.maxHeight);
  const outHeight = size?.h ?? job.sourceHeight;
  const rate = maxrateKbps(outHeight);
  const nvenc = job.profile !== "x264";

  const a = ["-nostdin", "-hide_banner", "-loglevel", "warning"];
  if (job.profile === "nvenc-gpu") a.push("-hwaccel", "cuda", "-hwaccel_output_format", "cuda");
  if (start > 0) a.push("-ss", start.toFixed(3));
  a.push("-i", job.input, "-t", (job.segCount * job.segDur).toFixed(3));

  a.push("-map", `0:${job.videoIdx}`);
  if (job.audioIdx !== null) a.push("-map", `0:${job.audioIdx}`);
  a.push("-sn", "-dn", "-map_metadata", "-1", "-map_chapters", "-1");

  // Filtro de vídeo: en GPU los fotogramas se quedan en memoria CUDA.
  if (job.profile === "nvenc-gpu") {
    a.push("-vf", size ? `scale_cuda=w=${size.w}:h=${size.h}:format=nv12` : "scale_cuda=format=nv12");
  } else {
    a.push("-vf", size ? `scale=${size.w}:${size.h}:flags=bicubic,format=yuv420p` : "format=yuv420p");
  }

  if (nvenc) {
    a.push(
      "-c:v", "h264_nvenc", "-preset", "p4", "-tune", "hq", "-profile:v", "high",
      "-rc", "vbr", "-cq", "21", "-b:v", "0", "-maxrate", `${rate}k`, "-bufsize", `${rate * 2}k`,
      "-forced-idr", "1", "-g", "300",
    );
  } else {
    a.push(
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-maxrate", `${rate}k`, "-bufsize", `${rate * 2}k`,
      "-profile:v", "high", "-level:v", "4.1", "-sc_threshold", "0", "-g", "300",
    );
  }
  // Un fotograma clave exacto cada segmento: es lo que permite una playlist de duraciones fijas.
  a.push("-force_key_frames", `expr:gte(t,n_forced*${job.segDur})`);

  if (job.audioIdx !== null) {
    a.push("-c:a", "aac", "-b:a", "192k", "-ac", "2", "-ar", "48000", "-af", "aresample=async=1:first_pts=0");
  }

  a.push(
    "-max_muxing_queue_size", "2048",
    // Marcas de tiempo absolutas: los segmentos de ejecuciones distintas encajan en una sola línea de tiempo.
    "-output_ts_offset", start.toFixed(3),
    "-f", "hls", "-hls_time", String(job.segDur), "-hls_list_size", "0", "-hls_segment_type", "mpegts",
    "-start_number", String(job.startSeg),
    "-hls_flags", "temp_file+independent_segments",
    "-hls_segment_filename", "seg_%05d.ts",
    "ffmpeg.m3u8",
  );
  return a;
}

export const segmentName = (n: number) => `seg_${String(n).padStart(5, "0")}.ts`;

/** Playlist VOD completa y virtual: el reproductor ve la duración total y puede saltar a cualquier punto. */
export function buildPlaylist(durationS: number, segDur: number): string {
  const total = segmentCount(durationS, segDur);
  const lines = [
    "#EXTM3U", "#EXT-X-VERSION:3", `#EXT-X-TARGETDURATION:${Math.ceil(segDur)}`,
    "#EXT-X-PLAYLIST-TYPE:VOD", "#EXT-X-MEDIA-SEQUENCE:0",
  ];
  for (let i = 0; i < total; i++) {
    const len = i === total - 1 ? durationS - i * segDur : segDur;
    lines.push(`#EXTINF:${Math.max(len, 0.001).toFixed(3)},`, segmentName(i));
  }
  lines.push("#EXT-X-ENDLIST", "");
  return lines.join("\n");
}
