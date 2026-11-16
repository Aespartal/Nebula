import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Fastify from "fastify";
import { registerAuth } from "./auth/plugin.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { openDb, type Db } from "./db/index.js";
import { registerMetadataRoutes } from "./metadata/routes.js";
import { MetadataService } from "./metadata/service.js";
import { Tmdb, normTitle, pickMatch } from "./metadata/tmdb.js";

// --- Servidor TMDB simulado ---
const open: { close: () => Promise<unknown> }[] = [];
test.after(async () => { await Promise.all(open.map((s) => s.close())); }); // aunque un test falle, no se queda ningún servidor abierto
async function mockTmdb() {
  const calls: { url: string; auth?: string }[] = [];
  let failWith: number | null = null;
  let rateLimitOnce = false;
  const app = Fastify();
  app.addHook("onRequest", async (req, reply) => {
    calls.push({ url: req.url, auth: req.headers.authorization });
    if (failWith) return reply.code(failWith).send({ status_message: "x" });
    if (rateLimitOnce && req.url.startsWith("/search/movie")) { rateLimitOnce = false; return reply.code(429).header("retry-after", "1").send({}); }
  });
  app.get<{ Querystring: { query: string; year?: string } }>("/search/movie", async (req) => {
    const { query, year } = req.query;
    if (query === "Blade Runner 2049") return { results: [
      { id: 1, title: "Blade Runner", original_title: "Blade Runner", release_date: "1982-06-25", overview: "La vieja", poster_path: "/old.jpg" },
      { id: 335984, title: "Blade Runner 2049", original_title: "Blade Runner 2049", release_date: "2017-10-04", overview: "K, un blade runner.", poster_path: "/br49.jpg" }] };
    if (query === "Alien") return year ? { results: [] } : { results: [{ id: 348, title: "Alien, el octavo pasajero", original_title: "Alien", release_date: "1979-05-25", overview: "En el espacio.", poster_path: "/alien.jpg" }] };
    if (query === "Dune") return { results: [{ id: 9, title: "Dune: Parte Dos", original_title: "Dune: Part Two", release_date: "2024-02-27", overview: "x", poster_path: "/d2.jpg" }] };
    return { results: [] };
  });
  app.get<{ Querystring: { query: string } }>("/search/tv", async (req) =>
    req.query.query === "Breaking Bad" ? { results: [{ id: 1396, name: "Breaking Bad", original_name: "Breaking Bad", first_air_date: "2008-01-20", overview: "Un profesor de química.", poster_path: "/bb.jpg" }] } : { results: [] });
  app.get<{ Params: { id: string; n: string } }>("/tv/:id/season/:n", async (req) => ({
    episodes: [{ episode_number: 1, name: "Piloto", overview: "Walter empieza." }, { episode_number: 2, name: "El gato", overview: "Limpieza." }, { episode_number: 3, name: null, overview: "" }],
  }));
  let imgHits = 0;
  app.get("/img/:size/:file", async (req, reply) => { imgHits++; return reply.type("image/jpeg").send(Buffer.from([0xff, 0xd8, 0xff, 0xd9])); });
  await app.listen({ port: 0, host: "127.0.0.1" });
  open.push(app);
  const port = (app.server.address() as any).port;
  return {
    calls, base: `http://127.0.0.1:${port}`, image: `http://127.0.0.1:${port}/img`,
    get imgHits() { return imgHits; },
    failWith: (s: number | null) => { failWith = s; }, rateLimitOnce: () => { rateLimitOnce = true; },
    close: () => app.close(),
  };
}

function seed(db: Db) {
  db.prepare("INSERT INTO libraries(id,name,type,root_path) VALUES(1,'P','movies','/m'),(2,'S','series','/s')").run();
  db.prepare("INSERT INTO movies(id,library_id,title,year) VALUES(1,1,'Blade Runner 2049',2017),(2,1,'Alien',1979),(3,1,'Película inventada',2001),(4,1,'Dune',2021)").run();
  db.prepare("INSERT INTO series(id,library_id,title) VALUES(1,2,'Breaking Bad'),(2,2,'Serie rara')").run();
  db.prepare("INSERT INTO seasons(id,series_id,number) VALUES(1,1,1),(2,2,1)").run();
  db.prepare("INSERT INTO episodes(id,season_id,number,title) VALUES(1,1,1,NULL),(2,1,2,'Mi título'),(3,1,3,NULL),(4,2,1,NULL)").run();
}
const mk = async (key = "0123456789abcdef0123456789abcdef") => {
  const mock = await mockTmdb();
  const db = openDb(":memory:"); seed(db);
  const dir = mkdtempSync(path.join(os.tmpdir(), "nebula-posters-"));
  const meta = new MetadataService(db, new Tmdb({ apiKey: key, language: "es-ES", baseUrl: mock.base, imageBase: mock.image }), dir);
  return { mock, db, dir, meta };
};

