import { test } from "node:test";
import assert from "node:assert/strict";
import type { MovieSummary, SeriesSummary } from "@nebula/shared";
import { searchCatalog } from "./globalSearch";

const movie = (id: number, title: string, year: number | null = 2000): MovieSummary =>
  ({ id, title, year, fileId: id * 10, watched: false, progress: 0, hasPoster: false, addedAt: 0 });
const serie = (id: number, title: string, seasons = 2): SeriesSummary =>
  ({ id, title, seasons, episodes: 10, watchedEpisodes: 0, startedEpisodes: 0, hasPoster: true, addedAt: 0 });

const movies = [movie(1, "Alien", 1979), movie(2, "Blade Runner 2049", 2017), movie(3, "El día de la bestia"), movie(4, "Los Aliens del espacio", null)];
const series = [serie(1, "Breaking Bad", 5), serie(2, "Alienist", 1)];

test("mezcla películas y series y ordena: empieza por → palabra que empieza → contiene", () => {
  const r = searchCatalog(movies, series, "alien");
  assert.deepEqual(r.map((h) => h.title), ["Alien", "Alienist", "Los Aliens del espacio"]);
  assert.deepEqual(r.map((h) => h.kind), ["movie", "series", "movie"]);
});

test("ignora acentos y mayúsculas", () => {
  assert.deepEqual(searchCatalog(movies, series, "DIA").map((h) => h.title), ["El día de la bestia"]);
  assert.deepEqual(searchCatalog(movies, series, "día de").map((h) => h.id), [3]);
});

test("las películas llevan a reproducir (por archivo) y las series a su ficha", () => {
  const [m] = searchCatalog(movies, series, "blade");
  assert.deepEqual([m.to, m.detail], ["/ver/20", "Película · 2017"]);
  const [s] = searchCatalog(movies, series, "breaking");
  assert.deepEqual([s.to, s.detail, s.hasPoster], ["/series/1", "Serie · 5 temporadas", true]);
  assert.equal(searchCatalog(movies, series, "alienist")[0].detail, "Serie · 1 temporada");
  assert.equal(searchCatalog(movies, series, "aliens")[0].detail, "Película", "sin año");
});

test("búsqueda vacía o sin coincidencias: nada; respeta el límite", () => {
  assert.deepEqual(searchCatalog(movies, series, ""), []);
  assert.deepEqual(searchCatalog(movies, series, "   "), []);
  assert.deepEqual(searchCatalog(movies, series, "zzz"), []);
  assert.equal(searchCatalog(movies, series, "a", 2).length, 2);
});
