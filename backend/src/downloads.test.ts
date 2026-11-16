import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerAuth } from "./auth/plugin.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { openDb } from "./db/index.js";
import { completionHandlers, registerDownloadRoutes } from "./downloads-routes.js";
import { TorrentError, type TorrentClient, type TorrentInfo } from "./torrents/client.js";
import { SearchError } from "./torrents/search.js";
import { TorrentService } from "./torrents/service.js";

const HASH = "c12fe1c06bba254a9dc9f519b335aa7c1367a88a";
const MAGNET = `magnet:?xt=urn:btih:${HASH}&dn=Debian%20netinst`;
const GB = 1024 ** 3;

class Fake implements TorrentClient {
  torrents: TorrentInfo[] = [];
  free: number | null = 100 * GB;
  down = false;
  categories: Record<string, string> = {};
  log: string[] = [];
  private guard() { if (this.down) throw new Error("ECONNREFUSED"); }
  async check() { return this.down ? { ok: false, error: "unreachable" as const, message: "ECONNREFUSED" } : { ok: true, version: "v5.0.2 (API 2.11.2)" }; }
  async list() { this.guard(); return this.torrents.map((t) => ({ ...t })); }
  async freeSpaceBytes() { this.guard(); return this.free; }
  async ensureCategory(name: string, savePath: string) { this.guard(); this.categories[name] = savePath; }
  async addMagnet(uri: string, opts?: { category?: string }) { return this.add(uri.match(/btih:([0-9a-f]{40})/i)![1].toLowerCase(), opts?.category); }
  async addFile(data: Buffer, opts?: { category?: string }) { return this.add("fe".repeat(20), opts?.category); }
  private add(hash: string, category = "") {
    this.guard();
    if (this.torrents.some((t) => t.hash === hash)) throw new TorrentError("rejected", "ya estaba");
    this.torrents.push({ hash, name: "debian.iso", state: "downloading", progress: 0.1, done: false, sizeBytes: 1000, downloadedBytes: 100, speedDown: 50, speedUp: 0, etaS: 60, category, savePath: "D:\\EnCurso", addedAt: null, completedAt: null });
    this.log.push(`add ${hash} ${category}`);
    return hash;
  }
  async pause(h: string) { this.guard(); this.log.push(`pause ${h}`); this.torrents.forEach((t) => { if (t.hash === h) t.state = "paused"; }); }
  async resume(h: string) { this.guard(); this.log.push(`resume ${h}`); this.torrents.forEach((t) => { if (t.hash === h) t.state = "downloading"; }); }
  async remove(h: string, files: boolean) { this.guard(); this.log.push(`remove ${h} files=${files}`); this.torrents = this.torrents.filter((t) => t.hash !== h); }
}

async function build(opts: { configured?: boolean; libraries?: boolean; search?: unknown } = {}) {
  const db = openDb(":memory:");
  if (opts.libraries !== false) db.prepare("INSERT INTO libraries(id,name,type,root_path) VALUES(1,'Pelis','movies','D:\\Peliculas'),(2,'Series','series','D:\\Series')").run();
  const fake = new Fake();
  const rescans: (number | null)[] = [];
  const completed: string[] = [];
  const handlers = completionHandlers(db, (id) => rescans.push(id));
  const service = new TorrentService(fake, { shouldNotify: handlers.shouldNotify, onCompleted: (t) => { handlers.onCompleted(t); completed.push(t.hash); } });
  const app = Fastify();
  await registerAuth(app, db);
  registerAuthRoutes(app, db);
  const configured = opts.configured !== false;
  registerDownloadRoutes(app, db, { client: configured ? fake : null, service: configured ? service : null, minFreeBytes: 5 * GB, rescan: (id) => rescans.push(id), search: (opts.search ?? null) as any });
  await app.ready();
  const r = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { username: "alex", password: "contraseña-larga" } });
  const admin = `nebula_session=${r.cookies[0].value}`;
  await app.inject({ method: "POST", url: "/api/users", headers: { cookie: admin }, payload: { username: "mia", password: "clave-de-mia-1" } });
  const l = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "mia", password: "clave-de-mia-1" } });
  const user = `nebula_session=${l.cookies[0].value}`;
  const req = (method: string, url: string, cookie = admin, payload?: unknown) => app.inject({ method: method as any, url, headers: { cookie }, payload: payload as any });
  return { app, db, fake, service, admin, user, req, rescans, completed };
}

