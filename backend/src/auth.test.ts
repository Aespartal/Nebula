import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerAuth } from "./auth/plugin.js";
import { FailureLimiter } from "./auth/limiter.js";
import { hashPassword, verifyPassword } from "./auth/password.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { createSession, getSessionUser, SESSION_TTL_MS } from "./auth/sessions.js";
import { openDb, type Db } from "./db/index.js";
import { continueWatching, saveProgress, setSeriesWatched, setWatched } from "./progress.js";
import { registerProgressRoutes } from "./progress-routes.js";
import { registerRoutes } from "./routes.js";

async function build() {
  const db = openDb(":memory:");
  const app = Fastify();
  await registerAuth(app, db);
  registerAuthRoutes(app, db);
  registerRoutes(app, db);
  registerProgressRoutes(app, db);
  await app.ready();
  return { app, db };
}
type App = Awaited<ReturnType<typeof build>>["app"];

const cookieOf = (res: { cookies: { name: string; value: string }[] }) => {
  const c = res.cookies.find((x) => x.name === "nebula_session");
  return c ? `nebula_session=${c.value}` : "";
};
const json = (app: App, method: any, url: string, cookie: string, payload?: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method, url, payload: payload as any, headers: { cookie, ...headers } });

async function withAdmin() {
  const ctx = await build();
  const r = await ctx.app.inject({ method: "POST", url: "/api/auth/setup", payload: { username: "alex", password: "contraseña-larga" } });
  assert.equal(r.statusCode, 201);
  return { ...ctx, admin: cookieOf(r) };
}
async function addUser(app: App, admin: string, username: string) {
  const r = await json(app, "POST", "/api/users", admin, { username, password: "otra-contraseña" });
  assert.equal(r.statusCode, 201);
  const l = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username, password: "otra-contraseña" } });
  assert.equal(l.statusCode, 200);
  return { id: r.json().id as number, cookie: cookieOf(l) };
}

/** Una película y una serie de 3 episodios, con duración conocida. */
function seed(db: Db) {
  db.prepare("INSERT INTO libraries(id,name,type,root_path) VALUES(1,'L','movies','/m'),(2,'S','series','/s')").run();
  db.prepare("INSERT INTO movies(id,library_id,title,year) VALUES(1,1,'Peli',2020)").run();
  db.prepare("INSERT INTO media_files(id,library_id,movie_id,path,rel_path,size_bytes,mtime_ms,duration_s) VALUES(10,1,1,'/m/a.mkv','a.mkv',1,1,1000)").run();
  db.prepare("INSERT INTO series(id,library_id,title) VALUES(1,2,'Serie')").run();
  db.prepare("INSERT INTO seasons(id,series_id,number) VALUES(1,1,1)").run();
  for (let n = 1; n <= 3; n++) {
    db.prepare("INSERT INTO episodes(id,season_id,number,title) VALUES(?,1,?,?)").run(n, n, `Ep ${n}`);
    db.prepare("INSERT INTO media_files(id,library_id,episode_id,path,rel_path,size_bytes,mtime_ms,duration_s) VALUES(?,2,?,?,?,1,1,600)").run(20 + n, n, `/s/${n}.mkv`, `${n}.mkv`);
  }
}

test("contraseñas: hash con sal, verificación y rechazo", async () => {
  const h = await hashPassword("abc12345");
  assert.match(h, /^scrypt\$32768\$8\$1\$/);
  assert.notEqual(h, await hashPassword("abc12345"));
  assert.equal(await verifyPassword("abc12345", h), true);
  assert.equal(await verifyPassword("abc12346", h), false);
  assert.equal(await verifyPassword("abc12345", "basura"), false);
});

test("limitador: bloquea tras N fallos y se libera al pasar la ventana", () => {
  let t = 0;
  const l = new FailureLimiter(3, 1000, () => t);
  for (let i = 0; i < 2; i++) l.fail("k");
  assert.equal(l.retryAfter("k"), 0);
  l.fail("k");
  assert.equal(l.retryAfter("k"), 1);
  t = 1001;
  assert.equal(l.retryAfter("k"), 0);
});

test("sin sesión: solo lo público responde; el resto da 401", async () => {
  const { app } = await build();
  assert.equal((await app.inject("/api/auth/status")).json().setupRequired, true);
  for (const url of ["/api/movies", "/api/series", "/api/libraries", "/api/files/1", "/api/stream/1", "/api/continue", "/api/users"]) {
    assert.equal((await app.inject(url)).statusCode, 401, url);
  }
});

