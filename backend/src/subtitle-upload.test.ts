import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Fastify from "fastify";
import type { SubtitleUploadResult } from "@nebula/shared";
import { registerAuth } from "./auth/plugin.js";
import { createSession } from "./auth/sessions.js";
import { openDb } from "./db/index.js";
import { MAX_SUBTITLE_UPLOAD_BYTES, normalizeUploadedSrt, SubtitleCache } from "./subtitles.js";
import { registerSubtitleRoutes } from "./subtitles-routes.js";

const hasFfmpeg = (() => { try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch { return false; } })();
const SRT = "1\n00:00:01,000 --> 00:00:03,000\nHola, ¿qué tal? Año nuevo.\n\n2\n00:00:04,000 --> 00:00:06,000\nAdiós.\n";

async function build() {
  const root = await mkdtemp(path.join(os.tmpdir(), "nebula-subup-"));
  const video = path.join(root, "Peli (2020).mkv");
  await writeFile(video, "no importa: aquí no se reproduce nada");
  const db = openDb(":memory:");
  db.prepare("INSERT INTO libraries(id,name,type,root_path) VALUES(1,'P','movies',?)").run(root);
  db.prepare("INSERT INTO movies(id,library_id,title) VALUES(1,1,'Peli')").run();
  db.prepare("INSERT INTO media_files(id,library_id,movie_id,path,rel_path,size_bytes,mtime_ms) VALUES(1,1,1,?,'Peli (2020).mkv',10,1)").run(video);
  const user = (name: string, role: string) => Number(db.prepare("INSERT INTO users(username,password_hash,role,created_at) VALUES(?,?,?,1)").run(name, "x", role).lastInsertRowid);
  const admin = `nebula_session=${createSession(db, user("alex", "admin")).token}`;
  const plain = `nebula_session=${createSession(db, user("otra", "user")).token}`;
  const app = Fastify();
  await registerAuth(app, db);
  registerSubtitleRoutes(app, db, new SubtitleCache(path.join(root, ".cache"), "ffmpeg"));
  await app.ready();
  const up = (body: Buffer | string, o: { cookie?: string | null; lang?: string; type?: string; id?: number; headers?: Record<string, string> } = {}) =>
    app.inject({
      method: "POST", url: `/api/files/${o.id ?? 1}/subtitles${o.lang === undefined ? "" : `?lang=${o.lang}`}`,
      headers: { ...(o.cookie === null ? {} : { cookie: o.cookie ?? admin }), "content-type": o.type ?? "application/octet-stream", ...o.headers },
      payload: body,
    });
  const files = async () => (await readdir(root)).filter((f) => !f.startsWith(".")).sort();
  const close = async () => { await app.close(); await rm(root, { recursive: true, force: true }); };
  return { root, db, app, up, files, close, admin, plain };
}

test("normalizeUploadedSrt: acepta SRT en UTF-8, UTF-8 con BOM, Windows-1252 y UTF-16, y los deja en UTF-8", () => {
  assert.equal(normalizeUploadedSrt(Buffer.from(SRT)), SRT);
  assert.equal(normalizeUploadedSrt(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(SRT)])), SRT);
  const cp1252 = Buffer.from("1\n00:00:01,000 --> 00:00:02,000\nAño niño café\n", "latin1");
  assert.ok(normalizeUploadedSrt(cp1252)!.includes("Año niño café"));
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(SRT, "utf16le")]);
  assert.equal(normalizeUploadedSrt(utf16), SRT);
  assert.equal(normalizeUploadedSrt(Buffer.from(SRT.trimEnd())), SRT, "añade el salto final");
});

test("normalizeUploadedSrt: rechaza lo que no es un SRT", () => {
  for (const bad of [Buffer.alloc(0), Buffer.from("hola, esto es solo texto"), Buffer.from("00:01 --> 00:02\nsin horas"),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0x0d]), Buffer.from("1\n00:00:01,000 --> 00:00:02,000\nok\0basura")]) {
    assert.equal(normalizeUploadedSrt(bad), null);
  }
});

test("un admin sube un .srt: queda junto al vídeo, en UTF-8, y aparece como pista externa", async () => {
  const { root, up, files, db, close } = await build();
  try {
    const r = await up(Buffer.from(SRT.replace("Año", "Año"), "latin1"), { lang: "es" });
    assert.equal(r.statusCode, 201);
    const body = r.json() as SubtitleUploadResult;
    assert.equal(body.language, "es");
    assert.equal(body.title, "Peli (2020).es.srt");
    assert.deepEqual(await files(), ["Peli (2020).es.srt", "Peli (2020).mkv"]);
    assert.ok((await readFile(path.join(root, "Peli (2020).es.srt"), "utf8")).includes("¿qué tal? Año nuevo"), "guardado como UTF-8 legible");
    const s = db.prepare("SELECT idx, kind, codec, language, is_external AS ext FROM media_streams WHERE file_id=1").all();
    assert.deepEqual(s, [{ idx: body.idx, kind: "subtitle", codec: "srt", language: "es", ext: 1 }]);
  } finally { await close(); }
});

