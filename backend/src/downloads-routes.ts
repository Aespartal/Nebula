import type { FastifyInstance, FastifyReply } from "fastify";
import type { DownloadItem, DownloadKind, DownloadsStatus } from "@nebula/shared";
import { requireAdmin } from "./auth/plugin.js";
import type { Db } from "./db/index.js";
import { TorrentError, type TorrentClient, type TorrentInfo } from "./torrents/client.js";
import type { TorrentService } from "./torrents/service.js";
import { magnetHash, torrentHash, torrentSize } from "./torrents/torrent-meta.js";

/** Categorías de qBittorrent: su carpeta final es la de la biblioteca del mismo tipo. */
export const CATEGORY: Record<DownloadKind, string> = { movies: "nebula-peliculas", series: "nebula-series" };
export const MAX_TORRENT_BYTES = 1024 * 1024;

export interface DownloadDeps {
  /** null = sin TORRENT_USER/TORRENT_PASS en el .env. */
  client: TorrentClient | null;
  service: TorrentService | null;
  minFreeBytes: number;
  /** Pide un escaneo de la biblioteca (tras quitar archivos o al completarse algo). */
  rescan?: (libraryId: number | null) => void;
}

interface Row { hash: string; name: string; kind: DownloadKind; added_at: number; completed_at: number | null; library_id: number | null; added_by_name: string | null }

const HASH = /^[0-9a-f]{40}$/i;

