import { useEffect, useState } from "react";
import type { MetadataStatus } from "@nebula/shared";
import { sendJson, useApi } from "../lib/useApi";
import { Button } from "./Button";
import { ErrorBox, Loading } from "./States";

const ERRORS: Record<NonNullable<MetadataStatus["lastError"]>, string> = {
  invalid_key: "TMDB ha rechazado la clave. Revisa que la hayas copiado completa y reinicia Nebula.",
  network: "No se pudo conectar con TMDB. Se volverá a intentar la próxima vez que busques.",
};

export function MetadataSection() {
  const { data: st, error, loading, reload } = useApi<MetadataStatus>("/api/metadata/status");
  const [busy, setBusy] = useState(false);
  const [wasRunning, setWasRunning] = useState(false);
  const [msg, setMsg] = useState("");

  // Mientras Nebula busca, se consulta el estado cada pocos segundos.
  useEffect(() => {
    if (!st?.running) return;
    const t = setInterval(reload, 3000);
    return () => clearInterval(t);
  }, [st?.running, reload]);

  useEffect(() => {
    if (st?.running) setWasRunning(true);
    else if (wasRunning && st) { setWasRunning(false); setMsg("Búsqueda terminada."); }
  }, [st, wasRunning]);

  async function start(force: boolean) {
    setBusy(true); setMsg("");
    const r = await sendJson("POST", "/api/metadata/refresh", { force });
    setBusy(false);
    if (r.ok) { setMsg("Buscando…"); reload(); } else setMsg("No se pudo iniciar la búsqueda.");
  }

  return (
    <section aria-labelledby="meta" className="mt-10 max-w-2xl border-t border-rule pt-8">
      <h2 id="meta" className="text-lg font-bold tracking-tight">Carátulas y sinopsis</h2>
      {loading && !st && <Loading />}
      {error && <ErrorBox message={error} onRetry={reload} />}

      {st && !st.enabled && (
        <div className="mt-3 space-y-3">
          <p>Nebula puede poner carátulas y sinopsis a tus películas y series usando <strong>TMDB</strong>, una base de datos gratuita. Hace falta una clave personal:</p>
          <ol className="list-decimal space-y-1 pl-6">
            <li>Crea una cuenta gratuita en <a className="underline underline-offset-4" href="https://www.themoviedb.org/signup" target="_blank" rel="noreferrer">themoviedb.org<span className="sr-only"> (se abre en otra pestaña)</span></a>.</li>
            <li>En <em>Ajustes → API</em> de tu cuenta, pide una clave y copia la «clave de API» o el «token de acceso de lectura».</li>
            <li>Cierra Nebula y vuelve a abrirlo con la clave. En Windows (cmd): <code className="break-all">set TMDB_API_KEY=tu_clave</code> y después <code>npm run dev:backend</code>.</li>
          </ol>
          <p className="text-muted">La clave se queda en tu equipo. A TMDB solo se le envía el título (y el año) de lo que buscas; nunca tus archivos ni tus cuentas.</p>
        </div>
      )}

      {st?.enabled && (
        <>
          <ul className="mt-3">
            <li className="border-t border-rule py-3">
              <span className="font-bold">Películas</span>: {st.movies.withPoster} de {st.movies.total} con carátula
            </li>
            <li className="border-y border-rule py-3">
              <span className="font-bold">Series</span>: {st.series.withPoster} de {st.series.total} con carátula
            </li>
          </ul>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <Button onClick={() => start(false)} disabled={busy || st.running} aria-busy={st.running}>
              {st.running ? "Buscando…" : "Buscar las que faltan"}
            </Button>
            <Button variant="secondary" onClick={() => start(true)} disabled={busy || st.running}>Volver a buscar todo</Button>
          </div>
          <p className="mt-2 text-muted">Nebula también busca solo cuando se añaden títulos nuevos. Lo que no se encuentra se reintenta cada semana.</p>
          <div role={st.lastError ? "alert" : "status"} className="mt-2 min-h-7">
            {st.lastError ? <p className="msg-error">{ERRORS[st.lastError]}</p>
              : (st.running || msg) && <p className="msg-info">{st.running ? "Buscando… puede tardar unos minutos si tienes muchos títulos." : msg}</p>}
          </div>
        </>
      )}

      <p className="mt-6 text-muted">
        Este producto usa la API de TMDB pero no está avalado ni certificado por TMDB.{" "}
        <a className="underline underline-offset-4" href="https://www.themoviedb.org" target="_blank" rel="noreferrer">themoviedb.org<span className="sr-only"> (se abre en otra pestaña)</span></a>
      </p>
    </section>
  );
}
