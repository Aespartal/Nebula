import { useId, useRef, useState, type FormEvent } from "react";
import type { SubtitleUploadResult } from "@nebula/shared";
import { languageName } from "../lib/lang";
import { sendBytes } from "../lib/useApi";
import { Button } from "./Button";

const LANGS = ["es", "en", "fr", "it", "de", "pt", "ca", "gl", "eu"];
const MAX_BYTES = 2 * 1024 * 1024; // el mismo tope que el servidor

function describe(code: string, status: number | undefined, lang: string): string {
  if (status === 409) return `Ya hay subtítulos en ${languageName(lang).toLowerCase()} para este vídeo. Si quieres sustituirlos, bórralos de la carpeta de la biblioteca.`;
  if (status === 422) return "Ese archivo no parece un .srt válido (no tiene marcas de tiempo).";
  if (status === 413) return "El archivo es demasiado grande para ser un subtítulo (máximo 2 MB).";
  if (status === 403) return "Solo los administradores pueden añadir subtítulos.";
  if (code === "write_failed") return "No se pudo guardar junto al vídeo. ¿La carpeta de la biblioteca es de solo lectura?";
  if (code === "network") return "No se pudo conectar con el servidor de Nebula.";
  return "No se pudo añadir el subtítulo.";
}

/** Solo administradores: guarda un .srt junto al vídeo y lo deja disponible al instante. */
export function SubtitleUpload({ fileId, onUploaded }: { fileId: number; onUploaded: (r: SubtitleUploadResult) => void }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [lang, setLang] = useState("es");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const file = input.current?.files?.[0];
    if (!file) { setMsg({ ok: false, text: "Elige primero un archivo .srt." }); return; }
    if (!/\.srt$/i.test(file.name)) { setMsg({ ok: false, text: "Solo se admiten archivos .srt." }); return; }
    if (file.size > MAX_BYTES) { setMsg({ ok: false, text: describe("", 413, lang) }); return; }
    setBusy(true); setMsg(null);
    const r = await sendBytes<SubtitleUploadResult>(`/api/files/${fileId}/subtitles?lang=${lang}`, await file.arrayBuffer());
    setBusy(false);
    if (!r.ok) { setMsg({ ok: false, text: describe(r.code, r.status, lang) }); return; }
    if (input.current) input.current.value = "";
    setMsg({ ok: true, text: `Subtítulos en ${languageName(lang).toLowerCase()} añadidos y activados.` });
    onUploaded(r.data);
  }

  return (
    <details className="mt-6 max-w-2xl">
      <summary className="min-h-[var(--control-h)] cursor-pointer py-2 font-bold">Añadir subtítulos (.srt)</summary>
      <form onSubmit={submit} className="mt-2 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <div>
          <label htmlFor={`${id}-file`} className="mb-1 block text-meta font-bold text-soft">Archivo .srt</label>
          <input id={`${id}-file`} ref={input} type="file" accept=".srt" className="field py-2" />
        </div>
        <div>
          <label htmlFor={`${id}-lang`} className="mb-1 block text-meta font-bold text-soft">Idioma</label>
          <select id={`${id}-lang`} value={lang} onChange={(e) => setLang(e.target.value)} className="field">
            {LANGS.map((l) => <option key={l} value={l}>{languageName(l)}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" variant="secondary" disabled={busy} aria-busy={busy}>{busy ? "Subiendo…" : "Añadir subtítulos"}</Button>
          <p role="status" className={`mt-2 min-h-6 ${msg && !msg.ok ? "text-danger" : "text-muted"}`}>{msg?.text}</p>
          <p className="text-muted">Se guarda junto al vídeo como «nombre.{lang}.srt», en UTF-8. Nunca sustituye a un subtítulo que ya exista.</p>
        </div>
      </form>
    </details>
  );
}
