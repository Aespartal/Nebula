import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Fastify from "fastify";
import { registerAuth } from "./auth/plugin.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { openDb } from "./db/index.js";
import { attachmentHeader, registerRoutes } from "./routes.js";
import { incompletePathFilter } from "./scanner.js";

test("attachmentHeader: nombre seguro y filename* con el real", () => {
  const h = attachmentHeader('Amélie "2001"; ñ%.mkv');
  assert.match(h, /^attachment; filename="[\x20-\x7e]*"; filename\*=UTF-8''/);
  assert.ok(!/[\r\n]/.test(h));
  assert.ok(h.includes("Am%C3%A9lie%20%222001%22%3B%20%C3%B1%25.mkv"), h);
  assert.equal(attachmentHeader("a\r\nSet-Cookie: x=1.mkv").includes("\n"), false);
});

test("incompletePathFilter: solo lo que cuelga de una descarga sin terminar", () => {
  const f = incompletePathFilter(() => [
    { savePath: "D:\\Peliculas", name: "Peli En Curso", done: false },
    { savePath: "D:\\Peliculas", name: "Peli Lista", done: true },
    { savePath: "D:/Series/", name: "suelto.mkv", done: false },
  ]);
  assert.equal(f("D:\\Peliculas\\Peli En Curso\\peli.mkv"), true);
  assert.equal(f("d:\\peliculas\\peli en curso"), true);
  assert.equal(f("D:\\Series\\suelto.mkv"), true);
  assert.equal(f("D:\\Peliculas\\Peli Lista\\peli.mkv"), false);
  assert.equal(f("D:\\Peliculas\\Peli En Curso 2\\x.mkv"), false, "prefijo parcial no cuenta");
  assert.equal(f("D:\\Otra\\Peli En Curso\\x.mkv"), false);
});

async function build() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "nebula-dl-"));
  const file = path.join(dir, "Película ñ.mkv");
  await writeFile(file, Buffer.from("0123456789"));
  const db = openDb(":memory:");
  db.prepare("INSERT INTO libraries(id,name,type,root_path) VALUES(1,'Pelis','movies',?)").run(dir);
  db.prepare("INSERT INTO movies(id,library_id,title) VALUES(1,1,'Peli')").run();
  const id = Number(db.prepare(
    "INSERT INTO media_files(library_id,movie_id,path,rel_path,size_bytes,mtime_ms,container) VALUES(1,1,?,?,10,0,'matroska')").run(file, "Película ñ.mkv").lastInsertRowid);
  const app = Fastify();
  await registerAuth(app, db);
  registerAuthRoutes(app, db);
  registerRoutes(app, db);
  await app.ready();
  const r = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { username: "alex", password: "contraseña-larga" } });
  const cookie = `nebula_session=${r.cookies[0].value}`;
  return { app, id, cookie };
}

test("descarga de archivo: sesión obligatoria, adjunto y Range", async () => {
  const { app, id, cookie } = await build();
  try {
    assert.equal((await app.inject({ method: "GET", url: `/api/files/${id}/download` })).statusCode, 401);
    const ok = await app.inject({ method: "GET", url: `/api/files/${id}/download`, headers: { cookie } });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.body, "0123456789");
    assert.match(String(ok.headers["content-disposition"]), /^attachment; filename="Pel_cula _\.mkv"; filename\*=UTF-8''Pel%C3%ADcula%20%C3%B1\.mkv$/);
    assert.equal(ok.headers["accept-ranges"], "bytes");
    const part = await app.inject({ method: "GET", url: `/api/files/${id}/download`, headers: { cookie, range: "bytes=2-5" } });
    assert.equal(part.statusCode, 206);
    assert.equal(part.body, "2345");
    assert.equal(part.headers["content-range"], "bytes 2-5/10");
    assert.equal((await app.inject({ method: "GET", url: `/api/files/${id}/download`, headers: { cookie, range: "bytes=50-60" } })).statusCode, 416);
    assert.equal((await app.inject({ method: "GET", url: "/api/files/9999/download", headers: { cookie } })).statusCode, 404);
  } finally { await app.close(); }
});

test("escaneo: una descarga sin terminar no entra en el catálogo", async () => {
  const { mkdir } = await import("node:fs/promises");
  const { scanLibrary, setScanExclusion } = await import("./scanner.js");
  const dir = await mkdtemp(path.join(os.tmpdir(), "nebula-scan-"));
  await mkdir(path.join(dir, "Peli (2020)"));
  await writeFile(path.join(dir, "Peli (2020)", "Peli (2020).mkv"), Buffer.from("a medias"));
  const db = openDb(":memory:");
  db.prepare("INSERT INTO libraries(id,name,type,root_path) VALUES(1,'Pelis','movies',?)").run(dir);
  setScanExclusion(incompletePathFilter(() => [{ savePath: dir, name: "Peli (2020)", done: false }]));
  try {
    const st = await scanLibrary(db, { id: 1, name: "Pelis", type: "movies", root_path: dir });
    assert.equal(st.skipped, 1);
    assert.equal(st.added + st.failed, 0);
    assert.equal((db.prepare("SELECT COUNT(*) n FROM media_files").get() as { n: number }).n, 0);
    assert.equal((db.prepare("SELECT COUNT(*) n FROM movies").get() as { n: number }).n, 0);
  } finally { setScanExclusion(() => false); }
});
