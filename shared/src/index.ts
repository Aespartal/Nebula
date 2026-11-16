export type LibraryType = "movies" | "series";

export interface Library { id: number; name: string; type: LibraryType; rootPath: string }

/** `progress` es la fracción vista (0–1) para la barra de la tarjeta; `watched` si está marcada como vista. */
export interface MovieSummary { id: number; title: string; year: number | null; fileId: number; watched: boolean; progress: number; hasPoster: boolean }
export interface SeriesSummary { id: number; title: string; seasons: number; episodes: number; watchedEpisodes: number; hasPoster: boolean }

export interface EpisodeItem { id: number; number: number; title: string | null; overview: string | null; fileId: number; watched: boolean; progress: number }
export interface SeasonItem { id: number; number: number; episodes: EpisodeItem[] }
export interface SeriesDetail { id: number; title: string; overview: string | null; hasPoster: boolean; seasons: SeasonItem[] }

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
  /** Solo subtítulos: true si son de texto (se pueden mostrar); false si son de imagen (PGS, DVD). */
  textual: boolean;
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
  /** Sinopsis (de TMDB, si está configurado). */
  overview: string | null;
  /** Estado de visionado del usuario actual. */
  resume: WatchProgress;
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

// --- Cuentas (fase 4) ---

export type Role = "admin" | "user";
export interface SessionUser { id: number; username: string; role: Role }
export interface User extends SessionUser { createdAt: number }
export interface AuthStatus {
  /** true si aún no existe ningún usuario: hay que crear el administrador. */
  setupRequired: boolean;
  user: SessionUser | null;
}

// --- Progreso (fase 4) ---

export interface WatchProgress { positionS: number; durationS: number | null; watched: boolean }

export interface ContinueItem {
  fileId: number;
  kind: "movie" | "episode";
  title: string;
  subtitle: string | null;
  /** "resume": a medias; "next": siguiente episodio de una serie que ibas viendo. */
  reason: "resume" | "next";
  positionS: number;
  durationS: number | null;
  /** URL de la carátula (de la película o de la serie), si se conoce. */
  poster: string | null;
}

// --- Metadatos (fase 5) ---

export interface MetadataStatus {
  /** Hay una clave de TMDB configurada en el servidor. */
  enabled: boolean;
  running: boolean;
  movies: { total: number; withPoster: number; pending: number };
  series: { total: number; withPoster: number; pending: number };
  /** Último problema (p. ej. clave rechazada), en forma de código. */
  lastError: "invalid_key" | "network" | null;
}
