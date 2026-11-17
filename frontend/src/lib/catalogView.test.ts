import { test } from "node:test";
import assert from "node:assert/strict";
import type { MovieSummary, SeriesSummary } from "@nebula/shared";
import {
  ESTADO_VALUES, countByState, filterByState, filterByText, movieState, parseParam, seriesState, sortMovies, sortSeries,
} from "./catalogView";

let n = 0;
const movie = (o: Partial<MovieSummary> = {}): MovieSummary =>
  ({ id: ++n, title: `Peli ${n}`, year: 2000, fileId: n, watched: false, progress: 0, hasPoster: false, addedAt: 0, ...o });
const serie = (o: Partial<SeriesSummary> = {}): SeriesSummary =>
  ({ id: ++n, title: `Serie ${n}`, seasons: 1, episodes: 10, watchedEpisodes: 0, startedEpisodes: 0, hasPoster: false, addedAt: 0, ...o });
const titles = (l: { title: string }[]) => l.map((x) => x.title);

test("parseParam: valor permitido o el de por defecto", () => {
  assert.equal(parseParam("vistas", ESTADO_VALUES, "todas"), "vistas");
  assert.equal(parseParam("nada", ESTADO_VALUES, "todas"), "todas");
  assert.equal(parseParam(null, ESTADO_VALUES, "todas"), "todas");
  assert.equal(parseParam("", ESTADO_VALUES, "todas"), "todas");
});

test("película: vista, en curso (desde el 2 %) o pendiente", () => {
  assert.equal(movieState(movie({ watched: true, progress: 1 })), "vistas");
  assert.equal(movieState(movie({ watched: true, progress: 0 })), "vistas");
  assert.equal(movieState(movie({ progress: 0.5 })), "en-curso");
  assert.equal(movieState(movie({ progress: 0.02 })), "en-curso");
  assert.equal(movieState(movie({ progress: 0.019 })), "pendientes");
  assert.equal(movieState(movie()), "pendientes");
});

test("serie: vista si están todos los episodios; en curso si hay alguno empezado; si no, pendiente", () => {
  assert.equal(seriesState(serie({ episodes: 10, watchedEpisodes: 10, startedEpisodes: 10 })), "vistas");
  assert.equal(seriesState(serie({ episodes: 10, watchedEpisodes: 3, startedEpisodes: 3 })), "en-curso");
  assert.equal(seriesState(serie({ episodes: 10, watchedEpisodes: 0, startedEpisodes: 1 })), "en-curso", "episodio a medias");
  assert.equal(seriesState(serie()), "pendientes");
  assert.equal(seriesState(serie({ episodes: 0 })), "pendientes", "sin episodios nunca es «vista»");
});

test("búsqueda: sin acentos ni mayúsculas, y vacía no filtra", () => {
  const l = [movie({ title: "Amélie" }), movie({ title: "El Padrino" })];
  assert.deepEqual(titles(filterByText(l, "amelie")), ["Amélie"]);
  assert.deepEqual(titles(filterByText(l, "  PADRINO ")), ["El Padrino"]);
  assert.equal(filterByText(l, "").length, 2);
  assert.equal(filterByText(l, "zzz").length, 0);
});

test("filtro por estado y recuento por estado", () => {
  const l = [movie({ watched: true }), movie({ progress: 0.4 }), movie(), movie()];
  assert.equal(filterByState(l, movieState, "todas").length, 4);
  assert.equal(filterByState(l, movieState, "pendientes").length, 2);
  assert.equal(filterByState(l, movieState, "en-curso").length, 1);
  assert.equal(filterByState(l, movieState, "vistas").length, 1);
  assert.deepEqual(countByState(l, movieState), { todas: 4, pendientes: 2, "en-curso": 1, vistas: 1 });
  assert.deepEqual(countByState([], movieState), { todas: 0, pendientes: 0, "en-curso": 0, vistas: 0 });
});

test("orden por título: sin acentos, sin mayúsculas y con números naturales", () => {
  const l = [movie({ title: "Zorro" }), movie({ title: "Película 10" }), movie({ title: "Álbum" }), movie({ title: "película 2" }), movie({ title: "abeja" })];
  assert.deepEqual(titles(sortMovies(l, "titulo")), ["abeja", "Álbum", "película 2", "Película 10", "Zorro"]);
});

test("orden por año: más nuevas primero, sin año al final y por título si empatan", () => {
  const l = [movie({ title: "B", year: 1999 }), movie({ title: "Sin año", year: null }), movie({ title: "A", year: 1999 }), movie({ title: "Nueva", year: 2024 }), movie({ title: "Otra sin año", year: null })];
  assert.deepEqual(titles(sortMovies(l, "ano")), ["Nueva", "A", "B", "Otra sin año", "Sin año"]);
});

test("orden por añadido: lo último primero, y por título si empatan", () => {
  const l = [movie({ title: "B", addedAt: 5 }), movie({ title: "Vieja", addedAt: 1 }), movie({ title: "A", addedAt: 5 }), movie({ title: "Nueva", addedAt: 9 })];
  assert.deepEqual(titles(sortMovies(l, "reciente")), ["Nueva", "A", "B", "Vieja"]);
  const s = [serie({ title: "S1", addedAt: 2 }), serie({ title: "S2", addedAt: 7 })];
  assert.deepEqual(titles(sortSeries(s, "reciente")), ["S2", "S1"]);
  assert.deepEqual(titles(sortSeries(s, "titulo")), ["S1", "S2"]);
});

test("ordenar no modifica la lista original", () => {
  const l = [movie({ title: "B" }), movie({ title: "A" })];
  sortMovies(l, "titulo");
  assert.deepEqual(titles(l), ["B", "A"]);
});
