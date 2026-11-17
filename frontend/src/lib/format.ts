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

/** 1 288 490 188 160 → "1,17 TB". Para discos: potencias de 1024, como el Explorador. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 4) return `${(bytes / 1024 ** 4).toFixed(2).replace(".", ",")} TB`;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1).replace(".", ",")} GB`;
  return `${Math.max(0, Math.round(bytes / 1024 ** 2))} MB`;
}

/** 1 572 864 → "1,5 MB/s". */
export function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond >= 1024 ** 2) return `${(bytesPerSecond / 1024 ** 2).toFixed(1).replace(".", ",")} MB/s`;
  return `${Math.round(bytesPerSecond / 1024)} KB/s`;
}

/** Tiempo que falta para terminar, en palabras: "45 s", "12 min", "2 h 10 min". null = no se sabe. */
export function formatEta(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

/** «ahora», «hace 5 min», «hace 3 h», «hace 2 d», «hace 4 meses»: cuándo entró algo en el catálogo. */
export function formatAgo(ms: number, now = Date.now()): string {
  const min = Math.floor((now - ms) / 60000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `hace ${d} d`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `hace ${mo} ${mo === 1 ? "mes" : "meses"}`;
  const y = Math.max(1, Math.floor(d / 365));
  return `hace ${y} ${y === 1 ? "año" : "años"}`;
}
