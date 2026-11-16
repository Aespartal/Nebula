import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Fastify from "fastify";
import { config } from "./config.js";
import { openDb } from "./db/index.js";
import { scanLibrary } from "./scanner.js";
import { SubtitleCache, SubtitleError, convertToVtt, decodeSubtitleText, isTextSubtitle } from "./subtitles.js";
import { registerSubtitleRoutes } from "./subtitles-routes.js";

const ff = config.ffmpegPath;
const tmp = mkdtempSync(path.join(os.tmpdir(), "nebula-subs-"));
const SRT = "1\n00:00:01,000 --> 00:00:02,500\nHola, ¿qué tal? Cañón\n\n2\n00:00:03,000 --> 00:00:04,000\nSegundo\n";

test("códecs de texto frente a imagen", () => {
  for (const c of ["subrip", "srt", "ass", "mov_text", "webvtt", "SubRip"]) assert.equal(isTextSubtitle(c), true, c);
  for (const c of ["hdmv_pgs_subtitle", "dvd_subtitle", "dvb_subtitle", null]) assert.equal(isTextSubtitle(c), false, String(c));
});

test("decodificación: UTF-8, Windows-1252 y UTF-16 con BOM", () => {
  assert.equal(decodeSubtitleText(Buffer.from("Cañón ¿sí?", "utf8")), "Cañón ¿sí?");
  assert.equal(decodeSubtitleText(Buffer.from("﻿hola", "utf8")), "hola");
  assert.equal(decodeSubtitleText(Buffer.from("Cañón ¿sí?", "latin1")), "Cañón ¿sí?"); // un .srt antiguo
  assert.equal(decodeSubtitleText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("año", "utf16le")])), "año");
});

test("srt externo en Windows-1252 → WebVTT en UTF-8 con las marcas de tiempo en formato VTT", async () => {
  const f = path.join(tmp, "a.es.srt");
  writeFileSync(f, Buffer.from(SRT, "latin1"));
  const vtt = await convertToVtt(ff, { videoPath: "x", streamIdx: 1000, codec: "srt", externalPath: f });
  assert.match(vtt, /^WEBVTT/);
  assert.match(vtt, /(00:)?00:01\.000 --> (00:)?00:02\.500/);
  assert.match(vtt, /Hola, ¿qué tal\? Cañón/);
});

test("vtt externo se devuelve tal cual; los de imagen se rechazan", async () => {
  const f = path.join(tmp, "b.vtt");
  writeFileSync(f, "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n");
  assert.match(await convertToVtt(ff, { videoPath: "x", streamIdx: 1000, codec: "vtt", externalPath: f }), /Hi/);
  await assert.rejects(convertToVtt(ff, { videoPath: "x", streamIdx: 2, codec: "hdmv_pgs_subtitle", externalPath: null }),
    (e: unknown) => e instanceof SubtitleError && e.code === "unsupported");
  await assert.rejects(convertToVtt(ff, { videoPath: "x", streamIdx: 1000, codec: "srt", externalPath: path.join(tmp, "no-existe.srt") }),
    (e: unknown) => e instanceof SubtitleError && e.code === "unreadable");
});

// Vídeo mkv con dos subtítulos embebidos (es, en) y uno externo.
const lib = path.join(tmp, "lib");
const vid = path.join(lib, "Peli (2020)", "Peli (2020).mkv");
test("preparar vídeo de prueba", () => {
  execFileSync("mkdir", ["-p", path.dirname(vid)]);
  writeFileSync(path.join(tmp, "es.srt"), SRT);
  writeFileSync(path.join(tmp, "en.srt"), SRT.replace("Hola, ¿qué tal?", "Hello there").replace("Cañón", "Canyon"));
  execFileSync(ff, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=160x90:r=10:d=6", "-i", path.join(tmp, "es.srt"), "-i", path.join(tmp, "en.srt"),
    "-map", "0", "-map", "1", "-map", "2", "-c:v", "libx264", "-preset", "ultrafast", "-c:s", "srt",
    "-metadata:s:s:0", "language=spa", "-metadata:s:s:1", "language=eng", vid]);
  assert.ok(existsSync(vid));
});

test("subtítulo embebido → WebVTT, caché en disco y una sola conversión para peticiones simultáneas", async () => {
  const cache = new SubtitleCache(path.join(tmp, "cache"), ff);
  const src = { videoPath: vid, streamIdx: 1, codec: "subrip", externalPath: null };
  const [a, b] = await Promise.all([cache.get(src), cache.get(src)]);
  assert.equal(a, b);
  assert.match(a, /Hola, ¿qué tal\?/);
  assert.equal(readdirSync(path.join(tmp, "cache")).filter((n) => n.endsWith(".vtt")).length, 1);
  // Segunda vez: sale del disco (con un ffmpeg inexistente no podría convertir).
  assert.equal(await new SubtitleCache(path.join(tmp, "cache"), "/no/existe/ffmpeg").get(src), a);
});

test("el escaneo guarda las pistas, detecta subtítulos externos nuevos sin repetir ffprobe y la ruta los sirve", async () => {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO libraries(id,name,type,root_path) VALUES(1,'P','movies',?)").run(lib);
  const row = db.prepare("SELECT * FROM libraries WHERE id=1").get() as any;
  const s1 = await scanLibrary(db, row);
  assert.equal(s1.added, 1);
  const subs = () => db.prepare("SELECT idx,codec,language,is_external AS ext,is_forced AS forced FROM media_streams WHERE kind='subtitle' ORDER BY idx").all() as any[];
  assert.deepEqual(subs().map((s) => [s.idx, s.codec, s.language, s.ext]).slice(0, 2), [[1, "subrip", "spa", 0], [2, "subrip", "eng", 0]]);

  // Llega un subtítulo externo después de escanear: el siguiente escaneo lo ve aunque el vídeo no haya cambiado.
  writeFileSync(path.join(path.dirname(vid), "Peli (2020).es.forced.srt"), Buffer.from(SRT, "latin1"));
  const s2 = await scanLibrary(db, row);
  assert.deepEqual([s2.added, s2.updated, s2.unchanged], [0, 1, 0]);
  const ext = subs().find((s) => s.ext);
  assert.deepEqual([ext.idx, ext.codec, ext.language, ext.forced], [1000, "srt", "es", 1]);
  const s3 = await scanLibrary(db, row);
  assert.deepEqual([s3.updated, s3.unchanged], [0, 1]);

  const app = Fastify();
  registerSubtitleRoutes(app, db, new SubtitleCache(path.join(tmp, "cache2"), ff));
  const ok = await app.inject("/api/subtitles/1/1000.vtt");
  assert.equal(ok.statusCode, 200);
  assert.match(ok.headers["content-type"] as string, /text\/vtt/);
  assert.match(ok.body, /Cañón/);
  assert.equal((await app.inject("/api/subtitles/1/2.vtt")).statusCode, 200);
  assert.equal((await app.inject("/api/subtitles/1/77.vtt")).statusCode, 404);
  assert.equal((await app.inject("/api/subtitles/1/../../etc/passwd")).statusCode, 404);
  assert.equal((await app.inject("/api/subtitles/1/2.txt")).statusCode, 404);
  db.prepare("UPDATE media_streams SET codec='hdmv_pgs_subtitle' WHERE idx=2").run();
  assert.equal((await app.inject("/api/subtitles/1/2.vtt")).statusCode, 415);
});