test("normTitle ignora acentos, mayúsculas y signos", () => {
  assert.equal(normTitle("¡Amélie!"), "amelie");
  assert.equal(normTitle("Blade.Runner 2049"), "blade runner 2049");
});

test("pickMatch: título igual con año cercano; si no, solo el primero con año exacto; si no, nada", () => {
  const h = (title: string, year: number, original = title) => ({ title, originalTitle: original, year });
  assert.equal(pickMatch([h("Blade Runner", 1982), h("Blade Runner 2049", 2017)], "Blade Runner 2049", 2017)?.year, 2017);
  assert.equal(pickMatch([h("Alien, el octavo pasajero", 1979, "Alien")], "Alien", 1979)?.year, 1979, "por título original");
  assert.equal(pickMatch([h("Alien", 1979)], "Alien", 1980)?.year, 1979, "año a ±1");
  assert.equal(pickMatch([h("Dune: Parte Dos", 2024, "Dune: Part Two")], "Dune", 2021), null, "otro título y otro año: ninguno");
  assert.equal(pickMatch([h("El Laberinto del Fauno", 2006, "El laberinto del fauno")], "Pans Labyrinth", 2006)?.year, 2006, "título distinto pero año exacto");
  assert.equal(pickMatch([h("Otra cosa", 1999)], "Alien", null), null);
});

test("películas: reconoce, reintenta sin año, no inventa y envía el idioma y la clave", async () => {
  const { mock, db, meta } = await mk();
  await meta.refresh(false);
  const m = (id: number) => db.prepare("SELECT tmdb_id AS t, overview AS o, poster_path AS p, meta_checked_at AS c FROM movies WHERE id=?").get(id) as any;
  assert.deepEqual([m(1).t, m(1).o, m(1).p], [335984, "K, un blade runner.", "/br49.jpg"]); // no la de 1982
  assert.deepEqual([m(2).t, m(2).p], [348, "/alien.jpg"]); // con el año no hay resultados: segundo intento sin él
  assert.equal(m(3).t, null); assert.ok(m(3).c, "lo no encontrado queda anotado para no insistir");
  assert.equal(m(4).t, null, "Dune (2021) no es Dune: Parte Dos (2024)");
  const first = new URL(mock.base + mock.calls[0].url);
  assert.equal(first.searchParams.get("language"), "es-ES");
  assert.equal(first.searchParams.get("api_key"), "0123456789abcdef0123456789abcdef");
  assert.equal(mock.calls[0].auth, undefined);
  await mock.close();
});

test("el token v4 (eyJ…) va en la cabecera Authorization, no en la URL", async () => {
  const { mock, meta } = await mk("eyJhbGciOiJIUzI1NiJ9.token.firma");
  await meta.refresh(false);
  assert.equal(mock.calls[0].auth, "Bearer eyJhbGciOiJIUzI1NiJ9.token.firma");
  assert.equal(new URL(mock.base + mock.calls[0].url).searchParams.has("api_key"), false);
  await mock.close();
});

test("series: carátula, sinopsis y episodios (sin pisar los títulos que ya había)", async () => {
  const { mock, db, meta } = await mk();
  await meta.refresh(false);
  const s = db.prepare("SELECT tmdb_id AS t, overview AS o, poster_path AS p FROM series WHERE id=1").get() as any;
  assert.deepEqual([s.t, s.o, s.p], [1396, "Un profesor de química.", "/bb.jpg"]);
  assert.equal((db.prepare("SELECT tmdb_id AS t FROM series WHERE id=2").get() as any).t, null);
  const ep = (id: number) => db.prepare("SELECT title,overview FROM episodes WHERE id=?").get(id) as any;
  assert.deepEqual(ep(1), { title: "Piloto", overview: "Walter empieza." });
  assert.deepEqual(ep(2), { title: "Mi título", overview: "Limpieza." }, "el título del archivo se respeta");
  assert.deepEqual(ep(3), { title: null, overview: null }, "vacíos de TMDB no se guardan");
  await mock.close();
});

