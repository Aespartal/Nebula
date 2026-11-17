import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import Fastify from "fastify";
import { registerAuth } from "./auth/plugin.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { CAST_TTL_MS, CastTickets, registerCastRoutes } from "./cast.js";
import { openDb } from "./db/index.js";
import { HlsSessions } from "./ffmpeg/hls-sessions.js";

const run = promisify(execFile);
const hasFfmpeg = (() => { try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch { return false; } })();
const SID = "123e4567-e89b-12d3-a456-426614174000";

test("permisos: firma, caducidad y manipulación", () => {
  let now = 1_800_000_000_000;
  const t = new CastTickets(Buffer.from("k".repeat(32)), () => now);
  const { ticket, expiresAt } = t.issue(SID);
  assert.equal(expiresAt, now + CAST_TTL_MS);
  assert.equal(t.verify(ticket), SID);
  const [sid, exp, sig] = ticket.split(".");
  assert.equal(t.verify(`${sid}.${Number(exp) + 1}.${sig}`), null, "no se puede alargar la caducidad");
  assert.equal(t.verify(`123e4567-e89b-12d3-a456-426614174001.${exp}.${sig}`), null, "no vale para otra sesión");
  assert.equal(t.verify(`${sid}.${exp}.${sig.slice(0, -1)}A`), null);
  assert.equal(t.verify(`${sid}.${exp}.`), null);
  assert.equal(t.verify("x"), null);
  assert.equal(t.verify("a".repeat(500)), null);
  assert.equal(new CastTickets(Buffer.from("o".repeat(32)), () => now).verify(ticket), null, "otra clave no lo acepta");
  now += CAST_TTL_MS + 1;
  assert.equal(t.verify(ticket), null, "caducado");
});

test("rutas de Cast: sin sesión no se crea nada; con permiso, la tele sí ve la conversión", { skip: !hasFfmpeg, timeout: 120_000 }, async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "nebula-cast-"));
  const sample = path.join(tmp, "peli.mp4");
  await run("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=24:d=8", "-f", "lavfi", "-i", "sine=d=8",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", sample]);
  const db = openDb(":memory:");
  db.prepare("INSERT INTO libraries(id,name,type,root_path) VALUES(1,'P','movies',?)").run(tmp);
  db.prepare("INSERT INTO movies(id,library_id,title) VALUES(1,1,'Peli')").run();
  db.prepare("INSERT INTO media_files(id,library_id,movie_id,path,rel_path,size_bytes,mtime_ms,container,duration_s) VALUES(7,1,1,?,'peli.mp4',1000,0,'mov,mp4,m4a,3gp,3g2,mj2',8)").run(sample);
  db.prepare("INSERT INTO media_streams(file_id,idx,kind,codec,pix_fmt,width,height,is_default) VALUES(7,0,'video','h264','yuv420p',640,360,1)").run();
  db.prepare("INSERT INTO media_streams(file_id,idx,kind,codec,channels,is_default) VALUES(7,1,'audio','aac',2,1)").run();
  const hls = new HlsSessions({ ffmpegPath: "ffmpeg", baseDir: path.join(tmp, "hls"), profiles: ["x264"], segDur: 4, window: 2, maxSessions: 2, log: () => {} });
  await hls.init();

  const build = async (publicUrl: string | null) => {
    const app = Fastify();
    await registerAuth(app, db);
    registerAuthRoutes(app, db);
    registerCastRoutes(app, db, hls, { publicUrl });
    // Una ruta normal para comprobar que el permiso de la tele no abre nada más.
    app.get("/api/hls/:sid/index.m3u8", async () => "no debería verse");
    await app.ready();
    return app;
  };
  try {
    const off = await build(null);
    const r0 = await off.inject({ method: "POST", url: "/api/auth/setup", payload: { username: "alex", password: "contraseña-larga" } });
    const cookie = `nebula_session=${r0.cookies[0].value}`;
    assert.equal((await off.inject({ method: "POST", url: "/api/cast/7", headers: { cookie }, payload: {} })).statusCode, 409, "sin PUBLIC_URL");
    await off.close();

    const app = await build("https://pc.ejemplo.ts.net");
    assert.equal((await app.inject({ method: "POST", url: "/api/cast/7", payload: {} })).statusCode, 401, "crear exige sesión");
    assert.equal((await app.inject({ method: "POST", url: "/api/cast/999", headers: { cookie }, payload: {} })).statusCode, 404);
    const made = await app.inject({ method: "POST", url: "/api/cast/7", headers: { cookie }, payload: {} });
    assert.equal(made.statusCode, 200);
    const cast = made.json() as { url: string; sessionId: string; durationS: number };
    assert.match(cast.url, /^https:\/\/pc\.ejemplo\.ts\.net\/api\/cast\/t\/[0-9a-f-]{36}\.\d+\.[\w-]+\/index\.m3u8$/);
    const base = cast.url.replace("https://pc.ejemplo.ts.net", "");
    const dir = base.replace("index.m3u8", "");

    // La tele no lleva cookie.
    const pl = await app.inject({ method: "GET", url: base });
    assert.equal(pl.statusCode, 200);
    assert.equal(pl.headers["access-control-allow-origin"], "*");
    assert.match(String(pl.headers["content-type"]), /mpegurl/);
    assert.ok(pl.body.includes("seg_00000.ts"));
    const seg = await app.inject({ method: "GET", url: `${dir}seg_00000.ts` });
    assert.equal(seg.statusCode, 200);
    assert.equal(seg.headers["access-control-allow-origin"], "*");
    assert.ok(seg.rawPayload.length > 1000);
    const pre = await app.inject({ method: "OPTIONS", url: base, headers: { origin: "https://www.gstatic.com", "access-control-request-method": "GET" } });
    assert.equal(pre.statusCode, 204);
    assert.equal(pre.headers["access-control-allow-origin"], "*");

    // Lo que no debe pasar.
    assert.equal((await app.inject({ method: "GET", url: `/api/cast/t/${cast.sessionId}.${Date.now() + 1e7}.firmafalsa/index.m3u8` })).statusCode, 403, "firma falsa");
    assert.equal((await app.inject({ method: "GET", url: `${dir}../seg_00000.ts` })).statusCode, 404);
    assert.equal((await app.inject({ method: "GET", url: `${dir}passwd` })).statusCode, 404);
    assert.equal((await app.inject({ method: "GET", url: `/api/hls/${cast.sessionId}/index.m3u8` })).statusCode, 401, "el permiso no abre las rutas normales");
    assert.equal((await app.inject({ method: "POST", url: `${dir}stop`, payload: {} })).statusCode, 401, "ni acciones");
    assert.equal((await app.inject({ method: "GET", url: "/api/cast/t/" })).statusCode, 404);
    await hls.stop(cast.sessionId);
    assert.equal((await app.inject({ method: "GET", url: base })).statusCode, 410, "sesión terminada");
    await app.close();
  } finally { await hls.shutdown(); }
});
