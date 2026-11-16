import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { TorrentError } from "./client.js";
import { QBittorrent, mapState, toTorrentInfo } from "./qbittorrent.js";

const HASH = "c12fe1c06bba254a9dc9f519b335aa7c1367a88a";
const MAGNET = `magnet:?xt=urn:btih:${HASH}&dn=debian`;

/** Campos de un formulario, sea urlencoded o multipart (los archivos se devuelven como texto latin1). */
function fields(contentType: string, body: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  const m = /boundary=(.+)$/.exec(contentType);
  if (!m) { for (const [k, v] of new URLSearchParams(body.toString())) out[k] = v; return out; }
  for (const part of body.toString("latin1").split(`--${m[1]}`)) {
    const h = /name="([^"]+)"/.exec(part);
    if (h) out[h[1]] = part.slice(part.indexOf("\r\n\r\n") + 4).replace(/\r\n$/, "");
  }
  return out;
}

/** qBittorrent simulado. `v5`: cookie QBT_SID_<puerto>, login 204, parar/iniciar. `v4`: cookie SID, «Ok.», pausar/reanudar. */
async function start(version: "v4" | "v5") {
  const calls: { path: string; form: Record<string, string> }[] = [];
  const torrents = new Map<string, any>();
  const categories = new Map<string, { name: string; savePath: string }>();
  let port = 0;
  const cookie = () => (version === "v5" ? `QBT_SID_${port}` : "SID");
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const path = req.url!.replace("/api/v2/", "");
      const form = fields(String(req.headers["content-type"] ?? ""), Buffer.concat(chunks));
      if (path === "auth/login") {
        res.setHeader("set-cookie", `${cookie()}=sesion; HttpOnly; path=/`);
        if (version === "v5") { res.statusCode = 204; return res.end(); }
        return res.end("Ok.");
      }
      if (!new RegExp(`${cookie()}=sesion`).test(req.headers.cookie ?? "")) { res.statusCode = 403; return res.end("Forbidden"); }
      calls.push({ path, form });
      const gone = () => { res.statusCode = 404; res.end("Not Found"); };
      if (path === "app/version") return res.end(version === "v5" ? "v5.0.2" : "v4.6.5");
      if (path === "app/webapiVersion") return res.end(version === "v5" ? "2.11.2" : "2.9.3");
      if (path === "torrents/categories") { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify(Object.fromEntries(categories))); }
      if (path === "torrents/createCategory" || path === "torrents/editCategory") { categories.set(form.category, { name: form.category, savePath: form.savePath.replace(/\\/g, "/") }); return res.end(); }
      if (path.startsWith("sync/maindata")) { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify({ server_state: { free_space_on_disk: 123456789 } })); }
      if (path === "torrents/info") { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify([...torrents.values()])); }
      if (path === "torrents/add") {
        const hash = HASH;
        if (torrents.has(hash)) return res.end("Fails.");
        torrents.set(hash, { hash, name: "debian.iso", state: form.paused === "true" ? "pausedDL" : "downloading", progress: 0.5, size: 1000, downloaded: 500, dlspeed: 10, upspeed: 2, eta: 50, category: form.category ?? "", save_path: "D:\\EnCurso", added_on: 1700000000, completion_on: -1 });
        return res.end("Ok.");
      }
      const t = torrents.get(form.hashes);
      const pause = version === "v5" ? "torrents/stop" : "torrents/pause";
      const resume = version === "v5" ? "torrents/start" : "torrents/resume";
      if (path === pause) { if (t) t.state = "pausedDL"; return res.end(); }
      if (path === resume) { if (t) t.state = "downloading"; return res.end(); }
      if (path === "torrents/stop" || path === "torrents/pause" || path === "torrents/start" || path === "torrents/resume") return gone();
      if (path === "torrents/delete") { torrents.delete(form.hashes); return res.end(); }
      gone();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
  return { server, calls, torrents, categories, url: `http://127.0.0.1:${port}` };
}

for (const version of ["v4", "v5"] as const) {
  test(`qBittorrent ${version}: añadir magnet, listar, pausar, reanudar y quitar`, async () => {
    const { server, url, calls, torrents } = await start(version);
    try {
      const qb = new QBittorrent({ url, username: "a", password: "b" });
      assert.equal(await qb.addMagnet(MAGNET, { category: "nebula-peliculas" }), HASH);
      const add = calls.find((c) => c.path === "torrents/add")!;
      assert.equal(add.form.urls, MAGNET);
      assert.equal(add.form.category, "nebula-peliculas");

      const [t] = await qb.list();
      assert.deepEqual([t.hash, t.name, t.state, t.progress, t.done, t.etaS, t.category, t.speedDown, t.speedUp],
        [HASH, "debian.iso", "downloading", 0.5, false, 50, "nebula-peliculas", 10, 2]);

      await qb.pause(HASH);
      assert.equal((await qb.list())[0].state, "paused");
      await qb.resume(HASH);
      assert.equal((await qb.list())[0].state, "downloading");
      // 4.x usa pausar/reanudar y 5.x parar/iniciar; la versión que no toca daría 404
      assert.ok(calls.some((c) => c.path === (version === "v5" ? "torrents/stop" : "torrents/pause")));

      await qb.remove(HASH, true);
      assert.equal(torrents.size, 0);
      assert.equal(calls.find((c) => c.path === "torrents/delete")!.form.deleteFiles, "true");
    } finally { server.close(); }
  });
}

