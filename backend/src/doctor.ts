// Diagnóstico: `npm run doctor`. Comprueba FFmpeg, NVENC y prueba de verdad cada ruta de conversión.
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { config } from "./config.js";
import { buildHlsArgs, type ProfileName } from "./ffmpeg/args.js";
import { detectEncoders } from "./ffmpeg/encoders.js";

const run = promisify(execFile);
const ok = (m: string) => console.log(`  ✔ ${m}`);
const bad = (m: string) => console.log(`  ✘ ${m}`);
const info = (m: string) => console.log(`    ${m}`);

async function tryRun(bin: string, args: string[], cwd?: string) {
  try {
    await run(bin, args, { cwd, timeout: 60_000, windowsHide: true });
    return { ok: true as const, err: "" };
  } catch (e: any) {
    return { ok: false as const, err: String(e?.stderr ?? e?.message ?? e).trim().split("\n").slice(-4).join("\n") };
  }
}

console.log(`\nNebula · diagnóstico (${process.platform}, Node ${process.version})\n`);

console.log("FFmpeg");
const enc = await detectEncoders(config.ffmpegPath);
if (!enc.ffmpegVersion) {
  bad(`No se encuentra «${config.ffmpegPath}».`);
  info("Instala FFmpeg (en Windows: https://www.gyan.dev/ffmpeg/builds/, versión «full») y añádelo al PATH,");
  info("o indica la ruta con la variable FFMPEG_PATH.");
  process.exit(1);
}
ok(`ffmpeg ${enc.ffmpegVersion}`);
const probe = await tryRun(config.ffprobePath, ["-version"]);
probe.ok ? ok("ffprobe encontrado") : bad(`No se encuentra «${config.ffprobePath}» (hace falta para escanear).`);
enc.x264 ? ok("libx264 disponible (conversión por CPU)") : bad("libx264 no está disponible en este FFmpeg");

console.log("\nGPU NVIDIA");
const smi = await run("nvidia-smi", ["--query-gpu=name,driver_version", "--format=csv,noheader"], { timeout: 10_000, windowsHide: true }).catch(() => null);
smi ? ok(`Tarjeta detectada: ${smi.stdout.trim()}`) : bad("nvidia-smi no responde (¿driver de NVIDIA instalado?)");
enc.nvencListed ? ok("Este FFmpeg incluye NVENC") : bad("Este FFmpeg no incluye h264_nvenc (usa una build «full»)");
if (enc.nvencListed) enc.nvenc ? ok("Codificación de prueba con NVENC correcta") : bad("NVENC está compilado pero no funciona: actualiza el driver de NVIDIA");

console.log("\nRutas de conversión (prueba real con el mismo comando que usa Nebula)");
const tmp = await mkdtemp(path.join(os.tmpdir(), "nebula-doctor-"));
const working: ProfileName[] = [];
try {
  const sample = path.join(tmp, "muestra.mp4");
  const gen = await tryRun(config.ffmpegPath, [
    "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=s=1280x720:r=24:d=4",
    "-f", "lavfi", "-i", "sine=d=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", sample,
  ]);
  if (!gen.ok) throw new Error(`No se pudo crear el vídeo de prueba: ${gen.err}`);
  const profiles: ProfileName[] = ["nvenc-gpu", "nvenc-cpu-decode", "x264"];
  for (const p of profiles) {
    if (p !== "x264" && !enc.nvenc) { bad(`${p}: omitida (NVENC no disponible)`); continue; }
    const dir = path.join(tmp, p);
    await mkdir(dir);
    const args = buildHlsArgs({
      input: sample, startSeg: 0, segCount: 1, segDur: 2, videoIdx: 0, audioIdx: 1,
      sourceWidth: 1280, sourceHeight: 720, maxHeight: 1080, profile: p,
    });
    const r = await tryRun(config.ffmpegPath, args, dir);
    const made = (await readdir(dir)).some((f) => f.endsWith(".ts"));
    if (r.ok && made) { ok(p); working.push(p); } else { bad(p); info(r.err.replace(/\n/g, "\n    ")); }
  }
} finally {
  await rm(tmp, { recursive: true, force: true });
}

console.log("\nResultado");
if (working.length === 0) {
  bad("Ninguna ruta de conversión funciona: solo se reproducirá en directo lo que admita el navegador.");
  process.exit(1);
}
ok(`Nebula usará: ${working[0]}${working[0] === "x264" ? " (solo CPU)" : " (GPU NVIDIA)"}`);
if (working[0] !== "nvenc-gpu" && enc.nvenc) info("La ruta con decodificación en GPU falló; irá algo más lento en vídeos 4K/HEVC. Suele ser el driver o la build de FFmpeg.");
console.log("");
