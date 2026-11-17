// Integración con FFmpeg REAL: es la red de seguridad del remux. El comportamiento de `-ss`, `-copypriorss` y `-t` en modo copia
// depende de la versión de FFmpeg y del contenedor, así que este test debe pasar en la máquina donde corre Nebula (`npm test`).
// Sin ffmpeg/ffprobe en el PATH se salta.
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import Fastify from "fastify";
import type { PlaybackDecision } from "@nebula/shared";
import { registerAuth } from "../auth/plugin.js";
import { createSession } from "../auth/sessions.js";
import { openDb } from "../db/index.js";
import { registerPlaybackRoutes } from "../playback-routes.js";
import { scanLibrary } from "../scanner.js";
import { HlsSessions } from "./hls-sessions.js";
import { KeyframeIndex, planSegments, probeKeyframes } from "./keyframes.js";

const exec = promisify(execFile);
const has = (bin: string) => { try { execFileSync(bin, ["-version"], { stdio: "ignore" }); return true; } catch { return false; } };
const available = has("ffmpeg") && has("ffprobe");
const TS_DELAY = 1.4; // retardo fijo del muxer MPEG-TS: todas las marcas salen desplazadas lo mismo
const FRAME = 0.04; // 25 fps

/** Vídeo H.264 con B-frames y GOP cerrado, más audio AC3 (lo que un navegador no reproduce dentro de un mkv). */
async function makeSource(out: string, seconds: number, gop: string[]) {
  await exec("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", `testsrc2=size=640x360:rate=25:duration=${seconds}`,
    "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${seconds}`,
    "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "ultrafast", "-bf", "2", "-pix_fmt", "yuv420p", ...gop,
    "-c:a", "ac3", "-b:a", "192k", out]);
}
const REGULAR_GOP = ["-g", "100", "-keyint_min", "100", "-sc_threshold", "0"]; // keyframe cada 4 s
const IRREGULAR_GOP = ["-g", "250", "-sc_threshold", "0", "-force_key_frames", "3,11,12.5,25,31,38"];

const nums = (s: string) => s.split("\n").map((l) => l.trim()).filter((l) => l && l !== "N/A").map(Number);
async function videoPts(file: string) {
  const { stdout } = await exec("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time", "-of", "csv=p=0", file]);
  return nums(stdout);
}

async function newSessions(tmp: string, ffmpegPath = "ffmpeg") {
  const logs: string[] = [];
  const hls = new HlsSessions({ ffmpegPath, baseDir: path.join(tmp, "hls"), profiles: ["x264"], maxSessions: 4, firstSegmentTimeoutMs: 30_000, log: (m) => logs.push(m) });
  await hls.init();
  return { hls, logs };
}

/** Pide los segmentos en el orden dado (saltos incluidos) y comprueba que encajan exactamente. */
async function checkRemux(src: string, tmp: string, seconds: number, order: (n: number) => number[]) {
  const kf = await probeKeyframes("ffprobe", src, 0);
  assert.ok(kf.pts.length >= 4, "hay keyframes");
  assert.ok(kf.delay > 0 && kf.delay < 0.2, `retardo dts→pts razonable (${kf.delay})`);
  const bounds = planSegments(kf.pts, seconds)!;
  assert.ok(bounds && bounds.length >= 4, "hay plan de segmentos");

  const { hls } = await newSessions(tmp);
  try {
    const s = await hls.create({ fileId: 1, input: src, durationS: seconds, videoIdx: 0, audioIdx: 1, sourceWidth: 640, sourceHeight: 360, maxHeight: 1080, remux: { bounds, delay: kf.delay } });
    assert.equal(s.total, bounds.length - 1);
    assert.equal(hls.playlist(s).split("\n").filter((l) => l.startsWith("#EXTINF")).length, s.total);

    const files: string[] = new Array(s.total);
    for (const n of order(s.total)) {
      const f = await hls.segment(s, n);
      assert.ok(f, `segmento ${n} producido`);
      files[n] = f!;
    }
    const srcFrames = (await videoPts(src)).length;
    const per = await Promise.all(files.map(videoPts));

    per.forEach((p, n) => {
      const first = Math.min(...p);
      const expected = bounds[n] + kf.delay + TS_DELAY; // línea de tiempo uniforme: original + retardo B-frames + retardo del muxer TS
      assert.ok(Math.abs(first - expected) < 0.03, `segmento ${n}: empieza en ${first.toFixed(3)}, esperado ${expected.toFixed(3)}`);
      if (n > 0) {
        const gap = first - Math.max(...per[n - 1]);
        assert.ok(gap > 0, `segmento ${n}: no solapa con el anterior (hueco ${gap.toFixed(3)})`);
        assert.ok(gap < FRAME * 2.5, `segmento ${n}: sin huecos con el anterior (hueco ${gap.toFixed(3)})`);
      }
    });
    assert.equal(per.reduce((t, p) => t + p.length, 0), srcFrames, "ni se pierde ni se duplica ningún fotograma");

    // El audio recodificado de cada segmento arranca alineado con su vídeo: si no, tras cada salto habría desincronía.
    for (const [n, f] of files.entries()) {
      const { stdout: a } = await exec("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "packet=pts_time", "-of", "csv=p=0", f]);
      const audioFirst = Math.min(...nums(a));
      assert.ok(Math.abs(audioFirst - Math.min(...per[n])) < 0.12, `segmento ${n}: audio y vídeo arrancan a la vez (${audioFirst.toFixed(3)} vs ${Math.min(...per[n]).toFixed(3)})`);
    }

    // Cada segmento: vídeo copiado (mismo códec) y audio AAC estéreo a 48 kHz.
    const { stdout } = await exec("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", files[0]]);
    const st = JSON.parse(stdout).streams;
    assert.ok(st.some((x: any) => x.codec_name === "h264" && x.pix_fmt === "yuv420p"));
    assert.ok(st.some((x: any) => x.codec_name === "aac" && x.channels === 2 && Number(x.sample_rate) === 48000));

    // El conjunto, concatenado como lo haría un reproductor, se decodifica sin un solo error.
    const all = path.join(tmp, "todo.ts");
    await writeFile(all, Buffer.concat(await Promise.all(files.map((f) => readFile(f)))));
    const { stderr } = await exec("ffmpeg", ["-nostdin", "-v", "error", "-i", all, "-f", "null", "-"]);
    assert.equal(stderr.trim(), "", "decodificación sin errores");
    return { bounds, s, hls };
  } finally { await hls.shutdown(); }
}

