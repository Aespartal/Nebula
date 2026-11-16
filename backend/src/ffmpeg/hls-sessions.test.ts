import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdtemp, readdir, rm, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { HlsSessions } from "./hls-sessions.js";

const run = promisify(execFile);
const hasFfmpeg = (() => { try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch { return false; } })();

// Integración real con FFmpeg. La cadena nvenc-gpu → nvenc-cpu-decode → x264 se ejercita sola:
// en una máquina sin GPU las dos primeras fallan y el gestor debe caer a x264 sin que se note.
test("sesiones HLS: respaldo de codificador, salto, límite de sesiones y limpieza", { skip: !hasFfmpeg, timeout: 180_000 }, async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "nebula-test-"));
  const sample = path.join(tmp, "muestra.mp4");
  await run("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=24:d=20",
    "-f", "lavfi", "-i", "sine=d=20", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", sample]);

  const logs: string[] = [];
  const hls = new HlsSessions({
    ffmpegPath: "ffmpeg", baseDir: path.join(tmp, "hls"), profiles: ["nvenc-gpu", "nvenc-cpu-decode", "x264"],
    segDur: 6, window: 2, maxSessions: 2, log: (m) => logs.push(m),
  });
  await hls.init();
  const params = { fileId: 1, input: sample, durationS: 20, videoIdx: 0, audioIdx: 1, sourceWidth: 640, sourceHeight: 360, maxHeight: 1080 };

  try {
    const s = await hls.create(params);
    assert.equal(s.total, 4);
    assert.equal((await hls.create(params)).id, s.id, "misma petición reutiliza la sesión");
    assert.equal(hls.playlist(s).split("\n").filter((l) => l.startsWith("#EXTINF")).length, 4);

    const first = await hls.segment(s, 0);
    assert.ok(first, "se produce el primer segmento (con respaldo si hace falta)");
    const probe = async (f: string) => JSON.parse((await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", f])).stdout).streams;
    const st = await probe(first!);
    assert.ok(st.some((x: any) => x.codec_name === "h264" && x.pix_fmt === "yuv420p"));
    assert.ok(st.some((x: any) => x.codec_name === "aac"));

    // Salto lejos: debe reiniciar FFmpeg en el segmento 3 (el último, de 2 s).
    const last = await hls.segment(s, 3);
    assert.ok(last, "salto al último segmento");
    assert.equal((await readdir(s.dir)).filter((f) => /^seg_\d{5}\.ts$/.test(f)).includes("seg_00003.ts"), true);

    assert.equal(await hls.segment(s, 4), null, "fuera de rango");
    assert.equal(await hls.segment(s, -1), null);

    // Límite de sesiones: con maxSessions=2, la tercera expulsa a la más antigua.
    const s2 = await hls.create({ ...params, audioIdx: null });
    const s3 = await hls.create({ ...params, maxHeight: 720 });
    assert.equal(hls.activeCount, 2);
    assert.equal(hls.get(s.id), undefined, "la sesión más antigua se cerró");
    await assert.rejects(access(s.dir), "su carpeta temporal se borró");
    assert.ok(hls.get(s2.id) && hls.get(s3.id));

    await hls.stop(s2.id);
    assert.equal(hls.activeCount, 1);
  } finally {
    await hls.shutdown();
    await rm(tmp, { recursive: true, force: true });
  }
  console.log("      registro:", logs.map((l) => l.replace(/sesión [0-9a-f]{8} /, "")).slice(0, 6).join(" | "));
  await assert.rejects(access(path.join(tmp, "hls")), "shutdown limpia el directorio");
});