test("segunda pasada: no repite lo ya consultado; lo no encontrado se reintenta tras una semana; force lo consulta todo", async () => {
  const { mock, db, meta } = await mk();
  await meta.refresh(false);
  const n = mock.calls.length;
  await meta.refresh(false);
  assert.equal(mock.calls.filter((c) => c.url.startsWith("/search")).length, mock.calls.slice(0, n).filter((c) => c.url.startsWith("/search")).length, "sin búsquedas nuevas");
  db.prepare("UPDATE movies SET meta_checked_at = ? WHERE id=3").run(Date.now() - 8 * 24 * 3600_000);
  const before = mock.calls.length;
  await meta.refresh(false);
  assert.equal(mock.calls.slice(before).filter((c) => c.url.includes("Pel")).length, 2, "solo la película pendiente (con año y, al no haber resultado, sin año)");
  assert.equal(mock.calls.slice(before).filter((c) => c.url.startsWith("/search/movie")).length, 2, "ninguna otra");
  const b2 = mock.calls.length;
  await meta.refresh(true);
  assert.ok(mock.calls.slice(b2).filter((c) => c.url.startsWith("/search/movie")).length >= 4, "force consulta todas");
  await mock.close();
});

test("clave rechazada: se detiene, avisa y no marca nada como consultado", async () => {
  const { mock, db, meta } = await mk();
  mock.failWith(401);
  meta.kick();
  for (let i = 0; i < 50 && meta.status().running; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(meta.status().lastError, "invalid_key");
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM movies WHERE meta_checked_at IS NOT NULL").get() as any).n, 0);
  assert.equal(meta.status().movies.pending, 4);
  await mock.close();
});

test("429: espera lo que indica TMDB y reintenta", async () => {
  const { mock, db, meta } = await mk();
  mock.rateLimitOnce();
  const t = Date.now();
  await meta.refresh(false);
  assert.ok(Date.now() - t >= 900, "esperó ~1 s");
  assert.equal((db.prepare("SELECT tmdb_id AS t FROM movies WHERE id=1").get() as any).t, 335984);
  await mock.close();
});

test("carátulas: se descargan al pedirlas, se guardan por id de TMDB y la ruta exige sesión", async () => {
  const { mock, db, dir, meta } = await mk();
  await meta.refresh(false);
  const app = Fastify();
  await registerAuth(app, db);
  registerAuthRoutes(app, db);
  registerMetadataRoutes(app, meta);
  assert.equal((await app.inject("/api/posters/movie/1")).statusCode, 401);
  const setup = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { username: "alex", password: "contraseña-larga" } });
  const cookie = `nebula_session=${setup.cookies[0].value}`;
  const r1 = await app.inject({ url: "/api/posters/movie/1", headers: { cookie } });
  assert.equal(r1.statusCode, 200);
  assert.equal(r1.headers["content-type"], "image/jpeg");
  assert.equal(r1.rawPayload.length, 4);
  await app.inject({ url: "/api/posters/movie/1", headers: { cookie } });
  assert.equal(mock.imgHits, 1, "la segunda vez sale del disco");
  assert.ok(readdirSync(dir).some((f) => f.startsWith("m-335984-")), "el nombre lleva el id de TMDB");
  assert.equal((await app.inject({ url: "/api/posters/movie/3", headers: { cookie } })).statusCode, 404);
  assert.equal((await app.inject({ url: "/api/posters/series/1", headers: { cookie } })).statusCode, 200);
  assert.equal((await app.inject({ url: "/api/posters/otro/1", headers: { cookie } })).statusCode, 404);
  assert.equal(existsSync(dir), true);
  await mock.close();
});

test("rutas de metadatos: solo administradores; sin clave configurada avisa", async () => {
  const db = openDb(":memory:");
  const meta = new MetadataService(db, null, os.tmpdir());
  const app = Fastify();
  await registerAuth(app, db);
  registerAuthRoutes(app, db);
  registerMetadataRoutes(app, meta);
  const setup = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { username: "alex", password: "contraseña-larga" } });
  const admin = `nebula_session=${setup.cookies[0].value}`;
  await app.inject({ method: "POST", url: "/api/users", headers: { cookie: admin }, payload: { username: "mia", password: "otra-contraseña" } });
  const l = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "mia", password: "otra-contraseña" } });
  const user = `nebula_session=${l.cookies[0].value}`;
  assert.equal((await app.inject({ url: "/api/metadata/status", headers: { cookie: user } })).statusCode, 403);
  assert.equal((await app.inject({ method: "POST", url: "/api/metadata/refresh", headers: { cookie: user } })).statusCode, 403);
  assert.equal((await app.inject({ url: "/api/metadata/status", headers: { cookie: admin } })).json().enabled, false);
  assert.equal((await app.inject({ method: "POST", url: "/api/metadata/refresh", headers: { cookie: admin } })).statusCode, 409);
});