/** .torrent mínimo: un archivo de 2 GiB. */
function torrentFile(length = 2 * GB) {
  const info = `d6:lengthi${length}e4:name8:film.mkv12:piece lengthi262144e6:pieces20:AAAAAAAAAAAAAAAAAAAAe`;
  return Buffer.from(`d8:announce3:abc4:info${info}e`, "latin1");
}

test("descargas: solo administradores", async () => {
  const { app, user, req } = await build();
  try {
    for (const [m, u, body] of [
      ["GET", "/api/downloads"], ["GET", "/api/downloads/status"], ["POST", "/api/downloads", { magnet: MAGNET, kind: "movies" }],
      ["POST", `/api/downloads/${HASH}/pause`], ["POST", `/api/downloads/${HASH}/resume`], ["DELETE", `/api/downloads/${HASH}`],
    ] as const) assert.equal((await req(m, u, user, body)).statusCode, 403, `${m} ${u}`);
    assert.equal((await app.inject({ method: "GET", url: "/api/downloads" })).statusCode, 401);
  } finally { await app.close(); }
});

test("sin TORRENT_USER/TORRENT_PASS: el estado lo dice y las acciones responden «no configurado»", async () => {
  const { app, req } = await build({ configured: false });
  try {
    const st = (await req("GET", "/api/downloads/status")).json();
    assert.deepEqual([st.configured, st.connected], [false, false]);
    assert.equal((await req("GET", "/api/downloads")).statusCode, 503);
    const add = await req("POST", "/api/downloads", undefined, { magnet: MAGNET, kind: "movies" });
    assert.deepEqual([add.statusCode, add.json().error], [503, "not_configured"]);
  } finally { await app.close(); }
});

test("estado: versión y espacio libre, o por qué no conecta", async () => {
  const { app, fake, req } = await build();
  try {
    const ok = (await req("GET", "/api/downloads/status")).json();
    assert.deepEqual([ok.configured, ok.connected, ok.version, ok.freeBytes, ok.minFreeBytes], [true, true, "v5.0.2 (API 2.11.2)", 100 * GB, 5 * GB]);
    fake.down = true;
    const bad = (await req("GET", "/api/downloads/status")).json();
    assert.deepEqual([bad.connected, bad.error], [false, "unreachable"]);
  } finally { await app.close(); }
});

test("añadir un magnet: crea la categoría con la carpeta de la biblioteca y lo registra con quién lo añadió", async () => {
  const { app, fake, req, db } = await build();
  try {
    const r = await req("POST", "/api/downloads", undefined, { magnet: MAGNET, kind: "series" });
    assert.equal(r.statusCode, 201);
    assert.deepEqual(r.json(), { hash: HASH, kind: "series", name: "Debian netinst" });
    assert.deepEqual(fake.categories, { "nebula-series": "D:\\Series" });
    assert.deepEqual(fake.log, [`add ${HASH} nebula-series`]);
    const row = db.prepare("SELECT d.kind, d.library_id, u.username FROM downloads d JOIN users u ON u.id = d.added_by").get() as any;
    assert.deepEqual([row.kind, row.library_id, row.username], ["series", 2, "alex"]);
    const list = (await req("GET", "/api/downloads")).json();
    assert.deepEqual([list.length, list[0].name, list[0].state, list[0].addedBy, list[0].kind], [1, "debian.iso", "downloading", "alex", "series"]);
  } finally { await app.close(); }
});

test("validación: magnet inválido, URL http, ni magnet ni torrent, o los dos", async () => {
  const { app, fake, req } = await build();
  try {
    const bad = async (payload: unknown, status: number, error?: string) => {
      const r = await req("POST", "/api/downloads", undefined, payload);
      assert.equal(r.statusCode, status, JSON.stringify(payload).slice(0, 80));
      if (error) assert.equal(r.json().error, error);
    };
    await bad({ magnet: "http://ejemplo.com/a.torrent", kind: "movies" }, 400, "invalid_magnet");
    await bad({ magnet: "https://ejemplo.com/?xt=urn:btih:" + HASH, kind: "movies" }, 400, "invalid_magnet");
    await bad({ magnet: "magnet:?xt=urn:btih:corto", kind: "movies" }, 400, "invalid_magnet");
    await bad({ kind: "movies" }, 400, "magnet_or_torrent");
    await bad({ magnet: MAGNET, torrentBase64: torrentFile().toString("base64"), kind: "movies" }, 400, "magnet_or_torrent");
    await bad({ magnet: MAGNET, kind: "documentales" }, 400);
    await bad({ magnet: MAGNET }, 400);
    assert.deepEqual(fake.log, [], "nada llegó al cliente");
  } finally { await app.close(); }
});

