// Preferencias ligeras de este navegador. El almacenamiento puede no estar disponible (modo privado): nunca debe romper la página.
function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* sin almacenamiento: no se recuerda */ }
}

/** null = nunca elegido; "" = el usuario eligió no tener subtítulos; "es" = idioma elegido. */
export const subtitlePref = { get: () => read("nebula.subtitleLang"), set: (v: string) => write("nebula.subtitleLang", v) };
export const audioPref = { get: () => read("nebula.audioLang"), set: (v: string) => write("nebula.audioLang", v) };