test("el idioma por defecto es es y se pueden añadir otros idiomas sin tocar los anteriores", async () => {
  const { up, files, db, close } = await build();
  try {
    assert.equal((await up(SRT)).statusCode, 201);
    assert.equal((await up(SRT, { lang: "EN" })).statusCode, 201, "mayúsculas se normalizan");
    assert.deepEqual(await files(), ["Peli (2020).en.srt", "Peli (2020).es.srt", "Peli (2020).mkv"]);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM media_streams WHERE file_id=1 AND is_external=1").get() as { n: number }).n, 2);
  } finally { await close(); }
});

test("nunca pisa un subtítulo existente: 409 y el original queda intacto", async () => {
  const { root, up, close } = await build();
  try {
    await writeFile(path.join(root, "Peli (2020).es.srt"), "ORIGINAL");
    const r = await up(SRT, { lang: "es" });
    assert.equal(r.statusCode, 409);
    assert.equal(r.json().error, "already_exists");
    assert.equal(await readFile(path.join(root, "Peli (2020).es.srt"), "utf8"), "ORIGINAL");
  } finally { await close(); }
});

test("solo administradores: sin sesión 401, usuario normal 403, y no se escribe nada", async () => {
  const { up, files, plain, close } = await build();
  try {
    assert.equal((await up(SRT, { cookie: null })).statusCode, 401);
    assert.equal((await up(SRT, { cookie: plain })).statusCode, 403);
    assert.deepEqual(await files(), ["Peli (2020).mkv"]);
  } finally { await close(); }
});

test("un usuario normal no puede ni obligar al servidor a leer un cuerpo enorme (se corta antes de leerlo)", async () => {
  const { up, plain, close } = await build();
  try {
    const r = await up(Buffer.alloc(MAX_SUBTITLE_UPLOAD_BYTES + 10, 65), { cookie: plain });
    assert.equal(r.statusCode, 403);
  } finally { await close(); }
});

test("idiomas con formato raro o intentos de salir de la carpeta: 400 y nada escrito", async () => {
  const { root, up, files, close } = await build();
  try {
    for (const lang of ["../x", "..%2F..%2Fetc", "es.forced", "e", "espanol", "1a", "%00", "es%20", ""]) {
      const r = await up(SRT, { lang });
      assert.equal(r.statusCode, 400, `lang=${lang}`);
    }
    assert.deepEqual(await files(), ["Peli (2020).mkv"]);
    assert.deepEqual((await readdir(path.dirname(root))).filter((f) => f === "x.srt" || f === "etc"), []);
  } finally { await close(); }
});

test("contenido que no es un SRT: 422 y nada escrito", async () => {
  const { up, files, close } = await build();
  try {
    for (const bad of [Buffer.alloc(0), Buffer.from("texto sin marcas de tiempo"), Buffer.from([0x50, 0x4b, 3, 4, 0, 0, 0, 0])]) {
      const r = await up(bad);
      assert.equal(r.statusCode, 422);
      assert.equal(r.json().error, "invalid_subtitle");
    }
    assert.deepEqual(await files(), ["Peli (2020).mkv"]);
  } finally { await close(); }
});

test("archivo inexistente 404; demasiado grande 413; tipo de contenido no admitido 415; otro origen 403", async () => {
  const { up, files, close } = await build();
  try {
    assert.equal((await up(SRT, { id: 999 })).statusCode, 404);
    assert.equal((await up(Buffer.alloc(MAX_SUBTITLE_UPLOAD_BYTES + 10, 65))).statusCode, 413);
    assert.equal((await up(JSON.stringify({ x: 1 }), { type: "application/json" })).statusCode, 422, "JSON no es un cuerpo binario");
    assert.equal((await up(SRT, { type: "application/x-www-form-urlencoded" })).statusCode, 415);
    assert.equal((await up(SRT, { headers: { origin: "https://malo.example" } })).statusCode, 403);
    assert.deepEqual(await files(), ["Peli (2020).mkv"]);
  } finally { await close(); }
});

test("carpeta de solo lectura o sin vídeo en disco: 500 write_failed, sin dejar la base inconsistente", async () => {
  const { root, up, db, close } = await build();
  try {
    db.prepare("UPDATE media_files SET path=? WHERE id=1").run(path.join(root, "no-existe", "Peli.mkv"));
    const r = await up(SRT);
    assert.equal(r.statusCode, 500);
    assert.equal(r.json().error, "write_failed");
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM media_streams").get() as { n: number }).n, 0);
  } finally { await close(); }
});

test("el subtítulo subido se puede servir convertido a WebVTT con la ñ intacta", { skip: !hasFfmpeg, timeout: 60_000 }, async () => {
  const { app, up, admin, close } = await build();
  try {
    const { idx } = (await up(Buffer.from(SRT.replace("Año", "Año"), "latin1"))).json() as SubtitleUploadResult;
    const r = await app.inject({ method: "GET", url: `/api/subtitles/1/${idx}.vtt`, headers: { cookie: admin } });
    assert.equal(r.statusCode, 200);
    assert.ok(r.body.startsWith("WEBVTT"));
    assert.ok(r.body.includes("Año nuevo"));
  } finally { await close(); }
});
