import { access } from "node:fs/promises";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "./config.js";
import { scanLibrary, type IndexedItem } from "./scanner.js";
import { sendRanged } from "./stream.js";

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

let library = new Map<string, IndexedItem>();

async function rescan() {
  const items = await scanLibrary(config.mediaDir);
  library = new Map(items.map((i) => [i.id, i]));
  return items.length;
}

app.get("/api/health", async () => ({ ok: true, items: library.size }));

app.get("/api/library", async () =>
  [...library.values()].map(({ absPath, ...pub }) => pub),
);

app.post("/api/library/scan", async () => ({ scanned: await rescan() }));

// Solo se sirve por id (nunca por ruta recibida) -> sin path traversal.
app.get<{ Params: { id: string } }>("/api/stream/:id", (req, reply) => {
  const item = library.get(req.params.id);
  if (!item) return reply.code(404).send({ error: "not_found" });
  return sendRanged(req, reply, item);
});

try {
  await access(config.mediaDir);
} catch {
  app.log.error(`MEDIA_DIR no existe: ${config.mediaDir} (defínelo con MEDIA_DIR=/ruta/a/tus/videos)`);
  process.exit(1);
}
const n = await rescan();
app.log.info(`Biblioteca: ${n} vídeos en ${config.mediaDir}`);
await app.listen({ port: config.port, host: config.host });
