import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import type { MovieSummary, RecentItem, SeriesSummary } from "@nebula/shared";
import { registerAuth } from "./auth/plugin.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { openDb } from "./db/index.js";
import { registerRoutes } from "./routes.js";

async function build() {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO libraries(id,name,type,root_path) VALUES(1,'B','movies','/x')").run();
  const app = Fastify();
  await registerAuth(app, db);
  registerAuthRoutes(app, db);
  registerRoutes(app, db);
  await app.ready();
  const r = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { username: "alex", password: "contraseña-larga" } });
  const cookie = `nebula_session=${r.cookies[0].value}`;
  const userId = (db.prepare("SELECT id FROM users").get() as { id: number }).id;
  let n = 0;
  const file = (cols: { movie_id?: number; episode_id?: number }, addedAt: number | null, mtime = 1) =>
    Number(db.prepare("INSERT INTO media_files(library_id,movie_id,episode_id,path,rel_path,size_bytes,mtime_ms,added_at) VALUES(1,?,?,?,?,1,?,?)")
      .run(cols.movie_id ?? null, cols.episode_id ?? null, `/x/${++n}`, `${n}`, mtime, addedAt).lastInsertRowid);
  const progress = (fileId: number, positionS: number, watched = false) =>
    db.prepare("INSERT INTO watch_progress(user_id,file_id,position_s,duration_s,watched,updated_at) VALUES(?,?,?,100,?,1)").run(userId, fileId, positionS, watched ? 1 : 0);
  const get = async <T>(url: string) => (await app.inject({ method: "GET", url, headers: { cookie } })).json() as T;
  return { app, db, file, progress, get };
}

test("/api/movies trae addedAt (el más reciente de sus archivos) y cae a la fecha del archivo", async () => {
  const { app, db, file, get } = await build();
  try {
    const a = Number(db.prepare("INSERT INTO movies(library_id,title) VALUES(1,'A')").run().lastInsertRowid);
    file({ movie_id: a }, 1000);
    file({ movie_id: a }, 3000);
    const b = Number(db.prepare("INSERT INTO movies(library_id,title) VALUES(1,'B')").run().lastInsertRowid);
    file({ movie_id: b }, null, 777);
    const list = await get<MovieSummary[]>("/api/movies");
    assert.equal(list.find((m) => m.title === "A")!.addedAt, 3000);
    assert.equal(list.find((m) => m.title === "B")!.addedAt, 777);
  } finally { await app.close(); }
});

test("/api/series: addedAt del último episodio y startedEpisodes (vistos o empezados)", async () => {
  const { app, db, file, progress, get } = await build();
  try {
    const sid = Number(db.prepare("INSERT INTO series(library_id,title) VALUES(1,'Serie')").run().lastInsertRowid);
    const season = Number(db.prepare("INSERT INTO seasons(series_id,number) VALUES(?,1)").run(sid).lastInsertRowid);
    const files: number[] = [];
    for (let e = 1; e <= 5; e++) {
      const eid = Number(db.prepare("INSERT INTO episodes(season_id,number) VALUES(?,?)").run(season, e).lastInsertRowid);
      files.push(file({ episode_id: eid }, e * 100));
    }
    progress(files[0], 100, true);   // vista
    progress(files[1], 40);          // a medias (≥ 10 s)
    progress(files[2], 3);           // casi sin empezar (< 10 s): no cuenta
    const [s] = await get<SeriesSummary[]>("/api/series");
    assert.equal(s.episodes, 5);
    assert.equal(s.watchedEpisodes, 1);
    assert.equal(s.startedEpisodes, 2);
    assert.equal(s.addedAt, 500);
  } finally { await app.close(); }
});

