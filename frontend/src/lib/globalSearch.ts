import type { MovieSummary, SeriesSummary } from "@nebula/shared";
import { norm } from "./format";

export interface SearchHit {
  kind: "movie" | "series";
  id: number;
  title: string;
  /** Texto corto bajo el título: el año o el número de temporadas. */
  detail: string;
  /** Adónde lleva: la película se reproduce; la serie abre su ficha. */
  to: string;
  hasPoster: boolean;
}

/** 0 = empieza por la búsqueda, 1 = una palabra empieza por ella, 2 = la contiene en otro punto. */
function rank(title: string, q: string): number | null {
  const t = norm(title);
  if (t.startsWith(q)) return 0;
  if (t.includes(` ${q}`)) return 1;
  return t.includes(q) ? 2 : null;
}

/** Busca a la vez en películas y series (sin acentos ni mayúsculas). Mejor coincidencia primero; a igualdad, por título. */
export function searchCatalog(movies: MovieSummary[], series: SeriesSummary[], query: string, limit = 12): SearchHit[] {
  const q = norm(query);
  if (!q) return [];
  const hits: (SearchHit & { r: number })[] = [];
  for (const m of movies) {
    const r = rank(m.title, q);
    if (r !== null) hits.push({ r, kind: "movie", id: m.id, title: m.title, detail: m.year ? `Película · ${m.year}` : "Película", to: `/ver/${m.fileId}`, hasPoster: m.hasPoster });
  }
  for (const s of series) {
    const r = rank(s.title, q);
    if (r !== null) hits.push({ r, kind: "series", id: s.id, title: s.title, detail: `Serie · ${s.seasons} ${s.seasons === 1 ? "temporada" : "temporadas"}`, to: `/series/${s.id}`, hasPoster: s.hasPoster });
  }
  hits.sort((a, b) => a.r - b.r || a.title.localeCompare(b.title, "es", { sensitivity: "base" }));
  return hits.slice(0, limit).map(({ r: _r, ...h }) => h);
}
