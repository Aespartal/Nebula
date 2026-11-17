import { useId, useState, type FormEvent } from "react";
import type { MetadataCandidate } from "@nebula/shared";
import { sendJson } from "../lib/useApi";
import { Button } from "./Button";

type Kind = "movie" | "series";

function describe(code: string): string {
  if (code === "tmdb_not_configured") return "TMDB no está configurado. Añade la clave en Ajustes.";
  if (code === "tmdb_invalid_key") return "TMDB rechazó la clave. Revísala en Ajustes.";
  if (code === "tmdb_unavailable") return "TMDB no responde ahora mismo. Prueba en un rato.";
  if (code === "tmdb_not_found") return "TMDB ya no tiene esa ficha.";
  if (code === "network") return "No se pudo conectar con el servidor de Nebula.";
  return "No se pudo completar la acción.";
}

/** Solo administradores: busca en TMDB y fija a mano la ficha correcta (el refresco automático ya no la toca). */
export function FixMetadata({ kind, id, title, year, locked, onChanged }: {
  kind: Kind; id: number; title: string; year?: number | null; locked: boolean; onChanged: () => void;
}) {
  const uid = useId();
  const [q, setQ] = useState(title);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<MetadataCandidate[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function search(e: FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true); setMsg(null);
    const qs = new URLSearchParams({ kind, q: q.trim() });
    const r = await sendJson<MetadataCandidate[]>("GET", `/api/metadata/search?${qs}`);
    setBusy(false);
    if (!r.ok) { setResults(null); setMsg({ ok: false, text: describe(r.code) }); return; }
    setResults(r.data);
    if (r.data.length === 0) setMsg({ ok: false, text: "TMDB no encuentra nada con ese nombre. Prueba con el título original." });
  }

  async function assign(tmdbId: number | null, done: string) {
    setBusy(true); setMsg(null);
    const r = await sendJson("PUT", `/api/metadata/${kind}/${id}`, { tmdbId });
    setBusy(false);
    if (!r.ok) { setMsg({ ok: false, text: describe(r.code) }); return; }
    setResults(null);
    setMsg({ ok: true, text: done });
    onChanged();
  }

  async function unlock() {
    setBusy(true); setMsg(null);
    const r = await sendJson("DELETE", `/api/metadata/${kind}/${id}/lock`);
    setBusy(false);
    if (!r.ok) { setMsg({ ok: false, text: describe(r.code) }); return; }
    setMsg({ ok: true, text: "Vuelve al modo automático: Nebula la buscará sola en TMDB." });
    onChanged();
  }

  return (
    <details className="mt-6 max-w-2xl">
      <summary className="min-h-[var(--control-h)] cursor-pointer py-2 font-bold">
        Corregir carátula y sinopsis{locked && <span className="ml-2 font-mono text-label font-normal text-muted">FIJADA A MANO</span>}
      </summary>
      <form onSubmit={search} className="mt-2 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <div>
          <label htmlFor={`${uid}-q`} className="mb-1 block text-meta font-bold text-soft">Buscar en TMDB</label>
          <input id={`${uid}-q`} value={q} onChange={(e) => setQ(e.target.value)} maxLength={200} className="field" />
        </div>
        <Button type="submit" variant="secondary" disabled={busy} aria-busy={busy}>{busy ? "Buscando…" : "Buscar"}</Button>
      </form>

      {results && results.length > 0 && (
        <ul className="mt-4 border-b border-rule">
          {results.map((c) => (
            <li key={c.tmdbId} className="flex gap-4 border-t border-rule py-3">
              {c.posterPath
                ? <img src={`/api/metadata/candidate-poster?path=${encodeURIComponent(c.posterPath)}`} alt="" loading="lazy" className="aspect-[2/3] w-16 shrink-0 self-start object-cover" />
                : <span aria-hidden="true" className="aspect-[2/3] w-16 shrink-0 self-start border border-rule" />}
              <div className="min-w-0 flex-1">
                <p className="font-bold [overflow-wrap:anywhere]">
                  {c.title}{c.year ? <span className="font-normal text-muted"> ({c.year})</span> : null}
                </p>
                {c.originalTitle && c.originalTitle !== c.title && <p className="text-meta text-muted">{c.originalTitle}</p>}
                {c.overview && <p className="mt-1 line-clamp-3 text-muted">{c.overview}</p>}
                <p className="mt-1 font-mono text-label text-faint">TMDB {c.tmdbId}</p>
              </div>
              <Button variant="secondary" disabled={busy} className="self-start"
                onClick={() => assign(c.tmdbId, `Datos de «${c.title}» aplicados y fijados.`)}>
                Usar<span className="sr-only"> «{c.title}»{c.year ? ` (${c.year})` : ""}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <Button variant="secondary" disabled={busy} onClick={() => assign(null, "Sin ficha de TMDB. Nebula no volverá a buscarla sola.")}>Ninguna coincide</Button>
        {locked && <Button variant="secondary" disabled={busy} onClick={unlock}>Volver al modo automático</Button>}
      </div>
      <p role="status" className={`mt-2 min-h-6 ${msg && !msg.ok ? "text-danger" : "text-muted"}`}>{msg?.text}</p>
      <p className="text-muted">El título y el año siguen siendo los del archivo. Una ficha fijada no cambia al actualizar desde TMDB.</p>
    </details>
  );
}