test("alta inicial: crea al administrador una sola vez y abre sesión con cookie segura", async () => {
  const { app } = await build();
  const bad = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { username: "a", password: "contraseña-larga" } });
  assert.equal(bad.json().error, "invalid_username");
  const weak = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { username: "alex", password: "corta" } });
  assert.equal(weak.json().error, "weak_password");

  const ok = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { username: "alex", password: "contraseña-larga" } });
  assert.equal(ok.statusCode, 201);
  assert.equal(ok.json().role, "admin");
  assert.equal(ok.json().password_hash, undefined);
  const c = ok.cookies[0] as any;
  assert.equal(c.httpOnly, true);
  assert.equal(c.sameSite, "Lax");

  const again = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { username: "otro", password: "contraseña-larga" } });
  assert.equal(again.statusCode, 409);

  const st = (await json(app, "GET", "/api/auth/status", cookieOf(ok))).json();
  assert.deepEqual(st, { setupRequired: false, user: { id: 1, username: "alex", role: "admin" } });
});

test("el token no se guarda en claro y la sesión caduca", async () => {
  const { db, admin } = await withAdmin();
  const token = admin.split("=")[1];
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE token_hash=?").get(token) as { n: number }).n, 0);
  const s = createSession(db, 1, "test", 1000);
  assert.ok(getSessionUser(db, s.token, 2000));
  assert.equal(getSessionUser(db, s.token, 1000 + SESSION_TTL_MS + 1), null);
});

test("login: mismo error para usuario inexistente y contraseña errónea; bloqueo tras 5 fallos", async () => {
  const { app } = await withAdmin();
  const wrong = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "alex", password: "mal-mal-mal" } });
  const ghost = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "nadie", password: "mal-mal-mal" } });
  assert.equal(wrong.statusCode, 401);
  assert.deepEqual(wrong.json(), ghost.json());
  for (let i = 0; i < 4; i++) await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "alex", password: "mal-mal-mal" } });
  const locked = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "alex", password: "contraseña-larga" } });
  assert.equal(locked.statusCode, 429);
  assert.ok(Number(locked.headers["retry-after"]) > 0);
});

test("logout revoca la sesión en el servidor", async () => {
  const { app, admin } = await withAdmin();
  assert.equal((await json(app, "POST", "/api/auth/logout", admin)).statusCode, 204);
  assert.equal((await json(app, "GET", "/api/movies", admin)).statusCode, 401);
});

test("CSRF: las peticiones que cambian datos desde otro origen se rechazan", async () => {
  const { app, admin } = await withAdmin();
  const body = { username: "mia", password: "otra-contraseña" };
  const evil = await json(app, "POST", "/api/users", admin, body, { origin: "http://evil.example", host: "nebula.local" });
  assert.equal(evil.statusCode, 403);
  const cross = await json(app, "POST", "/api/users", admin, body, { "sec-fetch-site": "cross-site" });
  assert.equal(cross.statusCode, 403);
  const same = await json(app, "POST", "/api/users", admin, body, { origin: "http://nebula.local", host: "nebula.local", "sec-fetch-site": "same-origin" });
  assert.equal(same.statusCode, 201);
});

test("permisos: un usuario normal no gestiona usuarios ni bibliotecas", async () => {
  const { app, admin } = await withAdmin();
  const u = await addUser(app, admin, "mia");
  for (const [m, url, payload] of [
    ["GET", "/api/users"], ["POST", "/api/users", { username: "x-x", password: "12345678" }],
    ["GET", "/api/libraries"], ["POST", "/api/libraries", { name: "n", type: "movies", rootPath: "/" }],
    ["POST", "/api/scan"], ["POST", "/api/libraries/1/scan"], ["DELETE", "/api/users/1"],
  ] as const) {
    assert.equal((await json(app, m, url, u.cookie, payload)).statusCode, 403, `${m} ${url}`);
  }
  assert.equal((await json(app, "GET", "/api/movies", u.cookie)).statusCode, 200);
  assert.equal((await json(app, "GET", "/api/libraries", admin)).statusCode, 200);
});

test("usuarios: sin duplicados, ni borrarse a sí mismo, ni dejar sin administrador", async () => {
  const { app, admin } = await withAdmin();
  const u = await addUser(app, admin, "mia");
  assert.equal((await json(app, "POST", "/api/users", admin, { username: "MIA", password: "otra-contraseña" })).statusCode, 409);
  assert.equal((await json(app, "DELETE", "/api/users/1", admin)).json().error, "cannot_delete_self");
  const second = await json(app, "POST", "/api/users", admin, { username: "jefe", password: "otra-contraseña", role: "admin" });
  assert.equal(second.statusCode, 201);
  assert.equal((await json(app, "DELETE", `/api/users/${u.id}`, admin)).statusCode, 204);
  assert.equal((await json(app, "GET", "/api/movies", u.cookie)).statusCode, 401); // sus sesiones se borran con la cuenta
});

test("un administrador puede borrar a otro, pero el que queda no puede borrarse y siempre hay uno", async () => {
  const { app, admin } = await withAdmin();
  const r = await json(app, "POST", "/api/users", admin, { username: "jefe", password: "otra-contraseña", role: "admin" });
  const jefe = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "jefe", password: "otra-contraseña" } });
  assert.equal((await json(app, "DELETE", "/api/users/1", cookieOf(jefe))).statusCode, 204);
  assert.equal(r.statusCode, 201);
  assert.equal((await json(app, "DELETE", `/api/users/${r.json().id}`, cookieOf(jefe))).json().error, "cannot_delete_self");
});

