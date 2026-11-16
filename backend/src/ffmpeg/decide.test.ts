import { test } from "node:test";
import assert from "node:assert/strict";
import type { ClientCapabilities, MediaStreamInfo } from "@nebula/shared";
import { containerOf, decidePlayback } from "./decide.js";

const chrome: ClientCapabilities = {
  video: { h264: true, vp9: true, av1: true },
  audio: { aac: true, mp3: true, opus: true, vorbis: true, flac: true },
  containers: { mp4: true, webm: true, mkv: false },
  hls: "mse",
};
const v = (o: Partial<MediaStreamInfo> = {}): MediaStreamInfo => ({
  idx: 0, kind: "video", codec: "h264", profile: "High", pixFmt: "yuv420p", width: 1920, height: 1080,
  channels: null, language: null, title: null, isDefault: true, isForced: false, isExternal: false, textual: false, ...o,
});
const a = (o: Partial<MediaStreamInfo> = {}): MediaStreamInfo => ({
  idx: 1, kind: "audio", codec: "aac", profile: null, pixFmt: null, width: null, height: null,
  channels: 2, language: "spa", title: null, isDefault: true, isForced: false, isExternal: false, textual: false, ...o,
});
const run = (over: Record<string, unknown>) =>
  decidePlayback({ ext: ".mp4", container: "mov,mp4,m4a,3gp,3g2,mj2", bitrate: 5_000_000, streams: [v(), a()], caps: chrome, ...over });
const codes = (d: ReturnType<typeof run>) => d.reasons.map((r) => r.code);

test("mp4 h264+aac en Chrome: Direct Play", () => {
  const d = run({});
  assert.equal(d.mode, "direct");
  assert.deepEqual(d.reasons, []);
  assert.equal(d.audioIdx, 1);
});
test("mkv sin soporte de contenedor: convierte", () => {
  const d = run({ ext: ".mkv", container: "matroska,webm" });
  assert.equal(d.mode, "transcode");
  assert.deepEqual(codes(d), ["container"]);
});
test("mkv con navegador que lo admite: Direct Play", () => {
  const d = run({ ext: ".mkv", container: "matroska,webm", caps: { ...chrome, containers: { ...chrome.containers, mkv: true } } });
  assert.equal(d.mode, "direct");
});
test("HEVC sin soporte: convierte por códec de vídeo", () => {
  assert.deepEqual(codes(run({ streams: [v({ codec: "hevc" }), a()] })), ["video_codec"]);
});
test("HEVC con soporte (Safari) en mp4: Direct Play", () => {
  const d = run({ streams: [v({ codec: "hevc" }), a()], caps: { ...chrome, video: { ...chrome.video, hevc: true } } });
  assert.equal(d.mode, "direct");
});
test("H.264 de 10 bits: convierte por perfil", () => {
  const d = run({ streams: [v({ profile: "High 10", pixFmt: "yuv420p10le" }), a()] });
  assert.deepEqual(codes(d), ["video_profile"]);
});
test("audio AC3 en mp4 sin soporte: convierte por audio", () => {
  assert.deepEqual(codes(run({ streams: [v(), a({ codec: "ac3" })] })), ["audio_codec"]);
});
test("pista de audio distinta de la predeterminada exige convertir", () => {
  const streams = [v(), a({ idx: 1, language: "spa" }), a({ idx: 2, language: "eng", isDefault: false })];
  const d = run({ streams, audioStreamIdx: 2 });
  assert.equal(d.mode, "transcode");
  assert.deepEqual(codes(d), ["audio_track"]);
  assert.equal(d.audioIdx, 2);
});
test("sin pista marcada como predeterminada se usa la primera", () => {
  const streams = [v(), a({ idx: 1, isDefault: false }), a({ idx: 2, isDefault: false })];
  assert.equal(run({ streams }).audioIdx, 1);
});
test("bitrate por encima del límite del cliente", () => {
  const d = run({ caps: { ...chrome, maxBitrate: 2_000_000 } });
  assert.deepEqual(codes(d), ["bitrate"]);
});
test("forzar conversión", () => {
  assert.deepEqual(codes(run({ forceTranscode: true })), ["forced"]);
});
test("si hay que convertir y el cliente no tiene HLS: no reproducible", () => {
  const d = run({ forceTranscode: true, caps: { ...chrome, hls: "none" } });
  assert.equal(d.mode, "unplayable");
});
test("archivo sin pista de vídeo: no reproducible", () => {
  assert.equal(run({ streams: [a()] }).mode, "unplayable");
});
test("detección de contenedor por extensión en matroska/webm", () => {
  assert.equal(containerOf(".webm", "matroska,webm"), "webm");
  assert.equal(containerOf(".mkv", "matroska,webm"), "mkv");
  assert.equal(containerOf(".mp4", "mov,mp4,m4a,3gp,3g2,mj2"), "mp4");
});
