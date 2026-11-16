import path from "node:path";

export const config = {
  port: Number(process.env.PORT ?? 3000),
  // Por defecto solo localhost. Para la red local: HOST=0.0.0.0 (sin HTTPS, la contraseña viaja en claro: ver README).
  host: process.env.HOST ?? "127.0.0.1",
  // Pon TRUST_PROXY=1 cuando haya un proxy inverso delante (fase 6) para que la IP y el protocolo sean los reales.
  // HTTPS directo (opcional): rutas al certificado y a la clave privada en formato PEM.
  // Alternativa recomendada para Internet: un proxy inverso con certificado automático (ver deploy/Caddyfile).
  tlsCert: process.env.TLS_CERT || undefined,
  tlsKey: process.env.TLS_KEY || undefined,
  // Vigilancia de carpetas: escanea solo cuando se añaden, cambian o borran archivos. WATCH=0 la desactiva.
  watch: process.env.WATCH !== "0",
  watchDebounceMs: Number(process.env.WATCH_DEBOUNCE_MS ?? 10_000),
  // Escaneo periódico de respaldo (útil con carpetas de red). 0 = desactivado.
  scanIntervalMinutes: Number(process.env.SCAN_INTERVAL_MINUTES ?? 0),
  trustProxy: process.env.TRUST_PROXY === "1",
  dataDir: path.resolve(process.env.DATA_DIR ?? "./data"),
  ffprobePath: process.env.FFPROBE_PATH ?? "ffprobe",
  // Bootstrap opcional de bibliotecas al arrancar
  moviesDir: process.env.MOVIES_DIR ? path.resolve(process.env.MOVIES_DIR) : undefined,
  seriesDir: process.env.SERIES_DIR ? path.resolve(process.env.SERIES_DIR) : undefined,
  ffmpegPath: process.env.FFMPEG_PATH ?? "ffmpeg",
  hlsDir: path.resolve(process.env.HLS_DIR ?? path.join(process.env.DATA_DIR ?? "./data", "transcode")),
  maxTranscodeSessions: Number(process.env.MAX_TRANSCODES ?? 3),
  // Carátulas y sinopsis (opcional). Clave v3 o «Token de acceso de lectura» v4 de themoviedb.org.
  tmdbKey: process.env.TMDB_API_KEY?.trim() || undefined,
  // Solo para pruebas con un TMDB simulado.
  tmdbBaseUrl: process.env.TMDB_BASE_URL,
  tmdbImageBase: process.env.TMDB_IMAGE_BASE,
  tmdbLanguage: process.env.TMDB_LANGUAGE ?? "es-ES",
  probeConcurrency: Number(process.env.PROBE_CONCURRENCY ?? 4),
  // Descargas: interfaz web de qBittorrent. Se considera configurado cuando están el usuario y la contraseña.
  torrent: process.env.TORRENT_USER && process.env.TORRENT_PASS
    ? { url: process.env.TORRENT_URL?.trim() || "http://127.0.0.1:8080", username: process.env.TORRENT_USER, password: process.env.TORRENT_PASS }
    : undefined,
  // Buscador de torrents: Prowlarr local. Configurado cuando está la API key.
  prowlarr: process.env.PROWLARR_API_KEY
    ? { url: process.env.PROWLARR_URL?.trim() || "http://127.0.0.1:9696", apiKey: process.env.PROWLARR_API_KEY.trim() }
    : undefined,
  // Espacio que debe quedar libre en el disco de descargas para aceptar una descarga nueva (GB).
  torrentMinFreeBytes: Math.round(Number(process.env.TORRENT_MIN_FREE_GB ?? 5) * 1024 ** 3),
};

export const VIDEO_EXTS = new Set([".mp4", ".mkv", ".webm", ".m4v", ".mov"]);
export const SUB_EXTS = new Set([".srt", ".vtt", ".ass"]);
