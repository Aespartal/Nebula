import type { MovieSummary, SeriesSummary } from "@nebula/shared";
import { norm } from "./format";

// Lógica pura de las listas de Películas y Series (orden, filtro por estado, búsqueda). Sin React, para poder probarla.

export type WatchState = "pendientes" | "en-curso" | "vistas";
export type Estado = "todas" | WatchState;

export const ESTADOS: readonly { value: Estado; label: string }[] = [
  { value: "todas", label: "Todas" },
  { value: "pendientes", label: "Pendientes" },
  { value: "en-curso", label: "En curso" },
  { value: "vistas", label: "Vistas" },
];
export const ESTADO_VALUES = ESTADOS.map((e) => e.value);

export type MovieOrder = "titulo" | "ano" | "reciente";
export type SeriesOrder = "titulo" | "reciente";
export const MOVIE_ORDERS: readonly { value: MovieOrder; label: string }[] = [
  { value: "titulo", label: "Título" },
  { value: "ano", label: "Año" },
  { value: "reciente", label: "Añadido recientemente" },
];
export const SERIES_ORDERS: readonly { value: SeriesOrder; label: string }[] = [
  { value: "titulo", label: "Título" },
  { value: "reciente", label: "Añadido recientemente" },
];

/** Valor de la URL si es uno de los permitidos; si no (o si falta), el de por defecto. */
export function parseParam<T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.includes(raw as T) ? (raw as T) : fallback;
}

/** Misma regla que la etiqueta de la tarjeta («Vista al N %» a partir del 2 %). */
export const movieState = (m: Pick<MovieSummary, "watched" | "progress">): WatchState =>
  m.watched ? "vistas" : m.progress >= 0.02 ? "en-curso" : "pendientes";

/** Vista = todos los episodios vistos; en curso = alguno visto o empezado; pendiente = ninguno. */
export const seriesState = (s: Pick<SeriesSummary, "episodes" | "watchedEpisodes" | "startedEpisodes">): WatchState =>
  s.episodes > 0 && s.watchedEpisodes === s.episodes ? "vistas" : s.startedEpisodes > 0 ? "en-curso" : "pendientes";

export const filterByText = <T extends { title: string }>(list: T[], q: string): T[] => {
  const n = norm(q);
  return n ? list.filter((x) => norm(x.title).includes(n)) : list;
};

export const filterByState = <T>(list: T[], stateOf: (x: T) => WatchState, estado: Estado): T[] =>
  estado === "todas" ? list : list.filter((x) => stateOf(x) === estado);

export function countByState<T>(list: T[], stateOf: (x: T) => WatchState): Record<Estado, number> {
  const c: Record<Estado, number> = { todas: list.length, pendientes: 0, "en-curso": 0, vistas: 0 };
  for (const x of list) c[stateOf(x)]++;
  return c;
}

// Sin acentos ni mayúsculas, y «2» antes que «10».
const byTitle = (a: { title: string }, b: { title: string }) =>
  a.title.localeCompare(b.title, "es", { sensitivity: "base", numeric: true });

export function sortMovies(list: MovieSummary[], order: MovieOrder): MovieSummary[] {
  const out = [...list];
  switch (order) {
    case "ano": // más nuevas primero; las que no tienen año, al final
      return out.sort((a, b) => (b.year ?? -Infinity) - (a.year ?? -Infinity) || byTitle(a, b));
    case "reciente":
      return out.sort((a, b) => b.addedAt - a.addedAt || byTitle(a, b));
    default:
      return out.sort(byTitle);
  }
}

export function sortSeries(list: SeriesSummary[], order: SeriesOrder): SeriesSummary[] {
  const out = [...list];
  return order === "reciente" ? out.sort((a, b) => b.addedAt - a.addedAt || byTitle(a, b)) : out.sort(byTitle);
}