test("remux con GOP regular: segmentos exactos, en orden y sin recodificar el vídeo", { skip: !available, timeout: 180_000 }, async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "nebula-remux-"));
  try {
    const src = path.join(tmp, "regular.mkv");
    await makeSource(src, 40, REGULAR_GOP);
    const { bounds } = await checkRemux(src, tmp, 40, (n) => [...Array(n).keys()]);
    assert.deepEqual(bounds.map((b) => Math.round(b)), [0, 8, 16, 24, 32, 40]);
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test("remux con keyframes irregulares y saltos: los cortes siguen al original y los segmentos encajan igual", { skip: !available, timeout: 180_000 }, async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "nebula-remux-"));
  try {
    const src = path.join(tmp, "irregular.mkv");
    await makeSource(src, 45, IRREGULAR_GOP);
    // Desordenado a propósito: salto al final, vuelta al principio, y el resto salteado.
    const { bounds } = await checkRemux(src, tmp, 45, (n) => [n - 1, 0, ...[...Array(n).keys()].slice(1, -1).reverse()]);
    assert.ok(bounds.some((b) => Math.abs(b - 12.5) < 0.1 || Math.abs(b - 11) < 0.1), "los cortes caen en keyframes reales, no en una rejilla");
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test("remux: si FFmpeg falla la sesión se marca fallida (el reproductor pedirá la conversión completa) y no se reutiliza", { skip: !available, timeout: 60_000 }, async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "nebula-remux-"));
  const { hls, logs } = await newSessions(tmp);
  try {
    const params = { fileId: 1, input: path.join(tmp, "no-existe.mkv"), durationS: 30, videoIdx: 0, audioIdx: 1, sourceWidth: 640, sourceHeight: 360, maxHeight: 1080, remux: { bounds: [0, 8, 16, 24, 30], delay: 0.08 } };
    const s = await hls.create(params);
    assert.equal(await hls.segment(s, 0), null);
    assert.equal(s.failed, true);
    assert.ok(logs.some((l) => l.includes("[copy]") && l.includes("falló")));
    assert.equal(await hls.segment(s, 1), null, "una sesión fallida no sigue lanzando procesos");
    assert.notEqual((await hls.create(params)).id, s.id, "una sesión fallida no se reutiliza");
    assert.equal(hls.snapshot().find((x) => x.id === s.id)?.profile, "copy");
  } finally { await hls.shutdown(); await rm(tmp, { recursive: true, force: true }); }
});

test("remux: una sesión de remux y una de conversión sobre el mismo archivo no se confunden", { skip: !available, timeout: 60_000 }, async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "nebula-remux-"));
  const { hls } = await newSessions(tmp);
  try {
    const base = { fileId: 1, input: "/x.mkv", durationS: 30, videoIdx: 0, audioIdx: 1, sourceWidth: 640, sourceHeight: 360, maxHeight: 1080 };
    const a = await hls.create({ ...base, remux: { bounds: [0, 10, 20, 30], delay: 0 } });
    const b = await hls.create(base);
    assert.notEqual(a.id, b.id);
    assert.equal((await hls.create({ ...base, remux: { bounds: [0, 10, 20, 30], delay: 0 } })).id, a.id);
    await hls.stop(a.id);
    assert.equal(hls.get(a.id), undefined);
  } finally { await hls.shutdown(); await rm(tmp, { recursive: true, force: true }); }
});

// --- De extremo a extremo por la API: escaneo real → decisión → playlist → segmento ---
const chromeCaps = {
  video: { h264: true, vp9: true, av1: true }, audio: { aac: true, mp3: true, opus: true, vorbis: true, flac: true },
  containers: { mp4: true, webm: true, mkv: false }, hls: "mse",
};

