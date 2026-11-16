export type LibraryType = "movies" | "series";

export interface Library { id: number; name: string; type: LibraryType; rootPath: string }

export interface MovieSummary { id: number; title: string; year: number | null; fileId: number }
export interface SeriesSummary { id: number; title: string; seasons: number; episodes: number }

export interface EpisodeItem { id: number; number: number; title: string | null; fileId: number }
export interface SeasonItem { id: number; number: number; episodes: EpisodeItem[] }
export interface SeriesDetail { id: number; title: string; seasons: SeasonItem[] }

export interface MediaStreamInfo {
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
  isExternal: boolean;
}

export interface NextEpisode { fileId: number; label: string }

export interface MediaFileInfo {
  id: number;
  kind: "movie" | "episode";
  title: string;
  /** Contexto corto bajo el título: "Breaking Bad · T1 E2" o el año de la película. */
  subtitle: string | null;
  seriesId: number | null;
  next: NextEpisode | null;
  relPath: string;
  sizeBytes: number;
  container: string | null;
  durationS: number | null;
  bitrate: number | null;
  streams: MediaStreamInfo[];
}

export interface ScanStats { added: number; updated: number; unchanged: number; removed: number; skipped: number; failed: number }

// --- Reproducción (fase 3) ---

export interface ClientCapabilities {
  video: Partial<Record<"h264" | "hevc" | "vp9" | "av1", boolean>>;
  audio: Partial<Record<"aac" | "mp3" | "opus" | "vorbis" | "flac" | "ac3" | "eac3", boolean>>;
  containers: Partial<Record<"mp4" | "webm" | "mkv", boolean>>;
  /** "native": el navegador reproduce HLS solo (Safari); "mse": con hls.js; "none": sin HLS. */
  hls: "native" | "mse" | "none";
  /** Límites opcionales del cliente. */
  maxBitrate?: number;
  maxHeight?: number;
}

export type DecisionReasonCode =
  | "container"
  | "video_codec"
  | "video_profile"
  | "audio_codec"
  | "audio_track"
  | "bitrate"
  | "forced";

export interface DecisionReason { code: DecisionReasonCode; detail?: string }

export interface PlaybackRequest {
  capabilities: ClientCapabilities;
  audioStreamIdx?: number;
  forceTranscode?: boolean;
}

export interface PlaybackDecision {
  mode: "direct" | "transcode";
  url: string;
  sessionId?: string;
  reasons: DecisionReason[];
  /** Codificador que usará el servidor al convertir. */
  encoder?: "nvenc" | "x264";
  durationS: number | null;
}

export interface SystemInfo {
  ffmpeg: string | null;
  nvenc: boolean;
  profiles: string[];
  maxSessions: number;
  activeSessions: number;
}
