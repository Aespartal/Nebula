export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Minúsculas y sin acentos, para buscar "pelicula" y encontrar "Película". */
export const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

export function formatDuration(totalSeconds: number | null): string {
  if (!totalSeconds) return "—";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.round((totalSeconds % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

export function formatSize(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1).replace(".", ",")} GB`;
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}

// Tonos de cartel (oscuros, texto crema con contraste >= 5.9:1).
const TINTS = ["#7a2e1d", "#4a5726", "#7d5210", "#1f4a52", "#5b2a45", "#5a4634", "#2f3f66", "#6a2230"];
export function tintFor(key: string): string {
  // FNV-1a + mezcla final: reparte bien incluso títulos parecidos.
  let h = 2166136261;
  for (const c of key) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  h ^= h >>> 15; h = Math.imul(h, 2246822507); h ^= h >>> 13;
  return TINTS[(h >>> 0) % TINTS.length];
}

/** 3725 → "1:02:05"; 125 → "2:05". Para decir «retomando en…». */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

/** Para mostrar junto al título: texto, no solo color ni icono. */
export function watchLabel(watched: boolean, progress: number): string | null {
  if (watched) return "Vista";
  if (progress >= 0.02) return `Vista al ${Math.round(progress * 100)} %`;
  return null;
}
