import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Fastify from "fastify";
import type { SkippedInfo } from "@nebula/shared";
import { registerAuth } from "./auth/plugin.js";
import { createSession } from "./auth/sessions.js";
import { openDb } from "./db/index.js";
import { probeFailureDetail, scanLibrary, setScanExclusion, type LibraryRow } from "./scanner.js";
import { registerSystemRoutes } from "./system-routes.js";

async function build() {
  const root = await mkdtemp(path.join(os.tmpdir(), "nebula-skip-"));
  const db = openDb(":memory:");
  const lib = (id: number, name: string, dir: string): LibraryRow => {
    db.prepare("INSERT INTO libraries(id,name,type,root_path) VALUES(?,?,'series',?)").run(id, name, dir);
    return { id, name, type: "series", root_path: dir };
  };
  const put = async (dir: string, rel: string, body = "no es un vídeo") => {
    const f = path.join(dir, ...rel.split("/"));
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f, body);
    return f;
  };
  const admin = Number(db.prepare("INSERT INTO users(username,password_hash,role,created_at) VALUES('alex','x','admin',1)").run().lastInsertRowid);
  const user = Number(db.prepare("INSERT INTO users(username,password_hash,role,created_at) VALUES('otra','x','user',1)").run().lastInsertRowid);
  const cookie = (id: number) => `nebula_session=${createSession(db, id).token}`;
  const app = Fastify();
  await registerAuth(app, db);
  registerSystemRoutes(app, db, null, { ffmpegVersion: null, nvenc: false, profiles: [] } as any, 3);
  await app.ready();
  const get = (c?: string) => app.inject({ method: "GET", url: "/api/system/skipped", headers: c ? { cookie: c } : {} });
  return { root, db, lib, put, app, get, adminCookie: cookie(admin), userCookie: cookie(user) };
}

test("el escaneo anota qué omite y por qué: sin patrón, ffprobe fallido y descarga en curso", async () => {
  const { root, db, lib, put, app, get, adminCookie } = await build();
  try {
    const dir = path.join(root, "series");
    const l = lib(1, "Series", dir);
    const busy = await put(dir, "Show/Show.S01E02.mkv");
    await put(dir, "Show/Show.S01E01.mkv");          // reconocido, pero no es un vídeo de verdad → ffprobe falla
    await put(dir, "Show/extras/making of.mkv");     // sin temporada ni episodio
    await put(dir, "Show/notas.txt");                // no es vídeo: ni se mira
    setScanExclusion((p) => p === busy);
    const stats = await scanLibrary(db, l);
    assert.equal(stats.skipped, 2);
    assert.equal(stats.failed, 1);

    const r = await get(adminCookie);
    assert.equal(r.statusCode, 200);
    const info = r.json() as SkippedInfo;
    assert.equal(info.total, 3);
    assert.deepEqual(info.items.map((i) => [i.relPath, i.reason]), [
      ["Show/extras/making of.mkv", "unrecognized_name"],
      ["Show/Show.S01E01.mkv", "probe_failed"],
      ["Show/Show.S01E02.mkv", "download_in_progress"],
    ]);
    assert.equal(info.items[0].libraryName, "Series");
    assert.ok(info.items[1].detail, "ffprobe fallido trae el motivo");
    assert.ok(!info.items[1].detail!.includes(dir), "sin la ruta absoluta del servidor");
    assert.equal(info.items[0].detail, null);
    assert.equal(info.libraries.length, 1);
    assert.ok(info.libraries[0].scannedAt && Date.now() - info.libraries[0].scannedAt < 60_000);
  } finally { setScanExclusion(() => false); await app.close(); await rm(root, { recursive: true, force: true }); }
});

