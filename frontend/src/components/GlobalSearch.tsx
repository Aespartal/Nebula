import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { MovieSummary, SeriesSummary } from "@nebula/shared";
import { searchCatalog } from "../lib/globalSearch";
import { useApi } from "../lib/useApi";
import { Icon } from "./Icon";

/** Búsqueda en películas y series desde cualquier página. «/» o Ctrl/⌘+K la abren (salvo donde la página ya tiene su propio buscador). */
export function GlobalSearch() {
  const dlg = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  // El catálogo se pide al abrir por primera vez y se reutiliza mientras el diálogo siga montado.
  const [wanted, setWanted] = useState(false);
  const movies = useApi<MovieSummary[]>(wanted ? "/api/movies" : null);
  const series = useApi<SeriesSummary[]>(wanted ? "/api/series" : null);
  const hits = searchCatalog(movies.data ?? [], series.data ?? [], q);
  const failed = !!(movies.error || series.error);
  const loading = movies.loading || series.loading;

  function show() {
    setWanted(true);
    if (!dlg.current?.open) dlg.current?.showModal();
    setOpen(true);
    requestAnimationFrame(() => input.current?.select());
  }
  function close() { dlg.current?.close(); }

  useEffect(() => {
    const onKey = (e: KeyboardEvent | globalThis.KeyboardEvent) => {
      if (e.defaultPrevented) return; // el buscador de la propia página (Películas, Series) tiene preferencia
      const el = document.activeElement as HTMLElement | null;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(el?.tagName ?? "") || el?.isContentEditable;
      if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") || (e.key === "/" && !typing)) {
        e.preventDefault();
        show();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function go(to: string) { close(); nav(to); }

  function onInputKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") { e.preventDefault(); list.current?.querySelector<HTMLElement>("a,button")?.focus(); }
    else if (e.key === "Enter" && hits[0]) { e.preventDefault(); go(hits[0].to); }
  }
  function onListKey(e: KeyboardEvent<HTMLUListElement>) {
    const items = [...(list.current?.querySelectorAll<HTMLElement>("button") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") { e.preventDefault(); items[Math.min(items.length - 1, i + 1)]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); if (i <= 0) input.current?.focus(); else items[i - 1]?.focus(); }
  }

  return (
    <>
      <button type="button" onClick={show} aria-label="Buscar en el catálogo" title="Buscar (/ o Ctrl+K)"
        className="flex min-h-[var(--control-h)] min-w-[var(--control-h)] items-center justify-center rounded-ctl border border-line text-muted hover:border-muted hover:bg-raised hover:text-text">
        <Icon name="search" className="size-5" />
      </button>
      <dialog ref={dlg} aria-labelledby={`${id}-t`} onClose={() => { setOpen(false); setQ(""); }}
        onClick={(e) => { if (e.target === dlg.current) close(); }}
        className="fixed inset-x-0 top-[10vh] m-auto w-[min(40rem,calc(100vw-2rem))] max-w-none rounded-ctl border border-line bg-bg p-0 text-text backdrop:bg-black/70">
        {open && (
          <div className="p-4">
            <h2 id={`${id}-t`} className="label mb-1.5">Buscar películas y series</h2>
            <div className="relative">
              <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
              <input ref={input} type="search" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onInputKey}
                autoComplete="off" spellCheck={false} aria-label="Título"
                className="min-h-[var(--control-h)] w-full rounded-ctl border border-line bg-surface py-2 pl-9 pr-3 text-meta text-text placeholder:text-faint focus:border-muted" />
            </div>
            <p role="status" className="sr-only">{q.trim() && !loading ? `${hits.length} resultados` : ""}</p>
            {failed && <p className="mt-3 text-danger">No se pudo cargar el catálogo.</p>}
            {!failed && q.trim() && !loading && hits.length === 0 && <p className="mt-3 text-muted">No hay nada con ese nombre.</p>}
            {hits.length > 0 && (
              <ul ref={list} onKeyDown={onListKey} className="mt-3 max-h-[60vh] overflow-y-auto border-b border-rule">
                {hits.map((h) => (
                  <li key={`${h.kind}-${h.id}`}>
                    <button type="button" onClick={() => go(h.to)}
                      className="flex min-h-16 w-full items-center gap-3 border-t border-rule py-2 text-left hover:bg-surface focus:bg-surface">
                      {h.hasPoster
                        ? <img src={`/api/posters/${h.kind}/${h.id}`} alt="" loading="lazy" className="aspect-[2/3] w-9 shrink-0 object-cover" />
                        : <span aria-hidden="true" className="aspect-[2/3] w-9 shrink-0 border border-rule" />}
                      <span className="min-w-0 flex-1">
                        <span className="block font-bold [overflow-wrap:anywhere]">{h.title}</span>
                        <span className="block text-meta text-muted">{h.detail}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-meta text-muted">Intro abre el primero · ↓ recorre la lista · Esc cierra</p>
          </div>
        )}
      </dialog>
    </>
  );
}
