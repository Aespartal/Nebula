/** Reglas para que una biblioteca nunca recorra una unidad entera ni carpetas del sistema. */

/** Carpetas que el escáner no recorre nunca, a cualquier profundidad (comparación sin mayúsculas). */
const SKIP_DIRS = new Set([
  "$recycle.bin", "system volume information", "node_modules", ".git", "@eadir", "lost+found",
]);

export function isSkippedDir(name: string): boolean {
  return SKIP_DIRS.has(name.toLowerCase());
}

/** Primer nivel bajo una unidad de Windows que no puede ser una biblioteca (ni estar dentro de una). */
const WIN_SYSTEM_TOP = new Set([
  "windows", "program files", "program files (x86)", "programdata", "$recycle.bin", "system volume information", "recovery",
]);
const POSIX_SYSTEM_TOP = new Set([
  "bin", "boot", "dev", "etc", "lib", "lib64", "proc", "root", "run", "sbin", "sys", "usr", "var",
]);

export type UnsafeReason = "drive_root" | "system_folder";

/**
 * ¿Es peligroso usar esta ruta como biblioteca? Devuelve el motivo o null.
 * Rechaza la raíz de una unidad («D:\», «/») y las carpetas del sistema (y todo lo que cuelgue de ellas).
 */
export function unsafeLibraryRoot(input: string): UnsafeReason | null {
  const p = input.replace(/\\/g, "/").replace(/\/+/g, "/").toLowerCase().replace(/\/+$/, "");
  const win = /^([a-z]:)(\/.*)?$/.exec(p);
  if (win) {
    const rest = (win[2] ?? "").split("/").filter(Boolean);
    if (rest.length === 0) return "drive_root";
    return WIN_SYSTEM_TOP.has(rest[0]) ? "system_folder" : null;
  }
  if (p === "") return "drive_root"; // «/»
  const first = p.split("/").filter(Boolean)[0];
  return POSIX_SYSTEM_TOP.has(first) ? "system_folder" : null;
}
