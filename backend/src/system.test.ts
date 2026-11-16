import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { registerAuth } from "./auth/plugin.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { openDb } from "./db/index.js";
import type { HlsSessions } from "./ffmpeg/hls-sessions.js";
import { registerSystemRoutes } from "./system-routes.js";

async function build() {
  const root = mkdtempSync(path.join(tmpdir(), "nebula-sys-"));
  const db = openDb(":memory:");
  db.prepare("INSERT INTO libraries(id,name,type,root_path) VALUES(1,'Pelis','movies',?),(2,'Fuera','series',?)").run(root, path.join(root, "no-existe"));
  db.prepare("INSERT INTO movies(id,library_id,title,year) VALUES(1,1,'Dune',2021)").run();
  db.prepare("INSERT INTO media_files(id,library_id,movie_id,path,rel_path,size_bytes,mtime_ms) VALUES(1,1,1,'/x/dune.mkv','dune.mkv',3000,1)").run();
  let stopped = "";
  const fakeHls = {
    snapshot: () => [{ id: "s1", fileId: 1, durationS: 7200, maxHeight: 1080, profile: "nvenc-gpu", running: true, failed: false, segmentsTotal: 1200, positionS: 600, idleS: 2, ageS: 90 }],
    get: (id: string) => (id === "s1" ? {} : undefined),
    stop: async (id: string) => { stopped = id; },
  } as unknown as HlsSessions;
  const app = Fastify();
  await registerAuth(app, db);
  registerAuthRoutes(app, db);
  registerSystemRoutes(app, db, fakeHls, { ffmpegVersion: "7.1", nvenc: true, profiles: ["nvenc-gpu", "x264"] } as any, 3);
  await app.ready();
  const r = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { username: "alex", password: "contraseña-larga" } });
  const admin = `nebula_session=${r.cookies[0].value}`;
  const u = await app.inject({ method: "POST", url: "/api/users", headers: { cookie: admin }, payload: { username: "mia", password: "clave-de-mia-1" } });
  assert.equal(u.statusCode, 201);
  const l = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "mia", password: "clave-de-mia-1" } });
  const user = `nebula_session=${l.cookies[0].value}`;
  return { app, admin, user, root, stopped: () => stopped };
}

test("sistema: solo administradores", async () => {
  const { app, user, root } = await build();
  try {
    for (const [method, url] of [["GET", "/api/system/conversions"], ["GET", "/api/system/storage"], ["POST", "/api/system/conversions/s1/stop"]] as const)
      assert.equal((await app.inject({ method, url, headers: { cookie: user } })).statusCode, 403, url);
    assert.equal((await app.inject({ method: "GET", url: "/api/system/storage" })).statusCode, 401);
  } finally { await app.close(); rmSync(root, { recursive: true, force: true }); }
});

test("conversiones: título real, posición y detener", async () => {
  const { app, admin, root, stopped } = await build();
  try {
    const r = (await app.inject({ url: "/api/system/conversions", headers: { cookie: admin } })).json();
    assert.equal(r.nvenc, true);
    assert.equal(r.maxSessions, 3);
    assert.equal(r.sessions[0].title, "Dune");
    assert.equal(r.sessions[0].positionS, 600);
    assert.equal((await app.inject({ method: "POST", url: "/api/system/conversions/nope/stop", headers: { cookie: admin } })).statusCode, 404);
    assert.equal((await app.inject({ method: "POST", url: "/api/system/conversions/s1/stop", headers: { cookie: admin } })).statusCode, 200);
    assert.equal(stopped(), "s1");
  } finally { await app.close(); rmSync(root, { recursive: true, force: true }); }
});

test("almacenamiento: suma por carpeta y carpeta inaccesible sin disco", async () => {
  const { app, admin, root } = await build();
  try {
    const r = (await app.inject({ url: "/api/system/storage", headers: { cookie: admin } })).json();
    assert.equal(r[0].files, 1);
    assert.equal(r[0].sizeBytes, 3000);
    assert.ok(r[0].disk.totalBytes > r[0].disk.freeBytes && r[0].disk.freeBytes >= 0);
    assert.equal(r[1].files, 0);
    assert.equal(r[1].disk, null);
  } finally { await app.close(); rmSync(root, { recursive: true, force: true }); }
});
