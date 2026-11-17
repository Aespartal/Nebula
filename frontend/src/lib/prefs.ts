import { clampOffset } from "./subtitleOffset";

// Preferencias ligeras de este navegador. El almacenamiento puede no estar disponible (modo privado): nunca debe romper la página.
function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* sin almacenamiento: no se recuerda */ }
}
function remove(key: string) {
  try { localStorage.removeItem(key); } catch { /* sin almacenamiento: nada que borrar */ }
}

/** null = nunca elegido; "" = el usuario eligió no tener subtítulos; "es" = idioma elegido. */
export const subtitlePref = { get: () => read("nebula.subtitleLang"), set: (v: string) => write("nebula.subtitleLang", v) };
export const audioPref = { get: () => read("nebula.audioLang"), set: (v: string) => write("nebula.audioLang", v) };

/** Desfase de subtítulos (en segundos) de cada pista de cada vídeo. Solo se guarda lo que no es 0, para no acumular claves. */
const offsetKey = (fileId: number, idx: number) => `nebula.subOffset.${fileId}.${idx}`;
export const subtitleOffsetPref = {
  get: (fileId: number, idx: number): number => {
    const raw = read(offsetKey(fileId, idx));
    return raw === null ? 0 : clampOffset(Number(raw));
  },
  set: (fileId: number, idx: number, seconds: number) => {
    const v = clampOffset(seconds);
    if (v === 0) remove(offsetKey(fileId, idx)); else write(offsetKey(fileId, idx), String(v));
  },
};
