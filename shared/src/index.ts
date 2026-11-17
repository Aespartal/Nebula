export type LibraryType = "movies" | "series";

export interface Library { id: number; name: string; type: LibraryType; rootPath: string }

/** `progress` es la fracción vista (0–1) para la barra de la tarjeta; `watched` si está marcada como vista. `addedAt`: cuándo entró en el catálogo (ms). */
export interface MovieSummary { id: number; title: string; year: number | null; fileId: number; watched: boolean; progress: number; hasPoster: boolean; addedAt: number }
/** `startedEpisodes`: episodios vistos o empezados (incluye los vistos); `addedAt`: cuándo entró el último episodio (ms). */
export interface SeriesSummary { id: number; title: string; seasons: number; episodes: number; watchedEpisodes: number; startedEpisodes: number; hasPoster: boolean; addedAt: number }

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
  /** Episodio anterior de la serie (para «pista anterior» de las teclas multimedia). */
  previous: NextEpisode | null;
  /** URL de la carátula (de la película o de la serie), si se conoce. */
  poster: string | null;
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
  /** ¿Está configurada PUBLIC_URL? Sin ella no se puede enviar a una tele fuera de la red local. */
  castAvailable: boolean;
}

/** Sesión para enviar a una tele: dirección pública con permiso firmado. */
export interface CastSession {
  url: string;
  sessionId: string;
  durationS: number;
  expiresAt: number;
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

/** Una novedad del catálogo: una película, o una serie con episodios nuevos (agrupados en una sola entrada). */
export interface RecentItem {
  kind: "movie" | "series";
  id: number;
  title: string;
  year: number | null;
  /** Película: archivo a reproducir. Serie: null (se abre su ficha). */
  fileId: number | null;
  /** Serie: episodios que entraron en la última tanda (24 h). Película: 0. */
  newEpisodes: number;
  /** Cuándo conoció Nebula el archivo (ms desde 1970). */
  addedAt: number;
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

// --- Sistema (solo administradores) ---

export interface ConversionSession {
  id: string;
  fileId: number;
  title: string;
  /** Ruta de conversión de FFmpeg ("nvenc-gpu", "nvenc-cpu-decode", "x264") o null si no hay proceso. */
  profile: string | null;
  running: boolean;
  failed: boolean;
  /** Posición a la que ha llegado el reproductor, en segundos, y duración total. */
  positionS: number;
  durationS: number;
  maxHeight: number;
  idleS: number;
  ageS: number;
}
export interface ConversionsInfo {
  ffmpeg: string | null;
  nvenc: boolean;
  profiles: string[];
  maxSessions: number;
  sessions: ConversionSession[];
}
export interface StorageLibrary {
  id: number;
  name: string;
  type: "movies" | "series";
  rootPath: string;
  files: number;
  /** Lo que ocupan los vídeos de esta carpeta. */
  sizeBytes: number;
  /** Estado del disco donde está la carpeta; null si no se puede leer (carpeta no accesible). */
  disk: { totalBytes: number; freeBytes: number } | null;
}

// --- Descargas (torrents) ---
export type DownloadKind = "movies" | "series";
export type DownloadState = "downloading" | "stalled" | "queued" | "checking" | "moving" | "seeding" | "paused" | "error" | "unknown" | "missing";
export interface DownloadItem {
  hash: string;
  name: string;
  state: DownloadState;
  /** 0 a 1. */
  progress: number;
  /** Descargado por completo (aunque ahora esté compartiendo o parado). */
  done: boolean;
  sizeBytes: number;
  downloadedBytes: number;
  speedDown: number;
  speedUp: number;
  etaS: number | null;
  kind: DownloadKind;
  addedBy: string | null;
  addedAt: number;
  /** Cuándo terminó y Nebula lo envió a la biblioteca; null si aún no. */
  completedAt: number | null;
}
export interface DownloadsStatus {
  /** ¿Están TORRENT_USER y TORRENT_PASS en el .env? */
  configured: boolean;
  connected: boolean;
  version?: string;
  /** "unreachable" (apagado o dirección mal), "auth" (usuario o contraseña) o "unsupported". */
  error?: "unreachable" | "auth" | "unsupported";
  message?: string;
  /** Espacio libre en el disco de descargas, si el cliente lo informa. */
  freeBytes: number | null;
  /** Margen que se exige libre antes de aceptar una descarga nueva. */
  minFreeBytes: number;
  /** ¿Está PROWLARR_API_KEY en el .env? Sin ella no hay buscador. */
  searchConfigured: boolean;
}

/** Resultado de buscar torrents en Prowlarr. */
export interface SearchHit {
  id: string;
  title: string;
  sizeBytes: number;
  seeders: number;
  leechers: number;
  indexer: string;
  publishedAt: number | null;
  infoUrl: string | null;
  /** Ya está entre las descargas. */
  added: boolean;
}
