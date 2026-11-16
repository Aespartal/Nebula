import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { QBittorrent, QbError } from "./qbittorrent.js";

/** qBittorrent simulado: sesiones por cookie SID, comprobación de Origin/Referer y categorías. */
function mock() {
  const sessions = new Set<string>();
  const cats = new Map<string, { name: string; savePath: string }>();
  let n = 0, failedLogins = 0;
  const state = { loginCalls: 0, badOrigin: 0 };
  const server = http.createServer((req, res) => {
    const host = req.headers.host!;
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = new URLSearchParams(Buffer.concat(chunks).toString());
      const origin = req.headers.origin, referer = req.headers.referer;
      if (origin !== `http://${host}` || !referer?.startsWith(`http://${host}`)) { state.badOrigin++; res.statusCode = 401; return res.end("Unauthorized"); }
      const path = req.url!.replace("/api/v2/", "");
      const json = (o: unknown) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(o)); };
      if (path === "auth/login") {
        state.loginCalls++;
        if (failedLogins >= 3) { res.statusCode = 403; return res.end("Your IP address has been banned"); }
        if (body.get("username") === "alex" && body.get("password") === "secreta") {
          const sid = `sid${++n}`; sessions.add(sid);
          res.setHeader("set-cookie", `SID=${sid}; HttpOnly; path=/`);
          return res.end("Ok.");
        }
        failedLogins++;
        return res.end("Fails.");
      }
      const sid = /SID=([^;]+)/.exec(req.headers.cookie ?? "")?.[1];
      if (!sid || !sessions.has(sid)) { res.statusCode = 403; return res.end("Forbidden"); }
      if (path === "app/version") return res.end("v5.0.2");
      if (path === "app/webapiVersion") return res.end("2.11.2");
      if (path === "app/preferences") return json({ save_path: "D:\\Descargas", temp_path_enabled: true, temp_path: "D:\\EnCurso", max_ratio_enabled: true, max_ratio: 1, max_ratio_act: 0 });
      if (path === "torrents/info") return json([{ hash: "abc", name: "debian.iso", state: "downloading", progress: 0.5, size: 100, dlspeed: 10, eta: 5, category: "", save_path: "D:\\Descargas" }]);
      if (path === "torrents/categories") return json(Object.fromEntries(cats));
      if (path === "torrents/createCategory") { cats.set(body.get("category")!, { name: body.get("category")!, savePath: body.get("savePath")! }); return res.end(); }
      if (path === "torrents/removeCategories") { for (const c of body.get("categories")!.split("\n")) cats.delete(c); return res.end(); }
      res.statusCode = 404; res.end();
    });
  });
  return { server, sessions, state };
}

async function start() {
  const m = mock();
  await new Promise<void>((r) => m.server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(m.server.address() as AddressInfo).port}`;
  return { ...m, url };
}

test("login, versión, lectura y categorías de ida y vuelta", async () => {
  const { server, url } = await start();
  try {
    const qb = new QBittorrent({ url, username: "alex", password: "secreta" });
    assert.equal(await qb.version(), "v5.0.2");
    assert.equal(await qb.webApiVersion(), "2.11.2");
    assert.equal((await qb.list())[0].name, "debian.iso");
    assert.equal((await qb.preferences()).temp_path, "D:\\EnCurso");
    await qb.createCategory("nebula-doctor", "D:\\Descargas\\nebula-doctor");
    assert.equal((await qb.categories())["nebula-doctor"].savePath, "D:\\Descargas\\nebula-doctor");
    await qb.removeCategories(["nebula-doctor"]);
    assert.deepEqual(await qb.categories(), {});
  } finally { server.close(); }
});

test("sesión caducada: vuelve a iniciar sesión y reintenta una vez", async () => {
  const { server, url, sessions, state } = await start();
  try {
    const qb = new QBittorrent({ url, username: "alex", password: "secreta" });
    await qb.version();
    sessions.clear(); // caduca la sesión en el servidor
    assert.equal(await qb.version(), "v5.0.2");
    assert.equal(state.loginCalls, 2);
  } finally { server.close(); }
});

test("errores distinguibles: contraseña mala, bloqueo y servidor apagado", async () => {
  const { server, url } = await start();
  try {
    const bad = new QBittorrent({ url, username: "alex", password: "mala" });
    await assert.rejects(bad.login(), (e: QbError) => e.code === "auth");
    await assert.rejects(bad.login(), (e: QbError) => e.code === "auth");
    await assert.rejects(bad.login(), (e: QbError) => e.code === "auth");
    await assert.rejects(bad.login(), (e: QbError) => e.code === "banned");
  } finally { server.close(); }
  const off = new QBittorrent({ url: "http://127.0.0.1:1", username: "a", password: "b", timeoutMs: 500 });
  await assert.rejects(off.login(), (e: QbError) => e.code === "unreachable");
});

test("envía Origin y Referer propios (la protección CSRF de qBittorrent los exige)", async () => {
  const { server, url, state } = await start();
  try {
    await new QBittorrent({ url: `${url}/`, username: "alex", password: "secreta" }).version();
    assert.equal(state.badOrigin, 0);
  } finally { server.close(); }
});

test("una respuesta que no es «Fails.» ni «Ok.» se enseña, no se llama contraseña incorrecta", async () => {
  const server = http.createServer((_req, res) => { res.statusCode = 502; res.end("Bad Gateway"); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const qb = new QBittorrent({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, username: "a", password: "b" });
    await assert.rejects(qb.login(), (e: QbError) => e.code === "http" && /502/.test(e.message) && /Bad Gateway/.test(e.message));
  } finally { server.close(); }
});

test("autenticación omitida para localhost: login 204 sin cookie y la API responde sin sesión", async () => {
  const server = http.createServer((req, res) => {
    if (req.url === "/api/v2/auth/login") { res.statusCode = 204; return res.end(); }
    if (req.url === "/api/v2/app/version") return res.end("v5.0.2");
    res.statusCode = 404; res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const qb = new QBittorrent({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, username: "x", password: "y" });
    assert.equal(await qb.version(), "v5.0.2");
  } finally { server.close(); }
});

test("un 204 sin cookie y con la API cerrada es un error de sesión", async () => {
  const server = http.createServer((req, res) => { res.statusCode = req.url === "/api/v2/auth/login" ? 204 : 403; res.end(); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const qb = new QBittorrent({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, username: "x", password: "y" });
    await assert.rejects(() => qb.login(), (e) => e instanceof QbError && e.code === "auth");
  } finally { server.close(); }
});

test("qBittorrent 5.x: login 204 con cookie y 401 si la contraseña es mala", async () => {
  let sid = "";
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      if (req.url === "/api/v2/auth/login") {
        const b = new URLSearchParams(Buffer.concat(chunks).toString());
        if (b.get("password") !== "buena") { res.statusCode = 401; return res.end("Unauthorized"); }
        sid = "abc"; res.statusCode = 204; res.setHeader("set-cookie", "QBT_SID_8083=abc; HttpOnly; path=/"); return res.end();
      }
      if (!sid || !/QBT_SID_8083=abc/.test(req.headers.cookie ?? "")) { res.statusCode = 401; return res.end("Unauthorized"); }
      if (req.url === "/api/v2/app/version") return res.end("v5.3.0");
      res.statusCode = 404; res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.equal(await new QBittorrent({ url, username: "admin", password: "buena" }).version(), "v5.3.0");
    await assert.rejects(() => new QBittorrent({ url, username: "admin", password: "mala" }).login(), (e) => e instanceof QbError && e.code === "auth");
  } finally { server.close(); }
});