async function buildApi(tmp: string, opts: { probe?: typeof probeKeyframes; waitMs?: number } = {}) {
  const dir = path.join(tmp, "pelis");
  await mkdir(dir, { recursive: true });
  await makeSource(path.join(dir, "Mi Pelicula (2020).mkv"), 30, REGULAR_GOP);
  const db = openDb(":memory:");
  db.prepare("INSERT INTO libraries(id,name,type,root_path) VALUES(1,'Pelis','movies',?)").run(dir);
  await scanLibrary(db, { id: 1, name: "Pelis", type: "movies", root_path: dir });
  const fileId = (db.prepare("SELECT id FROM media_files").get() as { id: number }).id;
  const uid = Number(db.prepare("INSERT INTO users(username,password_hash,role,created_at) VALUES('alex','x','admin',1)").run().lastInsertRowid);
  const cookie = `nebula_session=${createSession(db, uid).token}`;
  const { hls } = await newSessions(tmp);
  const app = Fastify();
  await registerAuth(app, db);
  const kfIndex = new KeyframeIndex(db, "ffprobe", opts.probe);
  registerPlaybackRoutes(app, db, hls, { ffmpegVersion: "test", nvenc: false, profiles: ["x264"] } as any, 4, false, kfIndex, opts.waitMs);
  await app.ready();
  const decide = (body: object = {}) => app.inject({ method: "POST", url: `/api/playback/${fileId}/decide`, headers: { cookie }, payload: { capabilities: chromeCaps, ...body } });
  const get = (url: string) => app.inject({ method: "GET", url, headers: { cookie } });
  return { app, hls, db, fileId, decide, get, kfIndex };
}

test("API: un mkv con audio AC3 se sirve por remux y cada pieza es reproducible", { skip: !available, timeout: 180_000 }, async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "nebula-remux-"));
  const { app, hls, decide, get } = await buildApi(tmp);
  try {
    const r = await decide();
    assert.equal(r.statusCode, 200);
    const d = r.json() as PlaybackDecision;
    assert.equal(d.mode, "remux");
    assert.equal(d.encoder, undefined);
    assert.deepEqual(d.reasons.map((x) => x.code).sort(), ["audio_codec", "container"]);

    const pl = await get(d.url);
    assert.equal(pl.statusCode, 200);
    const segs = pl.body.split("\n").filter((l) => l.startsWith("seg_"));
    assert.ok(segs.length >= 3);
    const seg = await get(`/api/hls/${d.sessionId}/${segs[1]}`);
    assert.equal(seg.statusCode, 200);
    assert.equal(seg.headers["content-type"], "video/mp2t");
    assert.equal(seg.rawPayload[0], 0x47, "paquete MPEG-TS válido");

    const again = (await decide().then((x) => x.json())) as PlaybackDecision;
    assert.equal(again.sessionId, d.sessionId, "misma petición, misma sesión");

    // Forzar la conversión sigue siendo posible y no usa el remux.
    assert.equal(((await decide({ forceTranscode: true })).json() as PlaybackDecision).mode, "transcode");
    // Otra pista de audio distinta de la predeterminada tampoco necesita recodificar vídeo.
    assert.equal((await get("/api/system")).statusCode, 200);
  } finally { await app.close(); await hls.shutdown(); await rm(tmp, { recursive: true, force: true }); }
});

test("API: si el índice de keyframes no está a tiempo se recodifica como siempre, y la siguiente vez ya hay remux", { skip: !available, timeout: 180_000 }, async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "nebula-remux-"));
  let unlock!: () => void;
  const gate = new Promise<void>((r) => { unlock = r; });
  const slow: typeof probeKeyframes = async (...a) => { await gate; return probeKeyframes(...a); };
  const { app, hls, decide, kfIndex, fileId } = await buildApi(tmp, { probe: slow, waitMs: 50 });
  try {
    const first = (await decide().then((x) => x.json())) as PlaybackDecision;
    assert.equal(first.mode, "transcode", "sin índice todavía: conversión de siempre");
    assert.ok(first.encoder);
    assert.ok(first.reasons.length > 0);

    unlock();
    for (let i = 0; i < 100 && !kfIndex.cached(fileId); i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(kfIndex.cached(fileId), "el índice se terminó de calcular en segundo plano");
    assert.equal(((await decide().then((x) => x.json())) as PlaybackDecision).mode, "remux");
  } finally { unlock(); await app.close(); await hls.shutdown(); await rm(tmp, { recursive: true, force: true }); }
});

test("API: si ffprobe no puede indexar el archivo, se recodifica en vez de fallar", { skip: !available, timeout: 120_000 }, async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "nebula-remux-"));
  const { app, hls, decide } = await buildApi(tmp, { probe: async () => { throw new Error("sin acceso"); }, waitMs: 2000 });
  try {
    const d = (await decide().then((x) => x.json())) as PlaybackDecision;
    assert.equal(d.mode, "transcode");
  } finally { await app.close(); await hls.shutdown(); await rm(tmp, { recursive: true, force: true }); }
});
