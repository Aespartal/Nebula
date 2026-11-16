/** Limita los intentos fallidos de acceso (en memoria; se reinicia con el servidor). */
export class FailureLimiter {
  private readonly hits = new Map<string, { n: number; since: number }>();
  constructor(private readonly max: number, private readonly windowMs: number, private readonly now: () => number = Date.now) {}

  /** Segundos que faltan para poder reintentar, o 0 si puede intentarlo. */
  retryAfter(key: string): number {
    const h = this.hits.get(key);
    if (!h) return 0;
    const left = h.since + this.windowMs - this.now();
    if (left <= 0) { this.hits.delete(key); return 0; }
    return h.n >= this.max ? Math.ceil(left / 1000) : 0;
  }

  fail(key: string) {
    const t = this.now();
    const h = this.hits.get(key);
    if (!h || h.since + this.windowMs <= t) this.hits.set(key, { n: 1, since: t });
    else h.n++;
    if (this.hits.size > 5000) for (const [k, v] of this.hits) if (v.since + this.windowMs <= t) this.hits.delete(k);
  }

  reset(key: string) { this.hits.delete(key); }
}
