import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMedia } from "./parser.js";

test("película con año y basura de release", () => {
  assert.deepEqual(parseMedia("Blade.Runner.2049.2017.1080p.BluRay.x264.mkv", "movies"), {
    kind: "movie", title: "Blade Runner 2049", year: 2017,
  });
});
test("película con año entre paréntesis", () => {
  assert.deepEqual(parseMedia("Inception (2010).mp4", "movies"), { kind: "movie", title: "Inception", year: 2010 });
});
test("título que empieza por un año", () => {
  assert.deepEqual(parseMedia("2001 A Space Odyssey (1968).mkv", "movies"), {
    kind: "movie", title: "2001 A Space Odyssey", year: 1968,
  });
});
test("título numérico sin año", () => {
  assert.deepEqual(parseMedia("1917.1080p.mkv", "movies"), { kind: "movie", title: "1917", year: null });
});
test("año tomado de la carpeta", () => {
  assert.deepEqual(parseMedia("Alien (1979)/movie.mkv", "movies"), { kind: "movie", title: "Alien", year: 1979 });
});
test("episodio SxxExx en carpeta de serie", () => {
  assert.deepEqual(parseMedia("Breaking Bad/Season 1/Breaking.Bad.S01E02.Cats.in.the.Bag.720p.mkv", "series"), {
    kind: "episode", series: "Breaking Bad", season: 1, episode: 2, episodeTitle: "Cats in the Bag",
  });
});
test("episodio sin carpeta de serie", () => {
  assert.deepEqual(parseMedia("The.Office.US.s03e10.mkv", "series"), {
    kind: "episode", series: "The Office US", season: 3, episode: 10, episodeTitle: null,
  });
});
test("formato 1x02", () => {
  assert.deepEqual(parseMedia("Lost - 1x02 - Pilot Part 2.mkv", "series"), {
    kind: "episode", series: "Lost", season: 1, episode: 2, episodeTitle: "Pilot Part 2",
  });
});
test("solo número con carpeta de temporada", () => {
  assert.deepEqual(parseMedia("Dark/Temporada 2/05 - Titulo.mkv", "series"), {
    kind: "episode", series: "Dark", season: 2, episode: 5, episodeTitle: "Titulo",
  });
});
test("no parseable en biblioteca de series", () => {
  assert.equal(parseMedia("sample.mkv", "series"), null);
});
