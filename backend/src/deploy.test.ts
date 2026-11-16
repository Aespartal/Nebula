import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import Fastify from "fastify";
import { openDb } from "./db/index.js";
import { registerSecurityHeaders } from "./security.js";
import { isRelevant, LibraryWatcher } from "./watcher.js";

test("cabeceras de seguridad: CSP solo en la web, HSTS solo con HTTPS", async () => {
  const app = Fastify({ trustProxy: true });
  registerSecurityHeaders(app);
  app.get("/", async () => "ok");
  app.get("/api/x", async () => ({}));
  app.get("/api/auth/status", async () => ({}));
  const web = await app.inject({ url: "/" });
  assert.match(String(web.headers["content-security-policy"]), /default-src 'self'/);
  assert.match(String(web.headers["content-security-policy"]), /frame-ancestors 'none'/);
  assert.equal(web.headers["x-content-type-options"], "nosniff");
  assert.equal(web.headers["strict-transport-security"], undefined);
  const api = await app.inject({ url: "/api/x" });
  assert.equal(api.headers["content-security-policy"], undefined);
  assert.equal(api.headers["x-frame-options"], "DENY");
  assert.equal((await app.inject({ url: "/api/auth/status" })).headers["cache-control"], "no-store");
  const tls = await app.inject({ url: "/", headers: { "x-forwarded-proto": "https" } });
  assert.match(String(tls.headers["strict-transport-security"]), /max-age=/);
});

test("isRelevant: vídeos, subtítulos y carpetas sí; el resto no", () => {
  for (const f of ["a.mkv", "B.MP4", "x/y.srt", "Temporada 2", null]) assert.ok(isRelevant(f), String(f));
  for (const f of ["notas.txt", "poster.jpg", "a.mkv.part", "Thumbs.db"]) assert.ok(!isRelevant(f), f);
});

test("el vigilante agrupa cambios seguidos en un solo escaneo y reintenta si había uno en curso", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "nebula-w-"));
  const db = openDb(":memory:");
  db.prepare("INSERT INTO libraries(name,type,root_path) VALUES('P','movies',?)").run(root);
  let calls = 0, busy = true;
  const w = new LibraryWatcher(db, {
    debounceMs: 150, intervalMs: 0, log: () => {},
    scan: async () => { calls++; if (busy) { busy = false; throw Object.assign(new Error("scan_in_progress"), { statusCode: 409 }); } },
  });
  try {
    w.sync();
    writeFileSync(path.join(root, "a.mkv"), "x");
    mkdirSync(path.join(root, "sub"));
    writeFileSync(path.join(root, "sub", "b.mkv"), "x");
    writeFileSync(path.join(root, "leeme.txt"), "x");
    await new Promise((r) => setTimeout(r, 600));
    assert.equal(calls, 1, "varios eventos → un escaneo");
    // el 409 reprograma a los 5 s; lo adelantamos llamando al planificador directamente
    w.schedule(1, 10);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(calls, 2);
  } finally { w.close(); rmSync(root, { recursive: true, force: true }); }
});

test("un archivo irrelevante no dispara escaneo", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "nebula-w-"));
  const db = openDb(":memory:");
  db.prepare("INSERT INTO libraries(name,type,root_path) VALUES('P','movies',?)").run(root);
  let calls = 0;
  const w = new LibraryWatcher(db, { debounceMs: 100, intervalMs: 0, log: () => {}, scan: async () => { calls++; } });
  try {
    w.sync();
    writeFileSync(path.join(root, "notas.txt"), "x");
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(calls, 0);
  } finally { w.close(); rmSync(root, { recursive: true, force: true }); }
});

test("detrás de un proxy con TRUST_PROXY, la cookie es Secure solo si el proxy declara https", async () => {
  const { registerAuth } = await import("./auth/plugin.js");
  const { registerAuthRoutes } = await import("./auth/routes.js");
  for (const trust of [true, false]) {
    const app = Fastify({ trustProxy: trust });
    const db = openDb(":memory:");
    await registerAuth(app, db);
    registerAuthRoutes(app, db);
    const r = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { username: "alex", password: "contraseña-larga" },
      headers: { "x-forwarded-proto": "https", "x-forwarded-host": "nebula.example.com", origin: "https://nebula.example.com" } });
    assert.equal(r.statusCode, trust ? 201 : 403, trust ? "con proxy de confianza se acepta" : "sin confiar en el proxy, el origen no coincide");
    if (trust) assert.equal(r.cookies.find((c) => c.name === "nebula_session")?.secure, true);
  }
});