test(".torrent: se acepta, y se rechazan el que pesa más de 1 MB y el que no es un torrent", async () => {
  const { app, fake, req } = await build();
  try {
    const ok = await req("POST", "/api/downloads", undefined, { torrentBase64: torrentFile().toString("base64"), kind: "movies" });
    assert.equal(ok.statusCode, 201);
    assert.equal(fake.log.length, 1);

    const big = Buffer.concat([torrentFile(), Buffer.alloc(1024 * 1024)]);
    const tooBig = await req("POST", "/api/downloads", undefined, { torrentBase64: big.toString("base64"), kind: "movies" });
    assert.deepEqual([tooBig.statusCode, tooBig.json().error], [413, "torrent_too_large"]);

    const junk = await req("POST", "/api/downloads", undefined, { torrentBase64: Buffer.from("esto no es un torrent de verdad").toString("base64"), kind: "movies" });
    assert.deepEqual([junk.statusCode, junk.json().error], [400, "invalid_torrent"]);

    const huge = await req("POST", "/api/downloads", undefined, { torrentBase64: "A".repeat(2_000_000), kind: "movies" });
    assert.ok([400, 413].includes(huge.statusCode), "un cuerpo enorme se corta antes de procesarlo");
    assert.equal(fake.log.length, 1);
  } finally { await app.close(); }
});

test("duplicado: el mismo hash no se añade dos veces", async () => {
  const { app, req } = await build();
  try {
    assert.equal((await req("POST", "/api/downloads", undefined, { magnet: MAGNET, kind: "movies" })).statusCode, 201);
    const again = await req("POST", "/api/downloads", undefined, { magnet: MAGNET.replace(HASH, HASH.toUpperCase()), kind: "movies" });
    assert.deepEqual([again.statusCode, again.json().error], [409, "already_added"]);
  } finally { await app.close(); }
});

test("sin biblioteca del tipo pedido no se añade nada", async () => {
  const { app, fake, req } = await build({ libraries: false });
  try {
    const r = await req("POST", "/api/downloads", undefined, { magnet: MAGNET, kind: "movies" });
    assert.deepEqual([r.statusCode, r.json().error], [409, "no_library"]);
    assert.equal(fake.log.length, 0);
  } finally { await app.close(); }
});

test("espacio: exige el margen libre más lo que pesa el .torrent", async () => {
  const { app, fake, req } = await build();
  try {
    fake.free = 6 * GB; // el margen son 5 GB: el magnet cabe, pero el torrent de 2 GiB no
    assert.equal((await req("POST", "/api/downloads", undefined, { magnet: MAGNET, kind: "movies" })).statusCode, 201);
    const r = await req("POST", "/api/downloads", undefined, { torrentBase64: torrentFile().toString("base64"), kind: "movies" });
    assert.equal(r.statusCode, 507);
    assert.deepEqual([r.json().error, r.json().freeBytes, r.json().neededBytes], ["not_enough_space", 6 * GB, 7 * GB]);
    fake.free = null; // si el cliente no informa del espacio, no se bloquea
    assert.equal((await req("POST", "/api/downloads", undefined, { torrentBase64: torrentFile().toString("base64"), kind: "movies" })).statusCode, 201);
  } finally { await app.close(); }
});

test("cliente apagado al añadir: error claro y nada queda registrado", async () => {
  const { app, fake, req, db } = await build();
  try {
    fake.down = true;
    const r = await req("POST", "/api/downloads", undefined, { magnet: MAGNET, kind: "movies" });
    assert.deepEqual([r.statusCode, r.json().error], [502, "client_unreachable"]);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM downloads").get() as any).n, 0);
  } finally { await app.close(); }
});

