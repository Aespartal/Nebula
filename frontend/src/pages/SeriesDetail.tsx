import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { SeriesDetail as SeriesDetailData } from "@nebula/shared";
import { Button, LinkButton } from "../components/Button";
import { FixMetadata } from "../components/FixMetadata";
import { Icon } from "../components/Icon";
import { ErrorBox, Loading } from "../components/States";
import { plural } from "../lib/format";
import { useUser } from "../lib/auth";
import { useFocusWhen } from "../lib/useFocusWhen";
import { usePageTitle } from "../lib/usePageTitle";
import { sendJson, useApi } from "../lib/useApi";

/** Qué ofrecer como botón principal: lo que está a medias, si no el primer episodio sin ver, si no nada. */
function pickContinue(data: SeriesDetailData) {
  const eps = data.seasons.flatMap((s) => s.episodes.map((e) => ({ ...e, season: s.number })));
  const anyWatched = eps.some((e) => e.watched || e.progress > 0.02);
  const partial = eps.find((e) => !e.watched && e.progress > 0.02);
  const target = partial ?? eps.find((e) => !e.watched);
  if (!target) return null;
  const label = `T${target.season} E${target.number}`;
  return { fileId: target.fileId, text: partial ? `Continuar ${label}` : anyWatched ? `Siguiente: ${label}` : "Empezar la serie" };
}

export default function SeriesDetail() {
  const { id } = useParams();
  const { data, error, loading, reload } = useApi<SeriesDetailData>(`/api/series/${id}`);
  usePageTitle(data?.title);
  const h1 = useRef<HTMLHeadingElement>(null);
  useFocusWhen(h1, !!data);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [posterFailed, setPosterFailed] = useState(false);

  const all = data?.seasons.flatMap((s) => s.episodes) ?? [];
  const allWatched = all.length > 0 && all.every((e) => e.watched);
  const go = data ? pickContinue(data) : null;
  const isAdmin = useUser().role === "admin";

  async function mark(path: string, watched: boolean, done: string) {
    setBusy(true);
    const r = await sendJson("POST", path, { watched });
    setBusy(false);
    if (r.ok) { setNote(done); reload(); } else setNote("No se pudo cambiar el estado.");
  }

  return (
    <>
      <Link to="/series" className="mb-4 inline-flex min-h-[var(--control-h)] items-center gap-1 font-bold text-muted hover:text-text">
        <Icon name="back" className="size-5" /> Todas las series
      </Link>
      {loading && !data && <Loading />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && (
        <>
          <div className="mb-6 flex max-w-3xl gap-4 sm:gap-6">
            {data.hasPoster && !posterFailed && (
              <img src={`/api/posters/series/${data.id}`} alt="" onError={() => setPosterFailed(true)}
                className="aspect-[2/3] w-28 shrink-0 self-start object-cover sm:w-40" />
            )}
            <div className="min-w-0">
              <h1 ref={h1} tabIndex={-1} className="text-3xl font-bold leading-[1.08] tracking-tight outline-none md:text-5xl [overflow-wrap:anywhere]">
                {data.title}
              </h1>
              <p className="mt-2 text-muted">
                {plural(data.seasons.length, "temporada", "temporadas")} · {plural(all.length, "episodio", "episodios")}
              </p>
              {data.overview && <p className="mt-3 line-clamp-6 max-w-prose sm:line-clamp-none">{data.overview}</p>}
            </div>
          </div>

          <div className="mb-6 flex max-w-3xl flex-col gap-3 sm:flex-row">
            {go && (
              <LinkButton to={`/ver/${go.fileId}`} className="w-full sm:w-auto">
                <Icon name="play" className="size-5" /> {go.text}
              </LinkButton>
            )}
            <Button variant="secondary" disabled={busy} className="w-full sm:w-auto"
              onClick={() => mark(`/api/series/${id}/watched`, !allWatched, allWatched ? "Serie marcada como no vista." : "Serie marcada como vista.")}>
              {allWatched ? "Marcar toda la serie como no vista" : "Marcar toda la serie como vista"}
            </Button>
          </div>
          <p role="status" className="mb-4 min-h-7 text-muted">{note}</p>
          {isAdmin && <FixMetadata kind="series" id={data.id} title={data.title} locked={data.metaLocked} onChanged={reload} />}

          <div className="max-w-3xl">
            {data.seasons.map((season, i) => {
              const seasonWatched = season.episodes.every((e) => e.watched);
              const seen = season.episodes.filter((e) => e.watched).length;
              return (
                <details key={season.id} open={i === 0} className="group border-t border-rule last:border-b">
                  <summary className="flex min-h-16 list-none items-center justify-between gap-3 py-3 [&::-webkit-details-marker]:hidden">
                    <span className="text-lg font-bold tracking-tight">Temporada {season.number}</span>
                    <span className="flex items-center gap-2 text-muted">
                      {plural(season.episodes.length, "episodio", "episodios")}
                      {seen > 0 && ` · ${plural(seen, "visto", "vistos")}`}
                      <Icon name="chevron" className="size-6 motion-safe:transition-transform group-open:rotate-180" />
                    </span>
                  </summary>
                  <ol className="pb-2">
                    {season.episodes.map((ep) => (
                      <li key={ep.id}>
                        <Link to={`/ver/${ep.fileId}`} className="group/ep flex min-h-16 items-center gap-4 border-t border-rule py-3 hover:bg-surface">
                          <span className="w-10 shrink-0 self-start pt-0.5 text-right font-mono text-meta font-bold text-faint">
                            <span className="sr-only">Episodio </span>{ep.number}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block font-bold">{ep.title ?? `Episodio ${ep.number}`}</span>
                            {ep.overview && <span className="mt-0.5 line-clamp-2 block text-muted">{ep.overview}</span>}
                          </span>
                          <span className="shrink-0 text-sm font-bold text-muted">
                            {ep.watched ? (
                              <span className="inline-flex items-center gap-1"><Icon name="check" className="size-4" /> Visto</span>
                            ) : ep.progress > 0.02 ? `${Math.round(ep.progress * 100)} %` : null}
                          </span>
                          <Icon name="play" className="size-4 shrink-0 text-faint group-hover/ep:text-text" />
                        </Link>
                      </li>
                    ))}
                  </ol>
                  <div className="border-t border-rule py-3">
                    <Button variant="secondary" disabled={busy} className="w-full sm:w-auto"
                      onClick={() => mark(`/api/seasons/${season.id}/watched`, !seasonWatched, `Temporada ${season.number} marcada como ${seasonWatched ? "no vista" : "vista"}.`)}>
                      {seasonWatched ? `Marcar la temporada ${season.number} como no vista` : `Marcar la temporada ${season.number} como vista`}
                    </Button>
                  </div>
                </details>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