test("cambiar la contraseña cierra las demás sesiones; restablecerla la de la otra cuenta", async () => {
  const { app, admin } = await withAdmin();
  const second = cookieOf(await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "alex", password: "contraseña-larga" } }));
  assert.equal((await json(app, "POST", "/api/auth/password", admin, { current: "no-es-esta", next: "nueva-contraseña" })).statusCode, 401);
  assert.equal((await json(app, "POST", "/api/auth/password", admin, { current: "contraseña-larga", next: "corta" })).statusCode, 400);
  assert.equal((await json(app, "POST", "/api/auth/password", admin, { current: "contraseña-larga", next: "nueva-contraseña" })).statusCode, 204);
  assert.equal((await json(app, "GET", "/api/movies", admin)).statusCode, 200);
  assert.equal((await json(app, "GET", "/api/movies", second)).statusCode, 401);

  const u = await addUser(app, admin, "mia");
  assert.equal((await json(app, "POST", `/api/users/${u.id}/password`, admin, { password: "restablecida-1" })).statusCode, 204);
  assert.equal((await json(app, "GET", "/api/movies", u.cookie)).statusCode, 401);
  assert.equal((await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "mia", password: "restablecida-1" } })).statusCode, 200);
});

test("progreso: guarda posición, marca como vista al 90 % y conserva la marca", async () => {
  const { db } = await withAdmin();
  seed(db);
  assert.equal(saveProgress(db, 1, 999, 5), null);
  assert.deepEqual(saveProgress(db, 1, 10, 100), { positionS: 100, durationS: 1000, watched: false });
  assert.equal(saveProgress(db, 1, 10, 905)!.watched, true);
  assert.equal(saveProgress(db, 1, 10, 50)!.watched, true, "volver a verla no quita la marca");
  assert.equal(saveProgress(db, 1, 10, 5000)!.positionS, 1000, "la posición no supera la duración");
  assert.deepEqual(setWatched(db, 1, 10, false), { positionS: 0, durationS: 1000, watched: false });
});

test("progreso por API: es por usuario y aparece en el catálogo", async () => {
  const { app, db, admin } = await withAdmin();
  seed(db);
  const u = await addUser(app, admin, "mia");
  assert.equal((await json(app, "PUT", "/api/progress/10", admin, { positionS: 250 })).json().positionS, 250);
  assert.equal((await json(app, "POST", "/api/progress/10", admin, { positionS: 300, durationS: 1000 })).statusCode, 200); // sendBeacon
  assert.equal((await json(app, "PUT", "/api/progress/10", admin, { positionS: -4 })).statusCode, 400);
  assert.equal((await json(app, "PUT", "/api/progress/999", admin, { positionS: 4 })).statusCode, 404);

  const mine = (await json(app, "GET", "/api/movies", admin)).json()[0];
  assert.equal(mine.progress, 0.3);
  assert.equal(mine.watched, false);
  assert.equal((await json(app, "GET", "/api/movies", u.cookie)).json()[0].progress, 0);
  assert.equal((await json(app, "GET", "/api/files/10", admin)).json().resume.positionS, 300);
  assert.equal((await json(app, "GET", "/api/files/10", u.cookie)).json().resume.positionS, 0);

  await json(app, "POST", "/api/progress/21/watched", admin, { watched: true });
  const det = (await json(app, "GET", "/api/series/1", admin)).json();
  assert.equal(det.seasons[0].episodes[0].watched, true);
  assert.equal(det.seasons[0].episodes[1].watched, false);
  assert.equal((await json(app, "GET", "/api/series", admin)).json()[0].watchedEpisodes, 1);
});

test("seguir viendo: lo empezado primero y el siguiente episodio de la serie en curso", async () => {
  const { db } = await withAdmin();
  seed(db);
  assert.deepEqual(continueWatching(db, 1), []);
  saveProgress(db, 1, 10, 3, undefined, 1); // menos de 10 s: no cuenta
  assert.deepEqual(continueWatching(db, 1), []);
  saveProgress(db, 1, 10, 200, undefined, 2);
  setWatched(db, 1, 21, true, 3);
  const list = continueWatching(db, 1);
  assert.deepEqual(list.map((i) => [i.fileId, i.reason]), [[22, "next"], [10, "resume"]]);
  assert.equal(list[0].subtitle, "Serie · T1 E2");
  assert.equal(list[1].positionS, 200);

  saveProgress(db, 1, 22, 100, undefined, 4); // el siguiente ya está a medias: aparece una sola vez
  assert.deepEqual(continueWatching(db, 1).map((i) => [i.fileId, i.reason]), [[22, "resume"], [10, "resume"]]);

  assert.equal(setSeriesWatched(db, 1, 1, true), 3);
  assert.deepEqual(continueWatching(db, 1).map((i) => i.fileId), [10]); // serie terminada: nada pendiente
});
