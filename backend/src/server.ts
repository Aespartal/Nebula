import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { config } from "./config.js";
import { openDb, type Db } from "./db/index.js";
import { detectEncoders } from "./ffmpeg/encoders.js";
import { HlsSessions } from "./ffmpeg/hls-sessions.js";
import { registerAuth } from "./auth/plugin.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { SubtitleCache } from "./subtitles.js";
import { registerSubtitleRoutes } from "./subtitles-routes.js";
import { registerPlaybackRoutes } from "./playback-routes.js";
import { MetadataService } from "./metadata/service.js";
import { registerMetadataRoutes } from "./metadata/routes.js";
import { Tmdb } from "./metadata/tmdb.js";
import { registerProgressRoutes } from "./progress-routes.js";
import { registerRoutes } from "./routes.js";
import { incompletePathFilter, scanLibrary, setScanExclusion, type LibraryRow } from "./scanner.js";
import { completionHandlers, registerDownloadRoutes } from "./downloads-routes.js";
import { registerSystemRoutes } from "./system-routes.js";
import { QBittorrent } from "./torrents/qbittorrent.js";
import { TorrentService } from "./torrents/service.js";
import { registerSecurityHeaders } from "./security.js";
import { LibraryWatcher } from "./watcher.js";

const db: Db = openDb(path.join(config.dataDir, "nebula.db"));

function bootstrapLibrary(name: string, type: "movies" | "series", root?: string) {
  if (!root) return;
  db.prepare("INSERT OR IGNORE INTO libraries(name,type,root_path) VALUES(?,?,?)").run(name, type, root);
}
bootstrapLibrary("Películas", "movies", config.moviesDir);
bootstrapLibrary("Series", "series", config.seriesDir);

if (!!config.tlsCert !== !!config.tlsKey) throw new Error("Para HTTPS indica TLS_CERT y TLS_KEY a la vez.");
const https = config.tlsCert && config.tlsKey ? { cert: readFileSync(config.tlsCert), key: readFileSync(config.tlsKey) } : undefined;
const app = Fastify({ logger: true, trustProxy: config.trustProxy, ...(https ? { https } : {}) }) as unknown as FastifyInstance;
registerSecurityHeaders(app);
const exposed = !["127.0.0.1", "localhost", "::1"].includes(config.host);
if (exposed && !https && !config.trustProxy) {
  app.log.warn("Nebula escucha en la red sin HTTPS: las contraseñas y la sesión viajan sin cifrar. Usa TLS_CERT/TLS_KEY o un proxy inverso con TRUST_PROXY=1 (ver README).");
}
// Sin CORS: la web y la API comparten origen (en desarrollo, a través del proxy de Vite).
await registerAuth(app, db);
registerAuthRoutes(app, db);
let watcher: LibraryWatcher | null = null;
const meta = new MetadataService(
  db, config.tmdbKey ? new Tmdb({ apiKey: config.tmdbKey, language: config.tmdbLanguage, baseUrl: config.tmdbBaseUrl, imageBase: config.tmdbImageBase }) : null,
  path.join(config.dataDir, "posters"), (m) => app.log.info(m),
);
registerRoutes(app, db, () => meta.kick(), () => watcher?.sync());
registerProgressRoutes(app, db);
registerMetadataRoutes(app, meta);

const encoders = await detectEncoders(config.ffmpegPath);
let hls: HlsSessions | null = null;
if (encoders.profiles.length > 0) {
  hls = new HlsSessions({
    ffmpegPath: config.ffmpegPath, baseDir: config.hlsDir, profiles: encoders.profiles,
    maxSessions: config.maxTranscodeSessions, log: (m) => app.log.info(m),
  });
  await hls.init();
  app.addHook("onClose", async () => { await hls!.shutdown(); });
  app.log.info(`Conversión de vídeo: ${encoders.nvenc ? "GPU NVIDIA (NVENC)" : "solo CPU (x264)"} · FFmpeg ${encoders.ffmpegVersion}`);
} else {
  app.log.warn("FFmpeg no está disponible: solo se podrá reproducir en directo lo que el navegador admita. Ejecuta `npm run doctor`.");
}
registerPlaybackRoutes(app, db, hls, encoders, config.maxTranscodeSessions);
registerSystemRoutes(app, db, hls, encoders, config.maxTranscodeSessions);
registerSubtitleRoutes(app, db, new SubtitleCache(path.join(config.dataDir, "subtitles"), config.ffmpegPath));

// Descargas: Nebula controla un qBittorrent local. Sin TORRENT_USER/TORRENT_PASS la API responde «no configurado».
// Escaneo de una biblioteca (o de todas) tras terminar o borrar una descarga: lo gestiona el vigilante si está activo.
const rescan = (libraryId: number | null) => {
  const libs = (db.prepare("SELECT * FROM libraries").all() as LibraryRow[]).filter((l) => libraryId === null || l.id === libraryId);
  for (const lib of libs) {
    if (watcher) watcher.schedule(lib.id, 1000);
    else scanLibrary(db, lib).then(() => meta.kick()).catch((e) => app.log.warn(`escaneo tras descarga de «${lib.name}» falló: ${e.message}`));
  }
};
const torrentClient = config.torrent ? new QBittorrent(config.torrent) : null;
const torrentService = torrentClient
  ? new TorrentService(torrentClient, { ...completionHandlers(db, rescan), log: (m) => app.log.warn(m) })
  : null;
registerDownloadRoutes(app, db, { client: torrentClient, service: torrentService, minFreeBytes: config.torrentMinFreeBytes, rescan });
if (torrentService) {
  setScanExclusion(incompletePathFilter(() => torrentService.snapshot().torrents));
  torrentService.start();
  app.addHook("onClose", async () => { torrentService.stop(); });
}

// Si existe el build del frontend (npm run build), se sirve desde el mismo puerto.
const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../frontend/dist");
if (existsSync(webRoot)) {
  await app.register(fastifyStatic, { root: webRoot });
  app.setNotFoundHandler((req, reply) =>
    req.method === "GET" && !req.url.startsWith("/api/")
      ? reply.sendFile("index.html")
      : reply.code(404).send({ error: "not_found" }),
  );
}

await app.listen({ port: config.port, host: config.host });

// Escaneo inicial en segundo plano: no bloquea el arranque.
for (const lib of db.prepare("SELECT * FROM libraries").all() as LibraryRow[]) {
  scanLibrary(db, lib)
    .then((s) => { app.log.info({ library: lib.name, ...s }, "escaneo inicial completado"); meta.kick(); })
    .catch((e) => app.log.error({ library: lib.name, err: e.message }, "escaneo inicial falló"));
}

// Después, Nebula se entera sola de los archivos nuevos, cambiados o borrados.
if (config.watch) {
  watcher = new LibraryWatcher(db, {
    debounceMs: config.watchDebounceMs, intervalMs: config.scanIntervalMinutes * 60_000, log: (m) => app.log.warn(m),
    scan: async (lib) => {
      const s = await scanLibrary(db, lib);
      if (s.added || s.updated || s.removed) { app.log.info({ library: lib.name, ...s }, "cambios detectados"); meta.kick(); }
    },
  });
  watcher.sync();
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => { watcher?.close(); void app.close().finally(() => process.exit(0)); });
}