test("/api/series: otra persona no cuenta en mi «empezados»", async () => {
  const { app, db, file, get } = await build();
  try {
    const sid = Number(db.prepare("INSERT INTO series(library_id,title) VALUES(1,'S')").run().lastInsertRowid);
    const season = Number(db.prepare("INSERT INTO seasons(series_id,number) VALUES(?,1)").run(sid).lastInsertRowid);
    const eid = Number(db.prepare("INSERT INTO episodes(season_id,number) VALUES(?,1)").run(season).lastInsertRowid);
    const f = file({ episode_id: eid }, 1);
    db.prepare("INSERT INTO users(id,username,password_hash,role,created_at) VALUES(99,'otra','x','user',1)").run();
    db.prepare("INSERT INTO watch_progress(user_id,file_id,position_s,duration_s,watched,updated_at) VALUES(99,?,50,100,1,1)").run(f);
    const [s] = await get<SeriesSummary[]>("/api/series");
    assert.equal(s.startedEpisodes, 0);
    assert.equal(s.watchedEpisodes, 0);
  } finally { await app.close(); }
});

test("/api/recent exige sesión y devuelve lo último", async () => {
  const { app, db, file, get } = await build();
  try {
    assert.equal((await app.inject({ method: "GET", url: "/api/recent" })).statusCode, 401);
    const m = Number(db.prepare("INSERT INTO movies(library_id,title,year) VALUES(1,'Nueva',2024)").run().lastInsertRowid);
    file({ movie_id: m }, 5000);
    const r = await get<RecentItem[]>("/api/recent");
    assert.equal(r.length, 1);
    assert.equal(r[0].title, "Nueva");
    assert.equal(r[0].kind, "movie");
  } finally { await app.close(); }
});

test("/api/files/:id: episodio anterior y siguiente (saltando temporadas) y carátula de la serie", async () => {
  const { app, db, file, get } = await build();
  try {
    const sid = Number(db.prepare("INSERT INTO series(library_id,title,poster_path) VALUES(1,'Serie','/p.jpg')").run().lastInsertRowid);
    const ids: Record<string, number> = {};
    for (const [sn, en] of [[1, 1], [1, 2], [2, 1]]) {
      let season = (db.prepare("SELECT id FROM seasons WHERE series_id=? AND number=?").get(sid, sn) as { id: number } | undefined)?.id;
      season ??= Number(db.prepare("INSERT INTO seasons(series_id,number) VALUES(?,?)").run(sid, sn).lastInsertRowid);
      const eid = Number(db.prepare("INSERT INTO episodes(season_id,number,title) VALUES(?,?,?)").run(season, en, `E${sn}${en}`).lastInsertRowid);
      ids[`${sn}${en}`] = file({ episode_id: eid }, 1);
    }
    const mid = await get<any>(`/api/files/${ids["12"]}`);
    assert.equal(mid.previous.fileId, ids["11"]);
    assert.equal(mid.next.fileId, ids["21"], "el siguiente salta a la temporada 2");
    assert.equal(mid.poster, `/api/posters/series/${sid}`);
    const first = await get<any>(`/api/files/${ids["11"]}`);
    assert.equal(first.previous, null);
    assert.equal(first.next.fileId, ids["12"]);
    const last = await get<any>(`/api/files/${ids["21"]}`);
    assert.equal(last.previous.fileId, ids["12"], "el anterior vuelve a la temporada 1");
    assert.equal(last.next, null);
  } finally { await app.close(); }
});

test("/api/files/:id: película sin anterior ni siguiente y con su carátula si la tiene", async () => {
  const { app, db, file, get } = await build();
  try {
    const m = Number(db.prepare("INSERT INTO movies(library_id,title,poster_path) VALUES(1,'Peli','/p.jpg')").run().lastInsertRowid);
    const f = file({ movie_id: m }, 1);
    const sin = Number(db.prepare("INSERT INTO movies(library_id,title) VALUES(1,'Sin carátula')").run().lastInsertRowid);
    const g = file({ movie_id: sin }, 1);
    const a = await get<any>(`/api/files/${f}`);
    assert.equal(a.next, null);
    assert.equal(a.previous, null);
    assert.equal(a.poster, `/api/posters/movie/${m}`);
    assert.equal((await get<any>(`/api/files/${g}`)).poster, null);
  } finally { await app.close(); }
});
