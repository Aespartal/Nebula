import type { ClientCapabilities, DecisionReason, DecisionReasonCode, MediaStreamInfo } from "@nebula/shared";

export interface DecideInput {
  ext: string; // ".mkv"
  container: string | null; // format_name de ffprobe
  bitrate: number | null;
  streams: MediaStreamInfo[];
  caps: ClientCapabilities;
  audioStreamIdx?: number;
  forceTranscode?: boolean;
}

export interface Decision {
  /** remux: el vídeo se copia y solo se convierte lo que sobra (contenedor, audio). transcode: se recodifica el vídeo. */
  mode: "direct" | "remux" | "transcode" | "unplayable";
  reasons: DecisionReason[];
  videoIdx: number | null;
  audioIdx: number | null;
  sourceHeight: number | null;
}

type Container = "mp4" | "webm" | "mkv" | "other";

export function containerOf(ext: string, formatName: string | null): Container {
  const f = formatName ?? "";
  if (f.includes("mp4") || f.includes("mov")) return "mp4";
  if (f.includes("matroska") || f.includes("webm")) return ext === ".webm" ? "webm" : "mkv";
  return "other";
}

const VIDEO_KEY: Record<string, "h264" | "hevc" | "vp9" | "av1"> = {
  h264: "h264", hevc: "hevc", vp9: "vp9", av1: "av1",
};
const AUDIO_KEY: Record<string, keyof ClientCapabilities["audio"]> = {
  aac: "aac", mp3: "mp3", opus: "opus", vorbis: "vorbis", flac: "flac", ac3: "ac3", eac3: "eac3",
};

// Qué códecs admite cada contenedor para reproducción directa en un <video>.
const CONTAINER_VIDEO: Record<Container, string[]> = {
  mp4: ["h264", "hevc", "av1", "vp9"],
  webm: ["vp9", "av1"],
  mkv: ["h264", "hevc", "vp9", "av1"],
  other: [],
};
const CONTAINER_AUDIO: Record<Container, string[]> = {
  mp4: ["aac", "mp3", "ac3", "eac3", "opus", "flac"],
  webm: ["opus", "vorbis"],
  mkv: ["aac", "mp3", "ac3", "eac3", "opus", "vorbis", "flac"],
  other: [],
};

const EIGHT_BIT = new Set(["yuv420p", "yuvj420p"]);

// Qué se puede copiar tal cual a segmentos MPEG-TS de HLS (VP9 y AV1 no caben ahí) y qué problemas se arreglan sin tocar el vídeo.
const REMUX_VIDEO = new Set(["h264", "hevc"]);
const REMUX_FIXABLE = new Set<DecisionReasonCode>(["container", "audio_codec", "audio_track"]);

/** El audio que un navegador reproduciría por defecto: la pista marcada o, si no, la primera. */
export function defaultAudio(streams: MediaStreamInfo[]): MediaStreamInfo | undefined {
  const audio = streams.filter((s) => s.kind === "audio");
  return audio.find((s) => s.isDefault) ?? audio[0];
}

export function decidePlayback(i: DecideInput): Decision {
  const video = i.streams.find((s) => s.kind === "video");
  const audioStreams = i.streams.filter((s) => s.kind === "audio");
  const chosenAudio =
    (i.audioStreamIdx !== undefined ? audioStreams.find((s) => s.idx === i.audioStreamIdx) : undefined) ??
    defaultAudio(i.streams);
  const base = {
    videoIdx: video?.idx ?? null,
    audioIdx: chosenAudio?.idx ?? null,
    sourceHeight: video?.height ?? null,
  };
  if (!video) return { mode: "unplayable", reasons: [], ...base };

  const reasons: DecisionReason[] = [];
  const container = containerOf(i.ext, i.container);

  if (i.forceTranscode) reasons.push({ code: "forced" });

  if (!i.caps.containers[container as "mp4" | "webm" | "mkv"]) {
    reasons.push({ code: "container", detail: container === "other" ? (i.container ?? "?") : container });
  }

  const vKey = video.codec ? VIDEO_KEY[video.codec] : undefined;
  if (!vKey || !i.caps.video[vKey] || !CONTAINER_VIDEO[container].includes(video.codec ?? "")) {
    reasons.push({ code: "video_codec", detail: video.codec ?? "?" });
  } else if (!EIGHT_BIT.has(video.pixFmt ?? "") && video.codec !== "av1") {
    // H.264 de 10 bits, 4:2:2, etc.: casi ningún navegador lo decodifica.
    reasons.push({ code: "video_profile", detail: `${video.profile ?? ""} ${video.pixFmt ?? ""}`.trim() });
  }

  if (chosenAudio) {
    const aKey = chosenAudio.codec ? AUDIO_KEY[chosenAudio.codec] : undefined;
    if (!aKey || !i.caps.audio[aKey] || !CONTAINER_AUDIO[container].includes(chosenAudio.codec ?? "")) {
      reasons.push({ code: "audio_codec", detail: chosenAudio.codec ?? "?" });
    }
    // El navegador solo reproduce la pista por defecto; otra pista exige convertir.
    if (chosenAudio.idx !== defaultAudio(i.streams)?.idx) {
      reasons.push({ code: "audio_track", detail: chosenAudio.language ?? String(chosenAudio.idx) });
    }
  }

  if (i.caps.maxBitrate && i.bitrate && i.bitrate > i.caps.maxBitrate) reasons.push({ code: "bitrate" });

  if (reasons.length === 0) return { mode: "direct", reasons, ...base };
  if (i.caps.hls === "none") return { mode: "unplayable", reasons, ...base };

  // El vídeo es válido para este navegador (códec admitido, 8 bits): solo falla la caja o el audio, y eso se arregla sin recodificar.
  // Un `video_codec` aquí solo puede venir de una caja que no admite ese códec (avi, ts…), no del navegador.
  const videoCopyable = !!vKey && !!i.caps.video[vKey] && REMUX_VIDEO.has(video.codec ?? "") && EIGHT_BIT.has(video.pixFmt ?? "");
  const remuxable = videoCopyable && reasons.every((r) => REMUX_FIXABLE.has(r.code) || r.code === "video_codec");
  // En remux el vídeo no es el problema: ese motivo vendría de la caja (ya listada como `container`) y sería engañoso.
  if (remuxable) return { mode: "remux", reasons: reasons.filter((r) => r.code !== "video_codec"), ...base };
  return { mode: "transcode", reasons, ...base };
}
