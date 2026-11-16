import { useMemo, useState } from "react";
import type { SeriesSummary } from "@nebula/shared";
import { Empty, ErrorBox, Loading } from "../components/States";
import { LinkButton } from "../components/Button";
import { PageHeading } from "../components/PageHeading";
import { SearchBox } from "../components/SearchBox";
import { TitleCard } from "../components/TitleCard";
import { norm, plural } from "../lib/format";
import { usePageTitle } from "../lib/usePageTitle";
import { useApi } from "../lib/useApi";

export default function Series() {
  usePageTitle("Series");
  const { data, error, loading, reload } = useApi<SeriesSummary[]>("/api/series");
  const [q, setQ] = useState("");
  const list = useMemo(() => (data ?? []).filter((s) => norm(s.title).includes(norm(q))), [data, q]);

  return (
    <>
      <PageHeading title="Series" count={data?.length} />
      {loading && <Loading />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && data.length === 0 && (
        <Empty title="Todavía no hay series">
          <p>Añade la carpeta donde las guardas y Nebula las encontrará.</p>
          <LinkButton to="/ajustes" className="mt-4">Añadir una carpeta</LinkButton>
        </Empty>
      )}
      {data && data.length > 0 && (
        <>
          <SearchBox label="Buscar en series" value={q} onChange={setQ} />
          <p role="status" className="sr-only">{q ? plural(list.length, "resultado", "resultados") : ""}</p>
          {list.length === 0 ? (
            <p className="py-8 text-muted">No hay ninguna serie que se llame así.</p>
          ) : (
            <ul className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {list.map((s) => (
                <li key={s.id}>
                  <TitleCard to={`/series/${s.id}`} title={s.title} kind="Serie"
                    meta={`${plural(s.seasons, "temporada", "temporadas")} · ${plural(s.episodes, "episodio", "episodios")}`} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}
