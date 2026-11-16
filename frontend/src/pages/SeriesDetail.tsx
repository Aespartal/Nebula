import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { SeriesDetail as SeriesDetailData } from "@nebula/shared";
import { Icon } from "../components/Icon";
import { ErrorBox, Loading } from "../components/States";
import { Button } from "../components/Button";
import { plural } from "../lib/format";
import { useFocusWhen } from "../lib/useFocusWhen";
import { usePageTitle } from "../lib/usePageTitle";
import { sendJson, useApi } from "../lib/useApi";

export default function SeriesDetail() {
  const { id } = useParams();
  const { data, error, loading, reload } = useApi<SeriesDetailData>(`/api/series/${id}`);
  usePageTitle(data?.title);
  const h1 = useRef<HTMLHeadingElement>(null);
  useFocusWhen(h1, !!data);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const all = data?.seasons.flatMap((s) => s.episodes) ?? [];
  const allWatched = all.length > 0 && all.every((e) => e.watched);

  async function markAll() {
    setBusy(true);
    const r = await sendJson("POST", `/api/series/${id}/watched`, { watched: !allWatched });
    setBusy(false);
    if (r.ok) { setNote(allWatched ? "Serie marcada como no vista." : "Serie marcada como vista."); reload(); }
    else setNote("No se pudo cambiar el estado de la serie.");
  }

  return (
    <>
      <Link to="/series" className="mb-4 inline-flex min-h-12 items-center gap-1 font-bold text-muted hover:text-text">
        <Icon name="back" className="size-5" /> Todas las series
      </Link>
      {loading && <Loading />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && (
        <>
          <h1 ref={h1} tabIndex={-1} className="mb-6 font-display text-4xl font-semibold leading-none tracking-tight outline-none md:text-5xl">
            {data.title}
          </h1>
          <div className="mb-6">
            <Button variant="secondary" onClick={markAll} disabled={busy} className="w-full sm:w-auto">
              {allWatched ? "Marcar toda la serie como no vista" : "Marcar toda la serie como vista"}
            </Button>
            <p role="status" className="mt-2 min-h-7 text-muted">{note}</p>
          </div>
          <div className="max-w-3xl">
            {data.seasons.map((season, i) => (
              <details key={season.id} open={i === 0} className="group border-t border-rule last:border-b">
                <summary className="flex min-h-16 list-none items-center justify-between gap-3 py-3 [&::-webkit-details-marker]:hidden">
                  <span className="font-display text-2xl font-semibold">Temporada {season.number}</span>
                  <span className="flex items-center gap-2 text-muted">
                    {plural(season.episodes.length, "episodio", "episodios")}
                    {season.episodes.some((e) => e.watched) && ` · ${plural(season.episodes.filter((e) => e.watched).length, "visto", "vistos")}`}
                    <Icon name="chevron" className="size-6 motion-safe:transition-transform group-open:rotate-180" />
                  </span>
                </summary>
                <ol className="pb-2">
                  {season.episodes.map((ep) => (
                    <li key={ep.id}>
                      <Link to={`/ver/${ep.fileId}`}
                        className="flex min-h-16 items-center gap-4 border-t border-rule py-3 hover:bg-surface">
                        {ep.title ? (
                          <>
                            <span className="w-10 shrink-0 text-right font-display text-2xl font-semibold tabular-nums text-muted">
                              <span className="sr-only">Episodio </span>{ep.number}
                            </span>
                            <span className="flex-1 font-bold">{ep.title}</span>
                          </>
                        ) : (
                          <span className="flex-1 pl-2 font-bold">Episodio {ep.number}</span>
                        )}
                        <span className="shrink-0 text-sm font-bold text-muted">
                          {ep.watched ? (
                            <span className="inline-flex items-center gap-1"><Icon name="check" className="size-4" /> Visto</span>
                          ) : ep.progress > 0.02 ? `${Math.round(ep.progress * 100)} %` : null}
                        </span>
                        <Icon name="play" className="size-5 shrink-0 text-accent" />
                      </Link>
                    </li>
                  ))}
                </ol>
              </details>
            ))}
          </div>
        </>
      )}
    </>
  );
}
