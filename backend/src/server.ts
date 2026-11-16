import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { config } from "./config.js";
import { openDb, type Db } from "./db/index.js";
import { registerRoutes } from "./routes.js";
import { scanLibrary, type LibraryRow } from "./scanner.js";

const db: Db = openDb(path.join(config.dataDir, "nebula.db"));

function bootstrapLibrary(name: string, type: "movies" | "series", root?: string) {
  if (!root) return;
  db.prepare("INSERT OR IGNORE INTO libraries(name,type,root_path) VALUES(?,?,?)").run(name, type, root);
}
bootstrapLibrary("Películas", "movies", config.moviesDir);
bootstrapLibrary("Series", "series", config.seriesDir);

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });
registerRoutes(app, db);

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
    .then((s) => app.log.info({ library: lib.name, ...s }, "escaneo inicial completado"))
    .catch((e) => app.log.error({ library: lib.name, err: e.message }, "escaneo inicial falló"));
}