export function registerDownloadRoutes(app: FastifyInstance, db: Db, deps: DownloadDeps) {
  const guard = { preHandler: requireAdmin };
  const notConfigured = (reply: FastifyReply) => reply.code(503).send({ error: "not_configured" });
  const unreachable = (reply: FastifyReply, e: unknown) => reply.code(502).send({ error: "client_unreachable", message: (e as Error).message });

  const rows = () => db.prepare(`
    SELECT d.hash, d.name, d.kind, d.added_at, d.completed_at, d.library_id, u.username AS added_by_name
    FROM downloads d LEFT JOIN users u ON u.id = d.added_by ORDER BY d.added_at DESC`).all() as Row[];
  const managed = (hash: string) => db.prepare("SELECT hash FROM downloads WHERE hash=?").get(hash.toLowerCase()) as { hash: string } | undefined;

  app.get("/api/downloads/status", guard, async (): Promise<DownloadsStatus> => {
    const base = { minFreeBytes: deps.minFreeBytes };
    if (!deps.client) return { configured: false, connected: false, freeBytes: null, ...base };
    const c = await deps.client.check();
    if (!c.ok) return { configured: true, connected: false, error: c.error, message: c.message, freeBytes: null, ...base };
    const freeBytes = await deps.client.freeSpaceBytes().catch(() => null);
    return { configured: true, connected: true, version: c.version, freeBytes, ...base };
  });

  app.get("/api/downloads", guard, async (_req, reply): Promise<DownloadItem[] | void> => {
    if (!deps.client || !deps.service) return notConfigured(reply);
    const live = new Map(deps.service.snapshot().torrents.map((t) => [t.hash, t]));
    // Solo se muestran los que Nebula añadió: el resto de lo que haya en qBittorrent no es cosa de Nebula.
    return rows().map((r) => {
      const t = live.get(r.hash);
      const common = { hash: r.hash, kind: r.kind, addedBy: r.added_by_name, addedAt: r.added_at, completedAt: r.completed_at };
      if (!t) return { ...common, name: r.name, state: "missing", progress: 0, done: r.completed_at !== null, sizeBytes: 0, downloadedBytes: 0, speedDown: 0, speedUp: 0, etaS: null } as DownloadItem;
      return { ...common, name: t.name, state: t.state, progress: t.progress, done: t.done, sizeBytes: t.sizeBytes, downloadedBytes: t.downloadedBytes, speedDown: t.speedDown, speedUp: t.speedUp, etaS: t.etaS };
    });
  });

  app.post<{ Body: { magnet?: string; torrentBase64?: string; kind: DownloadKind } }>(
    "/api/downloads",
    {
      preHandler: requireAdmin,
      // 1 MB de .torrent en base64 ocupa ~1,4 MB; el límite del cuerpo deja margen y el real se comprueba al decodificar.
      bodyLimit: 2 * 1024 * 1024,
      schema: {
        body: {
          type: "object",
          required: ["kind"],
          additionalProperties: false,
          properties: {
            kind: { enum: ["movies", "series"] },
            magnet: { type: "string", maxLength: 4096 },
            torrentBase64: { type: "string", maxLength: 1_500_000 },
          },
        },
      },
    },
    async (req, reply) => {
      const { client, service } = deps;
      if (!client || !service) return notConfigured(reply);
      const { magnet, torrentBase64, kind } = req.body;
      if (!!magnet === !!torrentBase64) return reply.code(400).send({ error: "magnet_or_torrent" });

      // 1) Validar lo que llega, sin tocar nada todavía.
      let hash: string;
      let file: Buffer | undefined;
      let neededBytes = deps.minFreeBytes;
      try {
        if (magnet) hash = magnetHash(magnet);
        else {
          file = Buffer.from(torrentBase64!, "base64");
          if (file.length > MAX_TORRENT_BYTES) return reply.code(413).send({ error: "torrent_too_large" });
          hash = torrentHash(file);
          neededBytes += torrentSize(file) ?? 0;
        }
      } catch (e) {
        if (e instanceof TorrentError) return reply.code(400).send({ error: e.code });
        throw e;
      }

      if (managed(hash) || service.snapshot().torrents.some((t) => t.hash === hash)) return reply.code(409).send({ error: "already_added" });

      // 2) La biblioteca de destino: su carpeta es donde el cliente dejará el vídeo al terminar.
      const lib = db.prepare("SELECT id, root_path FROM libraries WHERE type=? ORDER BY id LIMIT 1").get(kind) as { id: number; root_path: string } | undefined;
      if (!lib) return reply.code(409).send({ error: "no_library" });

      try {
        // 3) Espacio libre.
        const free = await client.freeSpaceBytes();
        if (free !== null && free < neededBytes) return reply.code(507).send({ error: "not_enough_space", freeBytes: free, neededBytes });

        // 4) Categoría con la carpeta final y alta del torrent.
        await client.ensureCategory(CATEGORY[kind], lib.root_path);
        const opts = { category: CATEGORY[kind] };
        if (file) await client.addFile(file, opts); else await client.addMagnet(magnet!, opts);
      } catch (e) {
        if (e instanceof TorrentError) return reply.code(e.code === "rejected" ? 409 : 400).send({ error: e.code === "rejected" ? "already_added" : e.code });
        return unreachable(reply, e);
      }

      db.prepare("INSERT INTO downloads(hash,name,kind,added_by,added_at,library_id) VALUES(?,?,?,?,?,?)")
        .run(hash, (magnet ? new URL(magnet.trim()).searchParams.get("dn") || hash : hash).slice(0, 300), kind, req.user?.id ?? null, Date.now(), lib.id);
      await service.refresh();
      const row = rows().find((r) => r.hash === hash)!;
      return reply.code(201).send({ hash, kind, name: row.name });
    },
  );

  const control = (action: "pause" | "resume") =>
    app.post<{ Params: { hash: string } }>(`/api/downloads/:hash/${action}`, guard, async (req, reply) => {
      const { client, service } = deps;
      if (!client || !service) return notConfigured(reply);
      if (!HASH.test(req.params.hash) || !managed(req.params.hash)) return reply.code(404).send({ error: "not_found" });
      try { await client[action](req.params.hash.toLowerCase()); } catch (e) { return unreachable(reply, e); }
      await service.refresh();
      return { ok: true };
    });
  control("pause");
  control("resume");

  app.delete<{ Params: { hash: string }; Querystring: { files?: string } }>(
    "/api/downloads/:hash",
    { preHandler: requireAdmin, schema: { querystring: { type: "object", properties: { files: { enum: ["0", "1"] } } } } },
    async (req, reply) => {
      const { client, service } = deps;
      if (!client || !service) return notConfigured(reply);
      const hash = req.params.hash.toLowerCase();
      const row = HASH.test(hash) ? (db.prepare("SELECT library_id FROM downloads WHERE hash=?").get(hash) as { library_id: number | null } | undefined) : undefined;
      if (!row) return reply.code(404).send({ error: "not_found" });
      const withFiles = req.query.files === "1";
      try {
        // Si ya no está en el cliente (lo quitaron a mano), basta con olvidarlo aquí; con archivos no hay nada que borrar.
        if (service.snapshot().torrents.some((t) => t.hash === hash)) await client.remove(hash, withFiles);
      } catch (e) { return unreachable(reply, e); }
      db.prepare("DELETE FROM downloads WHERE hash=?").run(hash);
      await service.refresh();
      // Si el vídeo ya estaba en la biblioteca y se ha borrado, desaparece del catálogo en el siguiente escaneo.
      if (withFiles) deps.rescan?.(row.library_id);
      return reply.code(204).send();
    },
  );
}

/** Tras terminar una descarga: se anota cuándo y se pide el escaneo de su biblioteca. */
export function completionHandlers(db: Db, rescan: (libraryId: number | null) => void) {
  const pending = db.prepare("SELECT hash FROM downloads WHERE completed_at IS NULL");
  return {
    // Solo interesan los que Nebula añadió y aún no se habían marcado como terminados (incluye los que acabaron con Nebula apagado).
    shouldNotify: (t: TorrentInfo) => (pending.all() as { hash: string }[]).some((r) => r.hash === t.hash),
    onCompleted: (t: TorrentInfo) => {
      const row = db.prepare("SELECT library_id FROM downloads WHERE hash=?").get(t.hash) as { library_id: number | null } | undefined;
      db.prepare("UPDATE downloads SET completed_at=?, name=? WHERE hash=?").run(Date.now(), t.name, t.hash);
      rescan(row?.library_id ?? null);
    },
  };
}
