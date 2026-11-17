import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, type Db } from "./db/index.js";
import { migrate } from "./db/migrations.js";
import { BATCH_MS, recentlyAdded } from "./recent.js";

const H = 3600 * 1000;
const D = 24 * H;

function setup() {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO libraries(id,name,type,root_path) VALUES(1,'Biblioteca','movies','/x')").run();
  let n = 0;
  const file = (cols: { movie_id?: number; episode_id?: number }, addedAt: number | null, mtime = 1) =>
    db.prepare("INSERT INTO media_files(library_id,movie_id,episode_id,path,rel_path,size_bytes,mtime_ms,added_at) VALUES(1,?,?,?,?,1,?,?)")
      .run(cols.movie_id ?? null, cols.episode_id ?? null, `/x/${++n}`, `${n}`, mtime, addedAt).lastInsertRowid as number;
  const movie = (title: string, addedAt: number | null, opts: { year?: number; mtime?: number } = {}) => {
    const id = db.prepare("INSERT INTO movies(library_id,title,year) VALUES(1,?,?)").run(title, opts.year ?? null).lastInsertRowid as number;
    return { id, fileId: file({ movie_id: id }, addedAt, opts.mtime) };
  };
  const episode = (series: string, sn: number, en: number, addedAt: number | null) => {
    const sid = (db.prepare("SELECT id FROM series WHERE title=?").get(series) as { id: number } | undefined)?.id
      ?? (db.prepare("INSERT INTO series(library_id,title) VALUES(1,?)").run(series).lastInsertRowid as number);
    const seasonId = (db.prepare("SELECT id FROM seasons WHERE series_id=? AND number=?").get(sid, sn) as { id: number } | undefined)?.id
      ?? (db.prepare("INSERT INTO seasons(series_id,number) VALUES(?,?)").run(sid, sn).lastInsertRowid as number);
    const eid = db.prepare("INSERT INTO episodes(season_id,number) VALUES(?,?)").run(seasonId, en).lastInsertRowid as number;
    file({ episode_id: eid }, addedAt);
    return sid;
  };
  return { db, movie, episode };
}

test("mezcla películas y series de más nuevo a más antiguo", () => {
  const { db, movie, episode } = setup();
  movie("Vieja", 1 * D);
  episode("Serie A", 1, 1, 3 * D);
  movie("Nueva", 5 * D, { year: 2024 });
  const r = recentlyAdded(db);
  assert.deepEqual(r.map((i) => i.title), ["Nueva", "Serie A", "Vieja"]);
  assert.deepEqual(r.map((i) => i.kind), ["movie", "series", "movie"]);
  assert.equal(r[0].year, 2024);
});

test("película: lleva el archivo a reproducir y sin episodios nuevos; serie: ficha sin archivo", () => {
  const { db, movie, episode } = setup();
  const m = movie("Peli", 2 * D);
  const sid = episode("Serie", 1, 1, 1 * D);
  const [peli, serie] = recentlyAdded(db);
  assert.equal(peli.fileId, m.fileId);
  assert.equal(peli.newEpisodes, 0);
  assert.equal(serie.id, sid);
  assert.equal(serie.fileId, null);
});

test("los episodios de una misma tanda salen como una sola entrada, con su número", () => {
  const { db, episode } = setup();
  const t = 10 * D;
  for (let e = 1; e <= 4; e++) episode("Serie", 1, e, t + e * 1000);
  const r = recentlyAdded(db);
  assert.equal(r.length, 1);
  assert.equal(r[0].newEpisodes, 4);
  assert.equal(r[0].addedAt, t + 4000);
});

test("los episodios de hace más de un día respecto al último no cuentan como nuevos", () => {
  const { db, episode } = setup();
  const t = 10 * D;
  episode("Serie", 1, 1, t - 5 * D);
  episode("Serie", 1, 2, t - BATCH_MS - 1);
  episode("Serie", 1, 3, t - 2 * H);
  episode("Serie", 1, 4, t);
  assert.equal(recentlyAdded(db)[0].newEpisodes, 2);
});

test("respeta el límite y se queda con lo más reciente", () => {
  const { db, movie } = setup();
  for (let i = 1; i <= 5; i++) movie(`P${i}`, i * D);
  assert.deepEqual(recentlyAdded(db, 3).map((i) => i.title), ["P5", "P4", "P3"]);
});

test("sin added_at usa la fecha del archivo", () => {
  const { db, movie } = setup();
  movie("Sin fecha de alta", null, { mtime: 9 * D });
  movie("Con fecha", 4 * D);
  assert.deepEqual(recentlyAdded(db).map((i) => i.title), ["Sin fecha de alta", "Con fecha"]);
});

test("a igualdad de fecha gana lo último en entrar y las películas van antes que las series", () => {
  const { db, movie, episode } = setup();
  movie("Primera", 5 * D);
  movie("Segunda", 5 * D);
  episode("Serie", 1, 1, 5 * D);
  assert.deepEqual(recentlyAdded(db).map((i) => i.title), ["Segunda", "Primera", "Serie"]);
});

test("carátula solo si la hay", () => {
  const { db, movie } = setup();
  const a = movie("Con carátula", 2 * D);
  movie("Sin carátula", 1 * D);
  db.prepare("UPDATE movies SET poster_path='/p.jpg' WHERE id=?").run(a.id);
  const [con, sin] = recentlyAdded(db);
  assert.equal(con.poster, `/api/posters/movie/${a.id}`);
  assert.equal(sin.poster, null);
});

test("catálogo vacío: lista vacía", () => {
  assert.deepEqual(recentlyAdded(setup().db), []);
});

test("la migración rellena added_at con la fecha del archivo en lo que ya había", () => {
  const db: Db = openDb(":memory:");
  db.prepare("INSERT INTO libraries(id,name,type,root_path) VALUES(1,'B','movies','/x')").run();
  const mid = db.prepare("INSERT INTO movies(library_id,title) VALUES(1,'Antigua')").run().lastInsertRowid;
  // Se vuelve al esquema anterior a la migración y se inserta como lo haría una versión vieja.
  db.exec("DROP INDEX idx_media_files_added; ALTER TABLE media_files DROP COLUMN added_at;");
  db.pragma("user_version = 4");
  db.prepare("INSERT INTO media_files(library_id,movie_id,path,rel_path,size_bytes,mtime_ms) VALUES(1,?, '/x/1','1',1,123456)").run(mid);
  migrate(db);
  assert.equal(db.pragma("user_version", { simple: true }), 5);
  assert.equal((db.prepare("SELECT added_at FROM media_files").get() as { added_at: number }).added_at, 123456);
  assert.equal(recentlyAdded(db)[0].addedAt, 123456);
});
