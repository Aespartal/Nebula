import { createReadStream } from "node:fs";
import type { FastifyInstance } from "fastify";
import type { MetadataStatus } from "@nebula/shared";
import { requireAdmin } from "../auth/plugin.js";
import type { MetadataService } from "./service.js";

export function registerMetadataRoutes(app: FastifyInstance, meta: MetadataService) {
  app.get("/api/metadata/status", { preHandler: requireAdmin }, async (): Promise<MetadataStatus> => meta.status());

  // force: vuelve a consultar también lo que ya estaba reconocido.
  app.post<{ Body?: { force?: boolean } }>("/api/metadata/refresh", { preHandler: requireAdmin }, async (req, reply) => {
    if (!meta.enabled) return reply.code(409).send({ error: "tmdb_not_configured" });
    meta.kick(!!req.body?.force);
    return reply.code(202).send({ ...meta.status(), running: true });
  });

  app.get<{ Params: { kind: string; id: string } }>("/api/posters/:kind/:id", async (req, reply) => {
    const kind = req.params.kind === "movie" ? "movie" : req.params.kind === "series" ? "series" : null;
    if (!kind) return reply.code(404).send({ error: "not_found" });
    const file = await meta.posterFile(kind, Number(req.params.id));
    if (!file) return reply.code(404).send({ error: "no_poster" });
    return reply.type("image/jpeg").header("Cache-Control", "private, max-age=604800").send(createReadStream(file));
  });
}
