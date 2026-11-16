import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHlsArgs, buildPlaylist, maxrateKbps, segmentCount, segmentName, targetSize, type HlsJob } from "./args.js";

const job = (o: Partial<HlsJob> = {}): HlsJob => ({
  input: "/v/peli.mkv", startSeg: 0, segCount: 10, segDur: 6, videoIdx: 0, audioIdx: 1,
  sourceWidth: 1920, sourceHeight: 1080, maxHeight: 1080, profile: "x264", ...o,
});
const val = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

test("un resto final minúsculo se absorbe en el segmento anterior", () => {
  assert.equal(segmentCount(60.01, 6), 10);
  assert.equal(segmentCount(60.49, 6), 10);
  assert.equal(segmentCount(60.6, 6), 11);
  assert.equal(segmentCount(0.3, 6), 1);
  const lines = buildPlaylist(60.01, 6).split("\n").filter((l) => l.startsWith("#EXTINF"));
  assert.equal(lines.length, 10);
  assert.equal(lines[9], "#EXTINF:6.010,");
});

test("segmentCount redondea hacia arriba y no deja segmentos vacíos", () => {
  assert.equal(segmentCount(60, 6), 10);
  assert.equal(segmentCount(60.5, 6), 11);
  assert.equal(segmentCount(5, 6), 1);
});
test("playlist: duración total, último segmento corto y ENDLIST", () => {
  const p = buildPlaylist(65, 6).split("\n");
  assert.equal(p.filter((l) => l.startsWith("#EXTINF")).length, 11);
  assert.ok(p.includes("#EXTINF:5.000,"));
  assert.ok(p.includes("seg_00010.ts"));
  assert.ok(p.includes("#EXT-X-ENDLIST"));
  assert.ok(p.includes("#EXT-X-PLAYLIST-TYPE:VOD"));
  const sum = p.filter((l) => l.startsWith("#EXTINF")).reduce((s, l) => s + parseFloat(l.slice(8)), 0);
  assert.equal(Math.round(sum), 65);
});
test("nombres de segmento con relleno", () => assert.equal(segmentName(12), "seg_00012.ts"));
test("targetSize: no amplía, reduce con ancho par", () => {
  assert.equal(targetSize(1280, 720, 1080), null);
  assert.deepEqual(targetSize(3840, 2160, 1080), { w: 1920, h: 1080 });
  assert.deepEqual(targetSize(1920, 800, 720), { w: 1728, h: 720 });
  assert.equal(targetSize(null, null, 1080), null);
});
test("maxrate por resolución", () => {
  assert.equal(maxrateKbps(480), 2500);
  assert.equal(maxrateKbps(1080), 8000);
  assert.equal(maxrateKbps(2160), 16000);
});
test("x264: sin -ss al empezar, filtro CPU y fotogramas clave cada segmento", () => {
  const a = buildHlsArgs(job());
  assert.ok(!a.includes("-ss"));
  assert.ok(!a.includes("-hwaccel"));
  assert.equal(val(a, "-c:v"), "libx264");
  assert.equal(val(a, "-vf"), "format=yuv420p");
  assert.equal(val(a, "-force_key_frames"), "expr:gte(t,n_forced*6)");
  assert.equal(val(a, "-t"), "60.000");
  assert.equal(val(a, "-start_number"), "0");
});
test("reanudar en el segmento 20: -ss, offset de marcas de tiempo y numeración", () => {
  const a = buildHlsArgs(job({ startSeg: 20 }));
  assert.equal(val(a, "-ss"), "120.000");
  assert.equal(val(a, "-output_ts_offset"), "120.000");
  assert.equal(val(a, "-start_number"), "20");
  assert.ok(a.indexOf("-ss") < a.indexOf("-i"), "-ss antes de -i (búsqueda rápida en la entrada)");
});
test("nvenc-gpu: decodificación CUDA y scale_cuda", () => {
  const a = buildHlsArgs(job({ profile: "nvenc-gpu", sourceWidth: 3840, sourceHeight: 2160 }));
  assert.deepEqual(a.slice(a.indexOf("-hwaccel"), a.indexOf("-hwaccel") + 4), ["-hwaccel", "cuda", "-hwaccel_output_format", "cuda"]);
  assert.equal(val(a, "-c:v"), "h264_nvenc");
  assert.equal(val(a, "-vf"), "scale_cuda=w=1920:h=1080:format=nv12");
  assert.equal(val(a, "-maxrate"), "8000k");
  assert.equal(val(a, "-forced-idr"), "1");
});
test("nvenc-cpu-decode: sin hwaccel pero con codificador NVENC", () => {
  const a = buildHlsArgs(job({ profile: "nvenc-cpu-decode" }));
  assert.ok(!a.includes("-hwaccel"));
  assert.equal(val(a, "-c:v"), "h264_nvenc");
  assert.equal(val(a, "-vf"), "format=yuv420p");
});
test("audio: pista elegida, AAC estéreo; sin audio no hay mapa ni códec de audio", () => {
  const a = buildHlsArgs(job({ audioIdx: 3 }));
  assert.deepEqual(a.filter((x, i) => a[i - 1] === "-map"), ["0:0", "0:3"]);
  assert.equal(val(a, "-c:a"), "aac");
  assert.equal(val(a, "-ac"), "2");
  const b = buildHlsArgs(job({ audioIdx: null }));
  assert.ok(!b.includes("-c:a"));
  assert.deepEqual(b.filter((x, i) => b[i - 1] === "-map" && x.startsWith("0:")), ["0:0"]);
});
test("el nombre de salida es relativo (se ejecuta con cwd en la sesión)", () => {
  const a = buildHlsArgs(job());
  assert.equal(a[a.length - 1], "ffmpeg.m3u8");
  assert.equal(val(a, "-hls_segment_filename"), "seg_%05d.ts");
});
