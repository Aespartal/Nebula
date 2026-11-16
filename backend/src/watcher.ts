import { watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { SUB_EXTS, VIDEO_EXTS } from "./config.js";
import type { Db } from "./db/index.js";
import type { LibraryRow } from "./scanner.js";

export interface WatcherOptions {
  /** Silencio (ms) que se espera tras el último cambio antes de escanear; cubre las copias de archivos grandes. */
  debounceMs: number;
  /** Escaneo periódico de respaldo (carpetas de red, donde no llegan eventos). 0 = desactivado. */
  intervalMs: number;
  scan: (lib: LibraryRow) => Promise<unknown>;
  log: (msg: string) => void;
}

/** ¿Merece la pena escanear por este cambio? Vídeos, subtítulos y carpetas (sin extensión). */
export function isRelevant(file: string | null): boolean {
  if (!file) return true;
  const ext = path.extname(file).toLowerCase();
  return ext === "" || VIDEO_EXTS.has(ext) || SUB_EXTS.has(ext);
}

/** Vigila las carpetas de las bibliotecas y lanza un escaneo incremental cuando algo cambia. */
export class LibraryWatcher {
  private watchers = new Map<number, { root: string; w: FSWatcher }>();
  private timers = new Map<number, NodeJS.Timeout>();
  private interval?: NodeJS.Timeout;

  constructor(private db: Db, private o: WatcherOptions) {}

  /** Alinea los vigilantes con las bibliotecas de la base de datos (se llama al arrancar y al añadir una). */
  sync() {
    const libs = this.db.prepare("SELECT * FROM libraries").all() as LibraryRow[];
    const ids = new Set(libs.map((l) => l.id));
    for (const [id, cur] of this.watchers) {
      const lib = libs.find((l) => l.id === id);
      if (!lib || lib.root_path !== cur.root) { cur.w.close(); this.watchers.delete(id); }
    }
    for (const lib of libs) {
      if (this.watchers.has(lib.id)) continue;
      try {
        const w = watch(lib.root_path, { recursive: true, persistent: false }, (_ev, file) => {
          if (isRelevant(file ? String(file) : null)) this.schedule(lib.id);
        });
        w.on("error", (e) => { this.o.log(`vigilancia de «${lib.name}» detenida: ${e.message}`); w.close(); this.watchers.delete(lib.id); });
        this.watchers.set(lib.id, { root: lib.root_path, w });
      } catch (e) {
        this.o.log(`no se puede vigilar «${lib.name}» (${(e as Error).message}); usa el escaneo manual o SCAN_INTERVAL_MINUTES`);
      }
    }
    for (const id of this.timers.keys()) if (!ids.has(id)) { clearTimeout(this.timers.get(id)); this.timers.delete(id); }
    if (this.o.intervalMs > 0 && !this.interval) {
      this.interval = setInterval(() => { for (const l of this.libs()) this.schedule(l.id, 0); }, this.o.intervalMs);
      this.interval.unref();
    }
  }

  private libs() { return this.db.prepare("SELECT * FROM libraries").all() as LibraryRow[]; }

  /** Reinicia la cuenta atrás: varios eventos seguidos producen un único escaneo. */
  schedule(id: number, delay = this.o.debounceMs) {
    clearTimeout(this.timers.get(id));
    const t = setTimeout(() => void this.run(id), delay);
    t.unref();
    this.timers.set(id, t);
  }

  private async run(id: number) {
    this.timers.delete(id);
    const lib = this.libs().find((l) => l.id === id);
    if (!lib) return;
    try {
      await this.o.scan(lib);
    } catch (e) {
      // Ya había un escaneo en marcha: se reintenta cuando acabe, para no perder el cambio.
      if ((e as { statusCode?: number }).statusCode === 409) this.schedule(id, 5000);
      else this.o.log(`escaneo automático de «${lib.name}» falló: ${(e as Error).message}`);
    }
  }

  close() {
    for (const { w } of this.watchers.values()) w.close();
    for (const t of this.timers.values()) clearTimeout(t);
    if (this.interval) clearInterval(this.interval);
    this.watchers.clear(); this.timers.clear();
  }
}
