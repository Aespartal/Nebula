import { createReadStream } from "node:fs";
import type { FastifyInstance } from "fastify";
import type { MetadataCandidate, MetadataStatus } from "@nebula/shared";
import { requireAdmin } from "../auth/plugin.js";
import { POSTER_PATH_RE, type MetaKind, type MetadataService } from "./service.js";
import { TmdbError } from "./tmdb.js";

const kindOf = (k: string): MetaKind | null => (k === "movie" || k === "series" ? k : null);
/** Un fallo de TMDB no es un fallo de Nebula: se cuenta como «pasarela» para que la pantalla lo explique. */
const tmdbFailure = (e: unknown) => (e instanceof TmdbError ? (e.code === "invalid_key" ? "tmdb_invalid_key" : "tmdb_unavailable") : null);

export function registerMetadataRoutes(app: FastifyInstance, meta: MetadataService) {
  app.get("/api/metadata/status", { preHandler: requireAdmin }, async (): Promise<MetadataStatus> => meta.status());

  // force: vuelve a consultar también lo que ya estaba reconocido.
  app.post<{ Body?: { force?: boolean } }>("/api/metadata/refresh", { preHandler: requireAdmin }, async (req, reply) => {
    if (!meta.enabled) return reply.code(409).send({ error: "tmdb_not_configured" });
    meta.kick(!!req.body?.force);
    return reply.code(202).send({ ...meta.status(), running: true });
  });

  // --- Corrección manual (solo administradores) ---
  app.get<{ Querystring: { kind?: string; q?: string; year?: string } }>("/api/metadata/search", { preHandler: requireAdmin }, async (req, reply): Promise<MetadataCandidate[] | void> => {
    if (!meta.enabled) return reply.code(409).send({ error: "tmdb_not_configured" });
    const kind = kindOf(req.query.kind ?? "");
    const q = (req.query.q ?? "").trim();
    const year = req.query.year ? Number(req.query.year) : null;
    if (!kind || q.length < 1 || q.length > 200 || (year !== null && !(Number.isInteger(year) && year >= 1870 && year <= 2100))) {
      return reply.code(400).send({ error: "bad_request" });
    }
    try {
      return await meta.candidates(kind, q, kind === "movie" ? year : null);
    } catch (e) {
      const code = tmdbFailure(e);
      if (!code) throw e;
      return reply.code(502).send({ error: code });
    }
  });

  // El navegador no habla con TMDB (la política de contenido solo admite imágenes del propio origen): Nebula las trae.
  app.get<{ Querystring: { path?: string } }>("/api/metadata/candidate-poster", { preHandler: requireAdmin }, async (req, reply) => {
    if (!meta.enabled) return reply.code(409).send({ error: "tmdb_not_configured" });
    const p = req.query.path ?? "";
    if (!POSTER_PATH_RE.test(p)) return reply.code(400).send({ error: "bad_request" });
    try {
      return reply.type("image/jpeg").header("Cache-Control", "private, max-age=86400").send(await meta.candidatePoster(p));
    } catch (e) {
      if (!tmdbFailure(e)) throw e;
      return reply.code(404).send({ error: "no_poster" });
    }
  });

  // Fija los datos de TMDB de una película o serie. tmdbId null = ninguna coincidencia.
  app.put<{ Params: { kind: string; id: string }; Body: { tmdbId: number | null } }>(
    "/api/metadata/:kind/:id",
    { preHandler: requireAdmin, schema: { body: { type: "object", required: ["tmdbId"], additionalProperties: false, properties: { tmdbId: { type: ["integer", "null"], minimum: 1 } } } } },
    async (req, reply) => {
      if (!meta.enabled) return reply.code(409).send({ error: "tmdb_not_configured" });
      const kind = kindOf(req.params.kind);
      const id = Number(req.params.id);
      if (!kind || !Number.isInteger(id)) return reply.code(404).send({ error: "not_found" });
      try {
        const r = await meta.assign(kind, id, req.body.tmdbId);
        if (r !== "ok") return reply.code(404).send({ error: r });
        return reply.code(204).send();
      } catch (e) {
        const code = tmdbFailure(e);
        if (!code) throw e;
        return reply.code(502).send({ error: code });
      }
    },
  );

  // Vuelve al modo automático.
  app.delete<{ Params: { kind: string; id: string } }>("/api/metadata/:kind/:id/lock", { preHandler: requireAdmin }, async (req, reply) => {
    const kind = kindOf(req.params.kind);
    if (!kind || !meta.unlock(kind, Number(req.params.id))) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });

  app.get<{ Params: { kind: string; id: string } }>("/api/posters/:kind/:id", async (req, reply) => {
    const kind = req.params.kind === "movie" ? "movie" : req.params.kind === "series" ? "series" : null;
    if (!kind) return reply.code(404).send({ error: "not_found" });
    const file = await meta.posterFile(kind, Number(req.params.id));
    if (!file) return reply.code(404).send({ error: "no_poster" });
    return reply.type("image/jpeg").header("Cache-Control", "private, max-age=604800").send(createReadStream(file));
  });
}