test("añadir un torrent repetido o un hash mal formado se rechaza con un error claro", async () => {
  const { server, url } = await start("v5");
  try {
    const qb = new QBittorrent({ url, username: "a", password: "b" });
    await qb.addMagnet(MAGNET);
    await assert.rejects(() => qb.addMagnet(MAGNET), (e) => e instanceof TorrentError && e.code === "rejected");
    await assert.rejects(() => qb.addMagnet("http://x/a.torrent"), (e) => e instanceof TorrentError && e.code === "invalid_magnet");
    await assert.rejects(() => qb.pause("../../etc"), (e) => e instanceof TorrentError && e.code === "rejected");
    await assert.rejects(() => qb.remove("a b", true), (e) => e instanceof TorrentError && e.code === "rejected");
  } finally { server.close(); }
});

test("subir un .torrent calcula su hash y lo envía como archivo", async () => {
  const { server, url, calls } = await start("v5");
  try {
    const qb = new QBittorrent({ url, username: "a", password: "b" });
    const info = "d6:lengthi1048576e4:name8:film.mkv12:piece lengthi262144e6:pieces20:AAAAAAAAAAAAAAAAAAAAe";
    const file = Buffer.from(`d8:announce3:abc4:info${info}e`, "latin1");
    const hash = await qb.addFile(file, { category: "nebula-series", paused: true });
    assert.match(hash, /^[0-9a-f]{40}$/);
    const add = calls.find((c) => c.path === "torrents/add")!;
    assert.ok(add.form.torrents.includes("film.mkv"));
    assert.equal(add.form.category, "nebula-series");
    assert.equal(add.form.paused, "true");
    assert.equal(add.form.stopped, "true");
    await assert.rejects(() => qb.addFile(Buffer.from("basura que no es un torrent"), {}), (e) => e instanceof TorrentError && e.code === "invalid_torrent");
  } finally { server.close(); }
});

test("check(): versión y errores traducidos", async () => {
  const { server, url } = await start("v5");
  try {
    const ok = await new QBittorrent({ url, username: "a", password: "b" }).check();
    assert.deepEqual([ok.ok, ok.version], [true, "v5.0.2 (API 2.11.2)"]);
  } finally { server.close(); }
  const down = await new QBittorrent({ url: "http://127.0.0.1:1", username: "a", password: "b", timeoutMs: 500 }).check();
  assert.deepEqual([down.ok, down.error], [false, "unreachable"]);
});

test("estados de qBittorrent → estados de Nebula, y datos de torrent normalizados", () => {
  const cases: Record<string, string> = {
    downloading: "downloading", metaDL: "downloading", forcedDL: "downloading", stalledDL: "stalled",
    queuedDL: "queued", queuedUP: "queued", checkingDL: "checking", checkingUP: "checking", allocating: "checking",
    pausedDL: "paused", stoppedUP: "paused", uploading: "seeding", stalledUP: "seeding", forcedUP: "seeding",
    moving: "moving", error: "error", missingFiles: "error", loQueSea: "unknown",
  };
  for (const [from, to] of Object.entries(cases)) assert.equal(mapState(from), to, from);
  const t = toTorrentInfo({ hash: HASH.toUpperCase(), name: "x", state: "stalledUP", progress: 1, size: 10, dlspeed: 0, eta: 8640000, category: "c", save_path: "p", completion_on: 1700000000 });
  assert.deepEqual([t.hash, t.done, t.etaS, t.completedAt, t.downloadedBytes], [HASH, true, null, 1700000000000, 10]);
});

test("ensureCategory: crea la categoría, no toca la que ya está bien y corrige la que apunta a otra carpeta", async () => {
  const { server, url, calls, categories } = await start("v5");
  try {
    const qb = new QBittorrent({ url, username: "a", password: "b" });
    await qb.ensureCategory("nebula-peliculas", "D:\\Peliculas");
    assert.equal(categories.get("nebula-peliculas")!.savePath, "D:/Peliculas");
    assert.ok(calls.some((c) => c.path === "torrents/createCategory"));

    calls.length = 0;
    await qb.ensureCategory("nebula-peliculas", "d:\\peliculas\\"); // mismo sitio con otro separador, mayúsculas y barra final
    assert.ok(!calls.some((c) => c.path.endsWith("Category")), "no se vuelve a escribir");

    await qb.ensureCategory("nebula-peliculas", "E:\\Otra");
    assert.equal(categories.get("nebula-peliculas")!.savePath, "E:/Otra");
    assert.ok(calls.some((c) => c.path === "torrents/editCategory"));
  } finally { server.close(); }
});

test("freeSpaceBytes: espacio libre del disco de descargas", async () => {
  const { server, url } = await start("v5");
  try {
    assert.equal(await new QBittorrent({ url, username: "a", password: "b" }).freeSpaceBytes(), 123456789);
  } finally { server.close(); }
});
