import type { TorrentClient, TorrentInfo } from "./client.js";

export interface TorrentSnapshot {
  /** ¿Respondió el cliente en el último intento? */
  connected: boolean;
  /** Último error de conexión, ya legible. */
  error?: string;
  torrents: TorrentInfo[];
  /** Instante (ms) del último sondeo que salió bien; null si aún no hubo ninguno. */
  updatedAt: number | null;
}

export interface TorrentServiceOptions {
  /** Sondeo mientras haya algo descargando (ms). */
  activeMs?: number;
  /** Sondeo cuando todo está quieto (ms). */
  idleMs?: number;
  /** Espera tras el primer fallo de conexión; se duplica en cada nuevo fallo hasta `maxBackoffMs`. */
  backoffMs?: number;
  maxBackoffMs?: number;
  /** Se llama una sola vez por torrent cuando termina de descargarse y está en su sitio. */
  onCompleted?: (t: TorrentInfo) => void | Promise<void>;
  /**
   * ¿Hay que avisar de que este torrent terminó? Por defecto solo los que se vieron incompletos mientras Nebula
   * estaba en marcha. La API lo sustituye por la base de datos para no perder los que acabaron con Nebula apagado.
   */
  shouldNotify?: (t: TorrentInfo) => boolean;
  log?: (msg: string) => void;
  now?: () => number;
}

/** ¿Sigue habiendo trabajo en curso? Decide si se sondea deprisa o despacio. */
export function isActive(t: TorrentInfo): boolean {
  if (t.state === "downloading" || t.state === "checking" || t.state === "moving") return true;
  return !t.done && (t.state === "queued" || t.state === "stalled");
}

/** Espera hasta el siguiente sondeo: rápido si algo está en curso, lento si no, y creciente si el cliente no responde. */
export function nextDelay(o: { active: boolean; failures: number; activeMs: number; idleMs: number; backoffMs: number; maxBackoffMs: number }): number {
  if (o.failures > 0) return Math.min(o.maxBackoffMs, o.backoffMs * 2 ** (o.failures - 1));
  return o.active ? o.activeMs : o.idleMs;
}

/** Terminar de verdad = descargado por completo y ya no moviéndose ni verificándose. */
function isFinished(t: TorrentInfo): boolean {
  return t.done && t.state !== "moving" && t.state !== "checking";
}

export class TorrentService {
  private snap: TorrentSnapshot = { connected: false, torrents: [], updatedAt: null };
  private timer?: NodeJS.Timeout;
  private running = false;
  private failures = 0;
  private polling?: Promise<void>;
  /** Torrents vistos sin terminar durante esta ejecución. */
  private seenIncomplete = new Set<string>();
  /** Torrents de los que ya se avisó (o que ya estaban terminados al empezar): nunca se avisa dos veces. */
  private notified = new Set<string>();
  private readonly o: Required<Pick<TorrentServiceOptions, "activeMs" | "idleMs" | "backoffMs" | "maxBackoffMs" | "now">> & TorrentServiceOptions;

  constructor(private client: TorrentClient, opts: TorrentServiceOptions = {}) {
    this.o = { activeMs: 3000, idleMs: 30_000, backoffMs: 5000, maxBackoffMs: 60_000, now: Date.now, ...opts };
  }

  snapshot(): TorrentSnapshot { return this.snap; }

  start() {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
  }

  /** Sondea ya (tras añadir, pausar o quitar algo) y reprograma el siguiente. Varias llamadas seguidas comparten un solo sondeo. */
  refresh(): Promise<void> {
    if (!this.polling) this.polling = this.poll().finally(() => { this.polling = undefined; });
    return this.polling;
  }

  private async loop() {
    await this.refresh();
    if (!this.running) return;
    const delay = nextDelay({
      active: this.snap.torrents.some(isActive), failures: this.failures,
      activeMs: this.o.activeMs, idleMs: this.o.idleMs, backoffMs: this.o.backoffMs, maxBackoffMs: this.o.maxBackoffMs,
    });
    this.timer = setTimeout(() => void this.loop(), delay);
    this.timer.unref();
  }

  private async poll(): Promise<void> {
    let torrents: TorrentInfo[];
    try {
      torrents = await this.client.list();
    } catch (e) {
      if (this.failures === 0) this.o.log?.(`el cliente de torrents no responde: ${(e as Error).message}`);
      this.failures++;
      this.snap = { ...this.snap, connected: false, error: (e as Error).message };
      return;
    }
    if (this.failures > 0) this.o.log?.("el cliente de torrents vuelve a responder");
    this.failures = 0;
    this.snap = { connected: true, torrents, updatedAt: this.o.now() };
    await this.detectCompleted(torrents);
  }

  private async detectCompleted(torrents: TorrentInfo[]) {
    const present = new Set(torrents.map((t) => t.hash));
    // Lo que el cliente ya no tiene deja de contar: si se vuelve a añadir, volverá a avisar al terminar.
    for (const h of [...this.seenIncomplete]) if (!present.has(h)) this.seenIncomplete.delete(h);
    for (const h of [...this.notified]) if (!present.has(h)) this.notified.delete(h);

    for (const t of torrents) {
      if (!isFinished(t)) {
        if (!t.done) this.seenIncomplete.add(t.hash);
        continue;
      }
      if (this.notified.has(t.hash)) continue;
      const wanted = this.o.shouldNotify ? this.o.shouldNotify(t) : this.seenIncomplete.has(t.hash);
      this.notified.add(t.hash); // se marca antes de avisar: un fallo en el aviso no debe repetirlo en bucle
      this.seenIncomplete.delete(t.hash);
      if (!wanted) continue;
      try {
        await this.o.onCompleted?.(t);
      } catch (e) {
        this.o.log?.(`falló el aviso de «${t.name}» completado: ${(e as Error).message}`);
      }
    }
  }
}
