import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb } from "./db/index.js";
import { isSkippedDir, unsafeLibraryRoot } from "./library-paths.js";
import { scanLibrary } from "./scanner.js";

test("rutas peligrosas: unidades enteras y carpetas del sistema", () => {
  for (const p of ["D:\\", "d:/", "C:", "D:\\\\", "/"]) assert.equal(unsafeLibraryRoot(p), "drive_root", p);
  for (const p of ["C:\\Windows", "c:\\windows\\system32", "D:\\Program Files\\Unity", "C:\\Program Files (x86)", "C:\\ProgramData", "D:\\$RECYCLE.BIN", "/etc", "/usr/share", "/var/lib"])
    assert.equal(unsafeLibraryRoot(p), "system_folder", p);
});

test("rutas válidas: carpetas normales, aunque se parezcan", () => {
  for (const p of ["D:\\Peliculas", "D:\\Series", "D:\\Descargas\\Completados", "E:\\Media\\Windows Tutoriales", "/mnt/media", "/home/alex/series", "/srv/Peliculas"])
    assert.equal(unsafeLibraryRoot(p), null, p);
});

test("carpetas que el escáner nunca recorre", () => {
  for (const n of ["$RECYCLE.BIN", "System Volume Information", "node_modules", ".git", "@eaDir"]) assert.ok(isSkippedDir(n), n);
  for (const n of ["Temporada 1", "Peliculas", "windows"]) assert.ok(!isSkippedDir(n), n);
});

test("el escaneo se niega a recorrer una raíz peligrosa ya guardada", async () => {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO libraries(id,name,type,root_path) VALUES(1,'Series','series','D:\\')").run();
  const lib = db.prepare("SELECT * FROM libraries WHERE id=1").get() as any;
  await assert.rejects(() => scanLibrary(db, lib), /unidad entera|carpeta del sistema/);
});

test("el escaneo no entra en node_modules ni en la papelera", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "nebula-lib-"));
  try {
    for (const d of ["node_modules/x", "$RECYCLE.BIN/S-1", "Sub"]) mkdirSync(path.join(root, d), { recursive: true });
    // Archivos de mentira: no hay ffprobe que valga, así que cada uno cuenta como omitido o fallido.
    for (const f of ["a.mp4", "Sub/b.mp4", "node_modules/x/c.mp4", "$RECYCLE.BIN/S-1/d.mp4"]) writeFileSync(path.join(root, f), "x");
    const db = openDb(":memory:");
    db.prepare("INSERT INTO libraries(id,name,type,root_path) VALUES(1,'Pelis','movies',?)").run(root);
    const stats = await scanLibrary(db, db.prepare("SELECT * FROM libraries WHERE id=1").get() as any);
    // Sin ffprobe real esos vídeos «fallan» o se omiten; lo que importa es que solo se tocan 2 de los 4.
    assert.equal(stats.skipped + stats.failed + stats.added, 2, JSON.stringify(stats));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("una raíz ilegible sí falla, para no dar por escaneada una biblioteca vacía", async () => {
  const db = openDb(":memory:");
  const missing = path.join(tmpdir(), "nebula-no-existe-" + Date.now());
  db.prepare("INSERT INTO libraries(id,name,type,root_path) VALUES(1,'X','movies',?)").run(missing);
  await assert.rejects(() => scanLibrary(db, db.prepare("SELECT * FROM libraries WHERE id=1").get() as any), /ENOENT/);
});