test("cada escaneo sustituye la lista: lo arreglado o borrado desaparece, sin acumular", async () => {
  const { root, db, lib, put, app, get, adminCookie } = await build();
  try {
    const dir = path.join(root, "series");
    const l = lib(1, "Series", dir);
    const extra = await put(dir, "Show/extras/making of.mkv");
    await put(dir, "Show/otro/blooper.mkv");
    await scanLibrary(db, l);
    assert.equal(((await get(adminCookie)).json() as SkippedInfo).total, 2);
    await rm(extra);
    await scanLibrary(db, l);
    await scanLibrary(db, l); // repetir no duplica
    const info = (await get(adminCookie)).json() as SkippedInfo;
    assert.deepEqual(info.items.map((i) => i.relPath), ["Show/otro/blooper.mkv"]);
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
});

test("escanear una biblioteca no borra los omitidos de otra, y se distinguen por nombre", async () => {
  const { root, db, lib, put, app, get, adminCookie } = await build();
  try {
    const a = path.join(root, "a"), b = path.join(root, "b");
    const la = lib(1, "Series A", a), lb = lib(2, "Series B", b);
    await put(a, "X/suelto.mkv"); await put(b, "Y/suelto.mkv");
    await scanLibrary(db, la); await scanLibrary(db, lb);
    await rm(path.join(a, "X", "suelto.mkv"));
    await scanLibrary(db, la); // solo A
    const info = (await get(adminCookie)).json() as SkippedInfo;
    assert.deepEqual(info.items.map((i) => [i.libraryName, i.relPath]), [["Series B", "Y/suelto.mkv"]]);
    assert.equal(info.libraries.length, 2);
    assert.ok(info.libraries.every((x) => x.scannedAt));
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
});

test("una biblioteca sin escanear sale con scannedAt nulo; borrarla limpia sus omitidos", async () => {
  const { root, db, lib, put, app, get, adminCookie } = await build();
  try {
    const dir = path.join(root, "s");
    const l = lib(1, "Series", dir);
    lib(2, "Nueva", path.join(root, "n"));
    await put(dir, "Z/suelto.mkv");
    await scanLibrary(db, l);
    const info = (await get(adminCookie)).json() as SkippedInfo;
    assert.equal(info.libraries.find((x) => x.id === 2)!.scannedAt, null);
    db.prepare("DELETE FROM libraries WHERE id=1").run();
    assert.equal(((await get(adminCookie)).json() as SkippedInfo).total, 0);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM scan_state WHERE library_id=1").get() as { n: number }).n, 0);
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
});

test("solo administradores: sin sesión 401 y con usuario normal 403", async () => {
  const { root, app, get, userCookie } = await build();
  try {
    assert.equal((await get()).statusCode, 401);
    assert.equal((await get(userCookie)).statusCode, 403);
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
});

test("la lista se recorta a 500 pero el total es el real", async () => {
  const { root, db, app, get, adminCookie } = await build();
  try {
    db.prepare("INSERT INTO libraries(id,name,type,root_path) VALUES(1,'S','series','/x')").run();
    const ins = db.prepare("INSERT INTO scan_skipped(library_id,rel_path,reason,detail) VALUES(1,?,'unrecognized_name',NULL)");
    db.transaction(() => { for (let i = 0; i < 620; i++) ins.run(`f${String(i).padStart(4, "0")}.mkv`); })();
    const info = (await get(adminCookie)).json() as SkippedInfo;
    assert.equal(info.total, 620);
    assert.equal(info.items.length, 500);
    assert.equal(info.items[0].relPath, "f0000.mkv");
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
});

test("probeFailureDetail: línea propia de ffprobe con ruta relativa, ENOENT claro y sin desbordar", () => {
  const abs = "/srv/series/Show/Show.S01E01.mkv";
  const e = Object.assign(new Error("Command failed: ffprobe -v error -print_format json " + abs + "\nlo demás"),
    { stderr: `${abs}: Invalid data found when processing input\n` });
  assert.equal(probeFailureDetail(e, abs, "Show/Show.S01E01.mkv"), "Show/Show.S01E01.mkv: Invalid data found when processing input");
  assert.equal(probeFailureDetail(Object.assign(new Error("spawn ffprobe ENOENT"), { code: "ENOENT" }), abs, "x"), "no se encuentra ffprobe");
  assert.equal(probeFailureDetail(new Error("algo raro\nsegunda línea"), abs, "x"), "algo raro");
  assert.equal(probeFailureDetail("texto suelto", abs, "x"), "texto suelto");
  assert.equal(probeFailureDetail(Object.assign(new Error("e"), { stderr: "x".repeat(900) }), abs, "x").length, 300);
});