test("pausar, reanudar y quitar solo funcionan con lo que Nebula añadió", async () => {
  const { app, fake, req, db, rescans } = await build();
  try {
    const foreign = "ab".repeat(20);
    await fake.addMagnet(`magnet:?xt=urn:btih:${foreign}`, {}); // un torrent que tenías en qBittorrent y no es de Nebula
    fake.log.length = 0;
    for (const [m, u] of [["POST", `/api/downloads/${foreign}/pause`], ["POST", `/api/downloads/${foreign}/resume`], ["DELETE", `/api/downloads/${foreign}`]] as const)
      assert.equal((await req(m, u)).statusCode, 404, `${m} ${u}: no es de Nebula`);
    assert.equal((await req("POST", "/api/downloads/no-es-un-hash/pause")).statusCode, 404);
    assert.equal(fake.log.length, 0);
    assert.deepEqual((await req("GET", "/api/downloads")).json(), [], "lo ajeno ni se lista");

    await req("POST", "/api/downloads", undefined, { magnet: MAGNET, kind: "movies" });
    assert.equal((await req("POST", `/api/downloads/${HASH.toUpperCase()}/pause`)).statusCode, 200);
    assert.equal((await req("GET", "/api/downloads")).json()[0].state, "paused");
    assert.equal((await req("POST", `/api/downloads/${HASH}/resume`)).statusCode, 200);
    assert.equal((await req("GET", "/api/downloads")).json()[0].state, "downloading");

    // Quitar de la lista: no borra archivos ni pide escaneo
    assert.equal((await req("DELETE", `/api/downloads/${HASH}`)).statusCode, 204);
    assert.ok(fake.log.includes(`remove ${HASH} files=false`));
    assert.deepEqual(rescans, []);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM downloads").get() as any).n, 0);
    assert.ok(fake.torrents.some((t) => t.hash === foreign), "lo ajeno sigue intacto");
  } finally { await app.close(); }
});

test("borrar todo: quita el torrent con sus archivos y pide el escaneo de su biblioteca", async () => {
  const { app, fake, req, rescans } = await build();
  try {
    await req("POST", "/api/downloads", undefined, { magnet: MAGNET, kind: "series" });
    assert.equal((await req("DELETE", `/api/downloads/${HASH}?files=1`)).statusCode, 204);
    assert.ok(fake.log.includes(`remove ${HASH} files=true`));
    assert.deepEqual(rescans, [2]);
    assert.equal((await req("DELETE", `/api/downloads/${HASH}?files=2`)).statusCode, 400);
  } finally { await app.close(); }
});

test("si el cliente está apagado no se olvida el torrent (se podrá quitar cuando vuelva)", async () => {
  const { app, fake, req, db } = await build();
  try {
    await req("POST", "/api/downloads", undefined, { magnet: MAGNET, kind: "movies" });
    fake.down = true;
    assert.equal((await req("DELETE", `/api/downloads/${HASH}?files=1`)).statusCode, 502);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM downloads").get() as any).n, 1);
  } finally { await app.close(); }
});

test("un torrent quitado a mano en el cliente aparece como «missing» y se puede olvidar", async () => {
  const { app, fake, service, req } = await build();
  try {
    await req("POST", "/api/downloads", undefined, { magnet: MAGNET, kind: "movies" });
    fake.torrents = [];
    await service.refresh();
    const item = (await req("GET", "/api/downloads")).json()[0];
    assert.deepEqual([item.state, item.name], ["missing", "Debian netinst"]);
    assert.equal((await req("DELETE", `/api/downloads/${HASH}?files=1`)).statusCode, 204);
    assert.deepEqual((await req("GET", "/api/downloads")).json(), []);
  } finally { await app.close(); }
});

test("al terminar: se anota la fecha, se pide el escaneo y solo ocurre una vez (también si terminó con Nebula apagado)", async () => {
  const { app, fake, service, req, db, rescans, completed } = await build();
  try {
    await req("POST", "/api/downloads", undefined, { magnet: MAGNET, kind: "movies" });
    // Terminó mientras Nebula estaba apagado: el primer sondeo ya lo ve terminado, y aun así hay que avisar.
    fake.torrents[0] = { ...fake.torrents[0], state: "seeding", progress: 1, done: true, name: "Debian 12 netinst.iso" };
    await service.refresh(); await service.refresh(); await service.refresh();
    assert.deepEqual(completed, [HASH]);
    assert.deepEqual(rescans, [1]);
    const row = db.prepare("SELECT completed_at, name FROM downloads").get() as any;
    assert.ok(row.completed_at > 0);
    assert.equal(row.name, "Debian 12 netinst.iso");
    assert.ok((await req("GET", "/api/downloads")).json()[0].completedAt > 0);
  } finally { await app.close(); }
});

