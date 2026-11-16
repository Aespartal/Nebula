import type { FastifyInstance } from "fastify";
import type { ContinueItem, WatchProgress } from "@nebula/shared";
import type { Db } from "./db/index.js";
import { continueWatching, getProgress, saveProgress, setSeasonWatched, setSeriesWatched, setWatched } from "./progress.js";

const body = {
  type: "object", required: ["positionS"], additionalProperties: false,
  properties: { positionS: { type: "number", minimum: 0, maximum: 1e7 }, durationS: { type: ["number", "null"], minimum: 0, maximum: 1e7 } },
} as const;

export function registerProgressRoutes(app: FastifyInstance, db: Db) {
  app.get("/api/continue", async (req): Promise<ContinueItem[]> => continueWatching(db, req.user!.id));

  app.get<{ Params: { id: string } }>("/api/progress/:id", async (req): Promise<WatchProgress> =>
    getProgress(db, req.user!.id, Number(req.params.id)));

  // PUT para el uso normal y POST porque `navigator.sendBeacon` solo sabe enviar POST al cerrar la pestaña.
  const save = async (req: any, reply: any) => {
    const r = saveProgress(db, req.user.id, Number(req.params.id), req.body.positionS, req.body.durationS);
    return r ?? reply.code(404).send({ error: "not_found" });
  };
  app.put<{ Params: { id: string }; Body: { positionS: number; durationS?: number | null } }>("/api/progress/:id", { schema: { body } }, save);
  app.post<{ Params: { id: string }; Body: { positionS: number; durationS?: number | null } }>("/api/progress/:id", { schema: { body } }, save);

  const watchedBody = { type: "object", required: ["watched"], properties: { watched: { type: "boolean" } } } as const;

  app.post<{ Params: { id: string }; Body: { watched: boolean } }>(
    "/api/progress/:id/watched", { schema: { body: watchedBody } },
    async (req, reply) => setWatched(db, req.user!.id, Number(req.params.id), req.body.watched) ?? reply.code(404).send({ error: "not_found" }),
  );

  app.post<{ Params: { id: string }; Body: { watched: boolean } }>(
    "/api/seasons/:id/watched", { schema: { body: watchedBody } },
    async (req, reply) => {
      if (!db.prepare("SELECT 1 FROM seasons WHERE id=?").get(Number(req.params.id))) return reply.code(404).send({ error: "not_found" });
      return { updated: setSeasonWatched(db, req.user!.id, Number(req.params.id), req.body.watched) };
    },
  );

  app.post<{ Params: { id: string }; Body: { watched: boolean } }>(
    "/api/series/:id/watched", { schema: { body: watchedBody } },
    async (req, reply) => {
      if (!db.prepare("SELECT 1 FROM series WHERE id=?").get(Number(req.params.id))) return reply.code(404).send({ error: "not_found" });
      return { updated: setSeriesWatched(db, req.user!.id, Number(req.params.id), req.body.watched) };
    },
  );
}
