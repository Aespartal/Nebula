import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { Db } from "../db/index.js";

/** Fotogramas clave de un vídeo. `pts` en segundos; `delay` = cuánto va el dts por detrás del pts en un keyframe (retardo de B-frames). */
export interface KeyframeData { pts: number[]; delay: number }

/** Duración objetivo de cada segmento; los cortes caen en el primer keyframe que llega a ese tiempo. */
export const REMUX_TARGET_S = 6;
/** Si el original tiene tan pocos keyframes que algún segmento pasaría de esto, el remux no compensa (arranque y saltos lentos). */
export const REMUX_MAX_SEGMENT_S = 30;

const median = (xs: number[]) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/** Interpreta la salida CSV de ffprobe (`pts_time,dts_time,flags`), quedándose solo con los keyframes. */
export function parseKeyframeCsv(lines: Iterable<string>): KeyframeData {
  const pts: number[] = [];
  const leads: number[] = [];
  for (const line of lines) {
    const [p, d, flags] = line.trim().split(",");
    if (!flags || !flags.includes("K")) continue;
    const pt = Number(p);
    if (p === "N/A" || !Number.isFinite(pt)) continue;
    pts.push(pt);
    const dt = Number(d);
    if (d !== "N/A" && Number.isFinite(dt) && pt - dt >= 0) leads.push(pt - dt);
  }
  pts.sort((a, b) => a - b);
  const uniq = pts.filter((t, i) => i === 0 || t - pts[i - 1] > 1e-6);
  // Un valor absurdo (>1 s) indicaría marcas de tiempo raras: mejor 0 y que el reproductor tolere el solape.
  const delay = Math.min(median(leads), 1);
  return { pts: uniq, delay: Math.round(delay * 1000) / 1000 };
}

/**
 * Límites de segmento: el primer keyframe, y después el primero que esté al menos `target` segundos tras el anterior.
 * El último límite es la duración. null si no se puede segmentar con garantías.
 */
export function planSegments(kf: number[], durationS: number, target = REMUX_TARGET_S, maxSegment = REMUX_MAX_SEGMENT_S): number[] | null {
  if (!(durationS > 0) || kf.length < 2) return null;
  const bounds = [kf[0]];
  for (const t of kf) {
    if (t >= durationS - 0.5) break; // un keyframe pegado al final no justifica otro segmento
    if (t - bounds[bounds.length - 1] >= target - 1e-6) bounds.push(t);
  }
  // Resto final muy corto: se absorbe en el segmento anterior.
  if (bounds.length > 1 && durationS - bounds[bounds.length - 1] < 1) bounds.pop();
  bounds.push(durationS);
  for (let i = 1; i < bounds.length; i++) if (bounds[i] - bounds[i - 1] > maxSegment) return null;
  return bounds;
}

/** Lee todos los paquetes de vídeo (sin decodificar) y devuelve sus keyframes. Para un archivo grande tarda: por eso se guarda. */
export function probeKeyframes(ffprobePath: string, file: string, videoIdx: number, timeoutMs = 10 * 60_000): Promise<KeyframeData> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffprobePath, [
      "-v", "error", "-select_streams", String(videoIdx),
      "-show_entries", "packet=pts_time,dts_time,flags", "-of", "csv=p=0", file,
    ], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const lines: string[] = [];
    let err = "";
    const timer = setTimeout(() => { proc.kill(); reject(new Error("ffprobe tardó demasiado")); }, timeoutMs);
    proc.stderr.on("data", (d) => { err = (err + d).slice(-1000); });
    createInterface({ input: proc.stdout }).on("line", (l) => { if (l.includes("K")) lines.push(l); });
    proc.on("error", (e) => { clearTimeout(timer); reject(e); });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(err.trim().split("\n")[0] || `ffprobe terminó con código ${code}`));
      resolve(parseKeyframeCsv(lines));
    });
  });
}

/**
 * Índice de keyframes en SQLite. La primera vez que se pide un archivo se calcula (puede tardar decenas de segundos);
 * el cálculo sigue en segundo plano aunque quien lo pidió deje de esperar, así la siguiente reproducción ya lo tiene.
 */
export class KeyframeIndex {
  private readonly jobs = new Map<number, Promise<KeyframeData | null>>();
  private queue: Promise<unknown> = Promise.resolve(); // de uno en uno: leer archivos enteros en paralelo satura el disco

  constructor(
    private readonly db: Db,
    private readonly ffprobePath: string,
    private readonly probe: typeof probeKeyframes = probeKeyframes,
    private readonly log: (msg: string) => void = () => {},
  ) {}

  cached(fileId: number): KeyframeData | null {
    const row = this.db.prepare(`
      SELECT k.data, k.video_idx AS videoIdx, k.mtime_ms AS kMtime, k.size_bytes AS kSize, f.mtime_ms AS mtime, f.size_bytes AS size
      FROM keyframe_index k JOIN media_files f ON f.id = k.file_id WHERE k.file_id = ?`).get(fileId) as
      { data: string; videoIdx: number; kMtime: number; kSize: number; mtime: number; size: number } | undefined;
    if (!row || row.kMtime !== row.mtime || row.kSize !== row.size) return null; // el archivo cambió desde entonces
    try { return JSON.parse(row.data) as KeyframeData; } catch { return null; }
  }

  /** Los keyframes del vídeo `videoIdx` de ese archivo; espera como mucho `waitMs`. null si no están a tiempo o falló. */
  async get(fileId: number, file: string, videoIdx: number, waitMs: number): Promise<KeyframeData | null> {
    const hit = this.cached(fileId);
    if (hit) return hit;
    let job = this.jobs.get(fileId);
    if (!job) {
      job = this.queue.then(() => this.compute(fileId, file, videoIdx)).finally(() => this.jobs.delete(fileId));
      this.queue = job.catch(() => {});
      this.jobs.set(fileId, job);
    }
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<null>((r) => { timer = setTimeout(() => r(null), waitMs); });
    try { return await Promise.race([job, timeout]); } finally { clearTimeout(timer); }
  }

  private async compute(fileId: number, file: string, videoIdx: number): Promise<KeyframeData | null> {
    const meta = this.db.prepare("SELECT mtime_ms AS mtime, size_bytes AS size FROM media_files WHERE id = ?").get(fileId) as
      { mtime: number; size: number } | undefined;
    if (!meta) return null;
    const started = Date.now();
    try {
      const data = await this.probe(this.ffprobePath, file, videoIdx);
      // Si el archivo desapareció del catálogo mientras se leía, la fila ya no existe y no se guarda nada.
      this.db.prepare(`
        INSERT INTO keyframe_index(file_id, mtime_ms, size_bytes, video_idx, data)
        SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM media_files WHERE id = ?)
        ON CONFLICT(file_id) DO UPDATE SET mtime_ms=excluded.mtime_ms, size_bytes=excluded.size_bytes, video_idx=excluded.video_idx, data=excluded.data`)
        .run(fileId, meta.mtime, meta.size, videoIdx, JSON.stringify(data), fileId);
      this.log(`índice de keyframes del archivo ${fileId}: ${data.pts.length} en ${((Date.now() - started) / 1000).toFixed(1)} s`);
      return data;
    } catch (e) {
      this.log(`no se pudo indexar los keyframes del archivo ${fileId}: ${(e as Error).message}`);
      return null;
    }
  }
}