function stubSearch() {
  const calls: string[] = [];
  const hit = { id: "r1", title: "Debian 12", sizeBytes: 600e6, seeders: 9, leechers: 1, indexer: "A", publishedAt: null, infoUrl: null, hash: HASH };
  return {
    calls,
    async search(q: string, kind?: string) { calls.push(`search ${q} ${kind ?? ""}`); if (q === "caido") throw new SearchError("unreachable", "ECONNREFUSED"); return [hit, { ...hit, id: "r2", title: "Otro", hash: "ab".repeat(20) }]; },
    async resolve(id: string) {
      calls.push(`resolve ${id}`);
      if (id === "r1") return { magnet: MAGNET };
      if (id === "file") return { file: torrentFile(1000) };
      throw new SearchError("not_found", "ya no está");
    },
  };
}

test("buscador: solo administradores y sin configurar → 503", async () => {
  const none = await build();
  try {
    assert.equal((await none.req("GET", "/api/downloads/search?q=debian")).statusCode, 503);
    assert.equal((await none.req("POST", "/api/downloads/search/add", none.admin, { id: "r1", kind: "movies" })).statusCode, 503);
    assert.equal(((await none.req("GET", "/api/downloads/status")).json() as any).searchConfigured, false);
  } finally { await none.app.close(); }
  const { app, user, req } = await build({ search: stubSearch() });
  try {
    assert.equal((await req("GET", "/api/downloads/search?q=debian", user)).statusCode, 403);
    assert.equal((await req("POST", "/api/downloads/search/add", user, { id: "r1", kind: "movies" })).statusCode, 403);
  } finally { await app.close(); }
});

test("buscador: busca, marca lo ya añadido y valida la consulta", async () => {
  const st = stubSearch();
  const { app, req, fake } = await build({ search: st });
  try {
    assert.equal(((await req("GET", "/api/downloads/status")).json() as any).searchConfigured, true);
    assert.equal((await req("GET", "/api/downloads/search?q=a")).statusCode, 400);
    assert.equal((await req("GET", "/api/downloads/search?q=%20%20x%20%20")).statusCode, 400);
    assert.equal((await req("GET", "/api/downloads/search?q=debian&kind=otra")).statusCode, 400);
    let r = await req("GET", "/api/downloads/search?q=debian&kind=movies");
    assert.equal(r.statusCode, 200);
    assert.deepEqual((r.json() as any[]).map((x) => [x.id, x.added]), [["r1", false], ["r2", false]]);
    assert.ok(!("hash" in (r.json() as any[])[0]), "el hash no sale al navegador");
    assert.equal((await req("POST", "/api/downloads/search/add", undefined, { id: "r1", kind: "movies" })).statusCode, 201);
    r = await req("GET", "/api/downloads/search?q=debian");
    assert.deepEqual((r.json() as any[]).map((x) => x.added), [true, false]);
    assert.deepEqual(fake.log, [`add ${HASH} nebula-peliculas`]);
    const caido = await req("GET", "/api/downloads/search?q=caido");
    assert.equal(caido.statusCode, 502);
    assert.equal((caido.json() as any).error, "search_unreachable");
  } finally { await app.close(); }
});

test("buscador: añadir por id usa el mismo flujo (duplicado, espacio, .torrent, id caducado)", async () => {
  const { app, req, fake, db } = await build({ search: stubSearch() });
  try {
    const bad = await req("POST", "/api/downloads/search/add", undefined, { id: "x", kind: "series" });
    assert.equal(bad.statusCode, 404);
    assert.equal((await req("POST", "/api/downloads/search/add", undefined, { id: "r1", kind: "otra" })).statusCode, 400);
    assert.equal((await req("POST", "/api/downloads/search/add", undefined, { id: "r1", kind: "series", url: "http://malo" })).statusCode, 201, "las propiedades extra se descartan, no se usan");
    assert.equal((db.prepare("SELECT kind FROM downloads").get() as any).kind, "series");
    assert.equal((await req("POST", "/api/downloads/search/add", undefined, { id: "r1", kind: "series" })).statusCode, 409);
    fake.free = 1 * GB;
    const full = await req("POST", "/api/downloads/search/add", undefined, { id: "file", kind: "movies" });
    assert.equal(full.statusCode, 507);
    fake.free = 100 * GB;
    assert.equal((await req("POST", "/api/downloads/search/add", undefined, { id: "file", kind: "movies" })).statusCode, 201);
    assert.equal(fake.log.filter((l) => l.startsWith("add")).length, 2);
  } finally { await app.close(); }
});
