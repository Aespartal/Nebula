import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
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
import { scanLibrary, type LibraryRow } from "./scanner.js";

const db: Db = openDb(path.join(config.dataDir, "nebula.db"));

function bootstrapLibrary(name: string, type: "movies" | "series", root?: string) {
  if (!root) return;
  db.prepare("INSERT OR IGNORE INTO libraries(name,type,root_path) VALUES(?,?,?)").run(name, type, root);
}
bootstrapLibrary("Películas", "movies", config.moviesDir);
bootstrapLibrary("Series", "series", config.seriesDir);

const app = Fastify({ logger: true, trustProxy: config.trustProxy });
// Sin CORS: la web y la API comparten origen (en desarrollo, a través del proxy de Vite).
await registerAuth(app, db);
registerAuthRoutes(app, db);
const meta = new MetadataService(
  db, config.tmdbKey ? new Tmdb({ apiKey: config.tmdbKey, language: config.tmdbLanguage }) : null,
  path.join(config.dataDir, "posters"), (m) => app.log.info(m),
);
registerRoutes(app, db, () => meta.kick());
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
registerSubtitleRoutes(app, db, new SubtitleCache(path.join(config.dataDir, "subtitles"), config.ffmpegPath));

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

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => void app.close().finally(() => process.exit(0)));
}
