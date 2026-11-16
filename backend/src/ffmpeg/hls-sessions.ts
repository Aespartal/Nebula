import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { buildHlsArgs, buildPlaylist, segmentCount, segmentName, type ProfileName } from "./args.js";

export interface SessionParams {
  fileId: number;
  input: string;
  durationS: number;
  videoIdx: number;
  audioIdx: number | null;
  sourceWidth: number | null;
  sourceHeight: number | null;
  maxHeight: number;
}

export interface HlsOptions {
  ffmpegPath: string;
  baseDir: string;
  profiles: ProfileName[];
  segDur?: number;
  /** Segmentos que produce cada ejecución de FFmpeg (limita lo que se adelanta al reproductor). */
  window?: number;
  maxSessions?: number;
  idleMs?: number;
  firstSegmentTimeoutMs?: number;
  log?: (msg: string) => void;
}

interface Run {
  proc: ChildProcess;
  startSeg: number;
  endSeg: number;
  profile: ProfileName;
  /** Posición de `profile` en la lista de rutas. */
  idx: number;
  killed: boolean;
  stderr: string;
}

export interface Session {
  id: string;
  params: SessionParams;
  dir: string;
  total: number;
  run: Run | null;
  failed: boolean;
  closed: boolean;
  lastAccess: number;
  lastRequested: number;
}

const PREFETCH = 6; // segmentos por delante de la reproducción que se mantienen listos
const KEEP_BEHIND = 20; // segmentos ya vistos que se conservan en disco

