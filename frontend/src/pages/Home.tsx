import type { ContinueItem, RecentItem } from "@nebula/shared";
import { LinkButton } from "../components/Button";
import { Icon } from "../components/Icon";
import { PageHeading } from "../components/PageHeading";
import { ErrorBox, Loading } from "../components/States";
import { TitleCard } from "../components/TitleCard";
import { formatAgo, formatClock, plural } from "../lib/format";
import { useApi } from "../lib/useApi";
import { usePageTitle } from "../lib/usePageTitle";

const reasonText = (i: ContinueItem) => (i.reason === "next" ? "Siguiente capítulo" : `Retomar en ${formatClock(i.positionS)}`);

/** Lo primero que se quedó a medias, a lo grande: un toque y sigues viendo. */
function Hero({ item }: { item: ContinueItem }) {
  return (
    <div className="flex items-end justify-between gap-6 border-b border-rule pb-8">
      <div className="min-w-0 max-w-2xl flex-1 space-y-4">
        <p className="font-mono text-meta text-muted">
          {[item.kind === "episode" ? "Episodio" : "Película", item.subtitle, reasonText(item)].filter(Boolean).join(" · ")}
        </p>
        <h3 className="text-3xl font-bold leading-[1.08] tracking-tight [overflow-wrap:anywhere] sm:text-5xl">{item.title}</h3>
        {item.durationS ? (
          <div className="flex max-w-xs items-center gap-3 font-mono text-label text-muted" aria-hidden="true">
            <span className="h-[3px] flex-1 rounded-bar bg-track"><span className="block h-full rounded-bar bg-accent" style={{ width: `${Math.min(100, Math.round((item.positionS / item.durationS) * 100))}%` }} /></span>
            <span className="tabular">{Math.round((item.positionS / item.durationS) * 100)} %</span>
          </div>
        ) : null}
        <div className="pt-1">
          <LinkButton to={`/ver/${item.fileId}`} className="w-full sm:w-auto sm:px-5">
            <Icon name="play" className="size-4" />
            {item.reason === "next" ? "Ver el siguiente" : `Reanudar ${formatClock(item.positionS)}`}
          </LinkButton>
        </div>
      </div>
      {item.poster && (
        <img src={item.poster} alt="" className="hidden aspect-[2/3] w-36 shrink-0 rounded-ctl border border-rule object-cover md:block lg:w-44" />
      )}
    </div>
  );
}

const GRID = "grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6";

/** Lo último que ha entrado en el catálogo; útil sobre todo cuando acaba una descarga. */
function Recent({ items, spaced }: { items: RecentItem[]; spaced: boolean }) {
  return (
    <section aria-labelledby="recientes" className={spaced ? "mt-10" : undefined}>
      <h2 id="recientes" className="label mb-4">Recién añadidos</h2>
      <ul className={GRID}>
        {items.map((i) => (
          <li key={`${i.kind}-${i.id}`}>
            <TitleCard
              to={i.kind === "movie" ? `/ver/${i.fileId}` : `/series/${i.id}`}
              title={i.title} kind={i.kind === "movie" ? "Película" : "Serie"} poster={i.poster}
              meta={i.kind === "series" ? plural(i.newEpisodes, "episodio nuevo", "episodios nuevos") : i.year ? String(i.year) : "Sin año"}
              aside={formatAgo(i.addedAt)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function Home() {
  usePageTitle("Inicio");
  const { data, error, loading, reload } = useApi<ContinueItem[]>("/api/continue");
  // Las novedades son un extra: si fallan, la portada sigue funcionando sin ellas.
  const recent = useApi<RecentItem[]>("/api/recent").data ?? [];
  const [first, ...rest] = data ?? [];

  return (
    <>
      <PageHeading title="Inicio" />
      {loading && <Loading />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {first && (
        <section aria-labelledby="seguir" className="space-y-8">
          <div>
            <h2 id="seguir" className="label mb-4">Seguir viendo</h2>
            <Hero item={first} />
          </div>
          {rest.length > 0 && (
            <div>
              <div className="mb-4 flex items-baseline justify-between">
                <h2 className="label">Más para retomar</h2>
                <span className="font-mono text-label text-faint tabular">{rest.length} en curso</span>
              </div>
              <ul className={GRID}>
                {rest.map((i) => (
                  <li key={i.fileId}>
                    <TitleCard
                      to={`/ver/${i.fileId}`} title={i.title} kind={i.kind === "episode" ? "Episodio" : "Película"}
                      progress={i.durationS ? i.positionS / i.durationS : 0} poster={i.poster}
                      meta={[i.subtitle, reasonText(i)].filter(Boolean).join(" · ")}
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
      {recent.length > 0 && <Recent items={recent} spaced={!!first} />}
      {data && data.length === 0 && recent.length === 0 && (
        <div className="max-w-2xl">
          <p className="text-lg">Aquí aparecerá lo que dejes a medias y el siguiente capítulo de las series que estés viendo.</p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <LinkButton to="/peliculas">Ver películas</LinkButton>
            <LinkButton to="/series" variant="secondary">Ver series</LinkButton>
          </div>
        </div>
      )}
    </>
  );
}
