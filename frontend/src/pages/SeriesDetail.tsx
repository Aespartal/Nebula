import { useRef } from "react";
import { Link, useParams } from "react-router-dom";
import type { SeriesDetail as SeriesDetailData } from "@nebula/shared";
import { Icon } from "../components/Icon";
import { ErrorBox, Loading } from "../components/States";
import { plural } from "../lib/format";
import { useFocusWhen } from "../lib/useFocusWhen";
import { usePageTitle } from "../lib/usePageTitle";
import { useApi } from "../lib/useApi";

export default function SeriesDetail() {
  const { id } = useParams();
  const { data, error, loading, reload } = useApi<SeriesDetailData>(`/api/series/${id}`);
  usePageTitle(data?.title);
  const h1 = useRef<HTMLHeadingElement>(null);
  useFocusWhen(h1, !!data);

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
          <div className="max-w-3xl">
            {data.seasons.map((season, i) => (
              <details key={season.id} open={i === 0} className="group border-t border-rule last:border-b">
                <summary className="flex min-h-16 list-none items-center justify-between gap-3 py-3 [&::-webkit-details-marker]:hidden">
                  <span className="font-display text-2xl font-semibold">Temporada {season.number}</span>
                  <span className="flex items-center gap-2 text-muted">
                    {plural(season.episodes.length, "episodio", "episodios")}
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