const exists = (f: string) => access(f).then(() => true, () => false);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class HlsSessions {
  readonly segDur: number;
  private readonly window: number;
  private readonly maxSessions: number;
  private readonly idleMs: number;
  private readonly firstSegmentTimeoutMs: number;
  private readonly sessions = new Map<string, Session>();
  private profileIdx = 0;
  /** Rutas que ya han terminado alguna conversión completa en esta máquina. */
  private readonly proven = new Set<ProfileName>();
  private readonly softFails = new Map<ProfileName, number>();
  private sweeper: NodeJS.Timeout | null = null;

  constructor(private readonly o: HlsOptions) {
    this.segDur = o.segDur ?? 6;
    this.window = o.window ?? 10;
    this.maxSessions = o.maxSessions ?? 3;
    this.idleMs = o.idleMs ?? 15 * 60_000;
    this.firstSegmentTimeoutMs = o.firstSegmentTimeoutMs ?? 60_000;
  }

  private log(msg: string) { this.o.log?.(msg); }

  async init() {
    await rm(this.o.baseDir, { recursive: true, force: true }); // restos de ejecuciones anteriores
    await mkdir(this.o.baseDir, { recursive: true });
    this.sweeper = setInterval(() => this.sweep(), 30_000);
    this.sweeper.unref();
  }

  get activeCount() { return this.sessions.size; }

  /** Perfil de conversión en uso ("nvenc" o "x264"). */
  get encoder(): "nvenc" | "x264" {
    return this.o.profiles[this.profileIdx]?.startsWith("nvenc") ? "nvenc" : "x264";
  }

  async create(params: SessionParams): Promise<Session> {
    for (const s of this.sessions.values()) {
      const p = s.params;
      if (!s.failed && !s.closed && p.input === params.input && p.audioIdx === params.audioIdx && p.maxHeight === params.maxHeight) {
        s.lastAccess = Date.now();
        return s;
      }
    }
    while (this.sessions.size >= this.maxSessions) {
      const oldest = [...this.sessions.values()].sort((a, b) => a.lastAccess - b.lastAccess)[0];
      await this.stop(oldest.id);
    }
    const id = randomUUID();
    const dir = path.join(this.o.baseDir, id);
    await mkdir(dir, { recursive: true });
    const s: Session = {
      id, params, dir, total: segmentCount(params.durationS, this.segDur),
      run: null, failed: false, closed: false, lastAccess: Date.now(), lastRequested: 0,
    };
    this.sessions.set(id, s);
    return s;
  }

  get(id: string): Session | undefined {
    const s = this.sessions.get(id);
    if (s) s.lastAccess = Date.now();
    return s;
  }

  playlist(s: Session): string {
    return buildPlaylist(s.params.durationS, this.segDur);
  }

  /** Ruta del segmento n, produciéndolo si hace falta. null si no se pudo. */
  async segment(s: Session, n: number): Promise<string | null> {
    s.lastAccess = Date.now();
    if (n < 0 || n >= s.total || s.closed) return null;
    s.lastRequested = n;
    const file = path.join(s.dir, segmentName(n));

    if (await exists(file)) {
      void this.afterServe(s, n);
      return file;
    }
    if (!(await this.covers(s, n))) this.start(s, n);

    const deadline = Date.now() + this.firstSegmentTimeoutMs;
    while (Date.now() < deadline) {
      if (s.failed || s.closed) return null;
      if (await exists(file)) {
        void this.afterServe(s, n);
        return file;
      }
      if (!s.run) this.start(s, n); // la ejecución terminó o murió sin llegar a este segmento
      await sleep(100);
    }
    return null;
  }

  private async covers(s: Session, n: number): Promise<boolean> {
    const r = s.run;
    if (!r || n < r.startSeg || n >= r.endSeg) return false;
    let next = r.startSeg;
    while (next < r.endSeg && (await exists(path.join(s.dir, segmentName(next))))) next++;
    return n - next <= 3; // si está lejos de lo producido, es más rápido saltar a n
  }

  private start(s: Session, n: number, idx = this.profileIdx) {
    this.kill(s);
    const profile = this.o.profiles[idx];
    if (!profile) { s.failed = true; return; }
    const segCount = Math.min(this.window, s.total - n);
    const args = buildHlsArgs({
      input: s.params.input, startSeg: n, segCount, segDur: this.segDur,
      videoIdx: s.params.videoIdx, audioIdx: s.params.audioIdx,
      sourceWidth: s.params.sourceWidth, sourceHeight: s.params.sourceHeight,
      maxHeight: s.params.maxHeight, profile,
    });
    this.log(`ffmpeg [${profile}] sesión ${s.id.slice(0, 8)} segmentos ${n}-${n + segCount - 1}`);
    const proc = spawn(this.o.ffmpegPath, args, { cwd: s.dir, stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    const run: Run = { proc, startSeg: n, endSeg: n + segCount, profile, idx, killed: false, stderr: "" };
    s.run = run;
    proc.stderr!.on("data", (d) => { run.stderr = (run.stderr + d).slice(-4000); });

    let done = false;
    const finish = async (code: number | null) => {
      if (done) return;
      done = true;
      if (s.run === run) s.run = null;
      if (run.killed || s.closed) return;
      if (code !== 0) {
        const produced = await exists(path.join(s.dir, segmentName(run.startSeg)));
        this.log(`ffmpeg [${run.profile}] terminó con código ${code} (segmentos ${run.startSeg}-${run.endSeg - 1}): ${run.stderr.trim().split("\n").slice(-8).join(" | ")}`);
        if (!produced) {
          this.demoteIfDeserved(run);
          const next = run.idx + 1;
          if (next >= this.o.profiles.length) { s.failed = true; return; }
          this.log(`probando ruta alternativa para este tramo: ${this.o.profiles[next]}`);
          this.start(s, run.startSeg, next);
        }
        return; // si falló a mitad, la siguiente petición reinicia
      }
      this.proven.add(run.profile);
      void this.prefetch(s, s.lastRequested);
    };
    proc.on("error", (e) => { run.stderr += String(e); void finish(-1); });
    proc.on("exit", (code) => void finish(code));
  }

  /**
   * Una ruta que nunca ha funcionado se descarta de inmediato. Una que ya convirtió bien
   * (p. ej. falla solo al final del vídeo o tras un salto) solo se descarta tras varios fallos,
   * para que un tramo problemático no deje a toda la máquina en la ruta lenta.
   */
  private demoteIfDeserved(run: Run) {
    if (this.profileIdx !== run.idx) return;
    if (!this.proven.has(run.profile)) { this.profileIdx++; return; }
    const n = (this.softFails.get(run.profile) ?? 0) + 1;
    this.softFails.set(run.profile, n);
    if (n >= 3) {
      this.profileIdx++;
      this.log(`la ruta ${run.profile} ha fallado ${n} veces: se deja de usar`);
    }
  }

  private kill(s: Session) {
    if (s.run) {
      s.run.killed = true;
      s.run.proc.kill();
      s.run = null;
    }
  }

  private async prefetch(s: Session, n: number) {
    if (s.run || s.failed || s.closed) return;
    for (let m = n + 1; m <= Math.min(s.total - 1, n + PREFETCH); m++) {
      if (!(await exists(path.join(s.dir, segmentName(m))))) {
        if (!s.run && !s.closed) this.start(s, m);
        return;
      }
    }
  }

  private async afterServe(s: Session, n: number) {
    await this.prefetch(s, n);
    // Liberar disco: se borran los segmentos ya vistos (si se retrocede, se regeneran).
    try {
      for (const f of await readdir(s.dir)) {
        const m = /^seg_(\d{5})\.ts$/.exec(f);
        if (m && Number(m[1]) < n - KEEP_BEHIND) await rm(path.join(s.dir, f), { force: true });
      }
    } catch { /* la sesión pudo cerrarse mientras tanto */ }
  }

  async stop(id: string) {
    const s = this.sessions.get(id);
    if (!s) return;
    s.closed = true;
    this.kill(s);
    this.sessions.delete(id);
    await rm(s.dir, { recursive: true, force: true }).catch(() => {});
  }

  private sweep() {
    const now = Date.now();
    for (const s of this.sessions.values()) if (now - s.lastAccess > this.idleMs) void this.stop(s.id);
  }

  async shutdown() {
    if (this.sweeper) clearInterval(this.sweeper);
    await Promise.all([...this.sessions.keys()].map((id) => this.stop(id)));
    await rm(this.o.baseDir, { recursive: true, force: true }).catch(() => {});
  }
}
