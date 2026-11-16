import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import { Prowlarr, SearchError } from "./search.js";

const H1 = "a1".repeat(20);
const H2 = "b2".repeat(20);
let seen: { url: string; key: string | undefined }[] = [];

async function fake(handler: (url: URL, res: import("node:http").ServerResponse) => void) {
  seen = [];
  const srv: Server = createServer((req, res) => {
    seen.push({ url: req.url ?? "", key: req.headers["x-api-key"] as string | undefined });
    handler(new URL(req.url ?? "/", "http://x"), res);
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const port = (srv.address() as { port: number }).port;
  return { srv, url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => srv.close(() => r())) };
}
const json = (res: import("node:http").ServerResponse, body: unknown, code = 200) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };

test("busca, filtra, ordena por seeders y quita duplicados", async () => {
  const f = await fake((u, res) => json(res, [
    { guid: "g1", title: "Debian 12 netinst", size: 600e6, seeders: 5, leechers: 1, indexer: "A", infoHash: H1, protocol: "torrent", publishDate: "2024-01-02T00:00:00Z", infoUrl: "https://x.test/1" },
    { guid: "g2", title: "Debian 12 netinst (mejor)", size: 600e6, seeders: 50, indexer: "B", infoHash: H1.toUpperCase(), protocol: "torrent" },
    { guid: "g3", title: "Ubuntu", size: 3e9, seeders: 20, indexer: "A", magnetUrl: `magnet:?xt=urn:btih:${H2}&dn=Ubuntu`, protocol: "torrent", infoUrl: "javascript:alert(1)" },
    { guid: "g4", title: "Usenet", size: 1, seeders: 99, protocol: "usenet", downloadUrl: "http://x/y" },
    { guid: "g5", title: "Sin nada", size: 1, seeders: 9, protocol: "torrent" },
    { title: 5 },
  ]));
  try {
    const p = new Prowlarr({ url: f.url, apiKey: "k3y" });
    const r = await p.search("debian", "movies");
    assert.deepEqual(r.map((x) => [x.title, x.seeders, x.hash]), [["Debian 12 netinst (mejor)", 50, H1], ["Ubuntu", 20, H2]]);
    assert.equal(r[1].infoUrl, null, "javascript: no se admite");
    assert.equal(r[0].publishedAt, null);
    assert.match(seen[0].url, /^\/api\/v1\/search\?query=debian&type=search&limit=60&indexerIds=-2&categories=2000$/);
    assert.equal(seen[0].key, "k3y");
  } finally { await f.close(); }
});

test("resolve: magnet, hash y .torrent solo del propio Prowlarr", async () => {
  const torrent = Buffer.from("d4:infod6:lengthi1e4:name1:x12:piece lengthi1e6:pieces20:AAAAAAAAAAAAAAAAAAAAee");
  let origin = "";
  const f = await fake((u, res) => {
    if (u.pathname === "/api/v1/search") return json(res, [
      { guid: "m", title: "Con magnet", seeders: 3, magnetUrl: `magnet:?xt=urn:btih:${H1}&dn=Con`, protocol: "torrent" },
      { guid: "h", title: "Solo hash & raro", seeders: 2, infoHash: H2, protocol: "torrent" },
      { guid: "d", title: "Descarga", seeders: 1, downloadUrl: `${origin}/1/download?file=x`, protocol: "torrent" },
      { guid: "r", title: "Redirige", seeders: 1, downloadUrl: `${origin}/2/download`, protocol: "torrent" },
      { guid: "e", title: "Ajeno", seeders: 1, downloadUrl: "http://169.254.169.254/latest", protocol: "torrent" },
      { guid: "z", title: "Enorme", seeders: 1, downloadUrl: `${origin}/3/download`, protocol: "torrent" },
    ]);
    if (u.pathname === "/1/download") { res.writeHead(200, { "content-type": "application/x-bittorrent" }); return void res.end(torrent); }
    if (u.pathname === "/2/download") { res.writeHead(301, { location: `magnet:?xt=urn:btih:${"c3".repeat(20)}&dn=R` }); return void res.end(); }
    if (u.pathname === "/3/download") { res.writeHead(200, { "content-length": String(5 * 1024 * 1024) }); return void res.end(Buffer.alloc(5 * 1024 * 1024)); }
    res.writeHead(404); res.end();
  });
  origin = f.url;
  try {
    const p = new Prowlarr({ url: f.url, apiKey: "k" });
    const r = await p.search("x");
    const by = (t: string) => r.find((x) => x.title === t)!.id;
    assert.deepEqual(await p.resolve(by("Con magnet")), { magnet: `magnet:?xt=urn:btih:${H1}&dn=Con` });
    const h = await p.resolve(by("Solo hash & raro"));
    assert.equal(h.magnet, `magnet:?xt=urn:btih:${H2}&dn=Solo%20hash%20%26%20raro`);
    const d = await p.resolve(by("Descarga"));
    assert.ok(d.file && d.file.equals(torrent));
    assert.equal((await p.resolve(by("Redirige"))).magnet, `magnet:?xt=urn:btih:${"c3".repeat(20)}&dn=R`);
    await assert.rejects(p.resolve(by("Ajeno")), (e: SearchError) => e.code === "bad_source");
    assert.ok(!seen.some((s) => s.url.includes("169.254")), "no se pidió nada fuera de Prowlarr");
    await assert.rejects(p.resolve(by("Enorme")), (e: SearchError) => e.code === "fetch_failed");
    await assert.rejects(p.resolve("noexiste"), (e: SearchError) => e.code === "not_found");
  } finally { await f.close(); }
});

test("errores: clave mala, caído y respuesta rara", async () => {
  const bad = await fake((_u, res) => json(res, { error: "Unauthorized" }, 401));
  try {
    const p = new Prowlarr({ url: bad.url, apiKey: "mala" });
    await assert.rejects(p.search("x"), (e: SearchError) => e.code === "auth");
    assert.deepEqual(await p.check(), { ok: false, error: "auth", message: "API key rechazada" });
  } finally { await bad.close(); }
  const weird = await fake((_u, res) => json(res, { no: "array" }));
  try { await assert.rejects(new Prowlarr({ url: weird.url, apiKey: "k" }).search("x"), (e: SearchError) => e.code === "unreachable"); } finally { await weird.close(); }
  const down = new Prowlarr({ url: "http://127.0.0.1:1", apiKey: "k" });
  const c = await down.check();
  assert.equal(c.ok, false);
  const ok = await fake((_u, res) => json(res, { version: "1.21.2" }));
  try { assert.deepEqual(await new Prowlarr({ url: ok.url, apiKey: "k" }).check(), { ok: true, version: "1.21.2" }); } finally { await ok.close(); }
});
