// Ajuste de sincronía de subtítulos. Se desplazan las líneas (cues) en el navegador; el servidor no se toca.
// Positivo = los subtítulos salen más tarde; negativo = más pronto.

export const OFFSET_STEP_S = 0.5;
export const OFFSET_MAX_S = 60;

/** Múltiplo de 0,5 s dentro de ±60 s (también limpia el ruido de coma flotante y los valores raros guardados). */
export const clampOffset = (s: number): number => {
  if (!Number.isFinite(s)) return 0;
  return Math.min(OFFSET_MAX_S, Math.max(-OFFSET_MAX_S, Math.round(s / OFFSET_STEP_S) * OFFSET_STEP_S)) || 0;
};

/** 0,5 → «+0,5 s»; -1.5 → «−1,5 s»; 0 → «0,0 s». */
export function formatOffset(s: number): string {
  if (s === 0) return "0,0 s";
  return `${s > 0 ? "+" : "−"}${Math.abs(s).toFixed(1).replace(".", ",")} s`;
}

export interface CueLike { startTime: number; endTime: number }
export type CueOriginals = WeakMap<object, { start: number; end: number }>;

/**
 * Coloca cada línea en su tiempo original + `offsetS`. Se parte siempre del tiempo original (guardado la primera vez que se ve
 * la línea), así que aplicar varias veces el mismo ajuste no acumula, y con 0 se vuelve exactamente a lo de origen.
 */
export function shiftCues(cues: ArrayLike<CueLike>, offsetS: number, originals: CueOriginals): void {
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    let o = originals.get(cue);
    if (!o) { o = { start: cue.startTime, end: cue.endTime }; originals.set(cue, o); }
    cue.startTime = Math.max(0, o.start + offsetS);
    cue.endTime = Math.max(0, o.end + offsetS);
  }
}
