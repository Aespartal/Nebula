import { useMemo, useState } from "react";
import type { MovieSummary } from "@nebula/shared";
import { Empty, ErrorBox, Loading } from "../components/States";
import { LinkButton } from "../components/Button";
import { PageHeading } from "../components/PageHeading";
import { SearchBox } from "../components/SearchBox";
import { TitleCard } from "../components/TitleCard";
import { ViewControls } from "../components/ViewControls";
import { MOVIE_ORDERS, countByState, filterByState, filterByText, movieState, sortMovies } from "../lib/catalogView";
import { plural, watchLabel } from "../lib/format";
import { useCatalogView } from "../lib/useCatalogView";
import { usePageTitle } from "../lib/usePageTitle";
import { useApi } from "../lib/useApi";

export default function Movies() {
  usePageTitle("Películas");
  const { data, error, loading, reload } = useApi<MovieSummary[]>("/api/movies");
  const [q, setQ] = useState("");
  const { order, estado, setOrder, setEstado } = useCatalogView(MOVIE_ORDERS.map((o) => o.value));
  const searched = useMemo(() => filterByText(data ?? [], q), [data, q]);
  const counts = useMemo(() => countByState(searched, movieState), [searched]);
  const list = useMemo(() => sortMovies(filterByState(searched, movieState, estado), order), [searched, estado, order]);

  return (
    <>
      <PageHeading title="Películas" count={data?.length} />
      {loading && <Loading />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && data.length === 0 && (
        <Empty title="Todavía no hay películas">
          <p>Añade la carpeta donde las guardas y Nebula las encontrará.</p>
          <LinkButton to="/ajustes" className="mt-4">Añadir una carpeta</LinkButton>
        </Empty>
      )}
      {data && data.length > 0 && (
        <>
          <SearchBox label="Buscar en películas" value={q} onChange={setQ} />
          <ViewControls estado={estado} onEstado={setEstado} counts={counts} orders={MOVIE_ORDERS} order={order} onOrder={setOrder} />
          <p role="status" className="sr-only">{q || estado !== "todas" ? plural(list.length, "resultado", "resultados") : ""}</p>
          {list.length === 0 ? (
            <p className="py-8 text-meta text-muted">
              {q ? "No hay ninguna película que se llame así." : "No hay ninguna película en este estado."}
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {list.map((m) => (
                <li key={m.id}>
                  <TitleCard to={`/ver/${m.fileId}`} title={m.title} kind="Película" progress={m.progress} watched={m.watched} poster={m.hasPoster ? `/api/posters/movie/${m.id}` : null}
                    meta={[m.year ? String(m.year) : "Sin año", watchLabel(m.watched, m.progress)].filter(Boolean).join(" · ")} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}
