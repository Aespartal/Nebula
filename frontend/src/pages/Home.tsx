import type { ContinueItem } from "@nebula/shared";
import { LinkButton } from "../components/Button";
import { PageHeading } from "../components/PageHeading";
import { ErrorBox, Loading } from "../components/States";
import { TitleCard } from "../components/TitleCard";
import { formatClock } from "../lib/format";
import { useApi } from "../lib/useApi";
import { usePageTitle } from "../lib/usePageTitle";

export default function Home() {
  usePageTitle("Inicio");
  const { data, error, loading, reload } = useApi<ContinueItem[]>("/api/continue");

  return (
    <>
      <PageHeading title="Inicio" />
      {loading && <Loading />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && data.length > 0 && (
        <section aria-labelledby="seguir">
          <h2 id="seguir" className="mb-4 font-display text-2xl font-semibold">Seguir viendo</h2>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {data.map((i) => (
              <li key={i.fileId}>
                <TitleCard
                  to={`/ver/${i.fileId}`} title={i.title} kind={i.kind === "episode" ? "Episodio" : "Película"}
                  progress={i.durationS ? i.positionS / i.durationS : 0}
                  meta={[i.subtitle, i.reason === "next" ? "Siguiente" : `Retomar en ${formatClock(i.positionS)}`].filter(Boolean).join(" · ")}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
      {data && data.length === 0 && (
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
