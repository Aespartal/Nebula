import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import Fastify from "fastify";
import type { AuthSession } from "@nebula/shared";
import { registerAuth } from "./auth/plugin.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { createSession } from "./auth/sessions.js";
import { openDb } from "./db/index.js";

const MIN = 60_000;
const DAY = 24 * 3600_000;

async function build() {
  const db = openDb(":memory:");
  const app = Fastify();
  await registerAuth(app, db);
  registerAuthRoutes(app, db);
  await app.ready();
  const user = (name: string, role: "admin" | "user" = "user") =>
    Number(db.prepare("INSERT INTO users(username,password_hash,role,created_at) VALUES(?,?,?,1)").run(name, "x", role).lastInsertRowid);
  const alex = user("alex", "admin");
  const otra = user("otra");
  const now = Date.now();
  // Tres sesiones de Alex (la de «portátil» es con la que se hacen las peticiones) y una de otra persona.
  const movil = createSession(db, alex, "Mozilla/5.0 (iPhone) Safari", now - 3 * DAY);
  const portatil = createSession(db, alex, "Mozilla/5.0 (Windows NT 10.0) Chrome/120", now - 2 * DAY);
  const tele = createSession(db, alex, "Mozilla/5.0 (Linux; Android) Chrome", now - 1 * DAY);
  const ajena = createSession(db, otra, "Mozilla/5.0 (Macintosh) Firefox", now - 1 * DAY);
  const touch = (token: string, lastSeen: number) =>
    db.prepare("UPDATE sessions SET last_seen=? WHERE token_hash=?").run(lastSeen, createHash("sha256").update(token).digest("hex"));
  touch(movil.token, now - 2 * DAY); touch(portatil.token, now - 5 * MIN); touch(tele.token, now - 1 * DAY); touch(ajena.token, now - MIN);
  const as = (t: { token: string }) => ({ cookie: `nebula_session=${t.token}` });
  const call = (method: "GET" | "DELETE", url: string, t?: { token: string }, headers: Record<string, string> = {}) =>
    app.inject({ method, url, headers: { ...(t ? as(t) : {}), ...headers } });
  const alive = async (t: { token: string }) => (await call("GET", "/api/auth/status", t)).json().user !== null;
  return { app, db, alex, otra, movil, portatil, tele, ajena, call, alive, now };
}

test("lista solo las sesiones de la cuenta, la más reciente primero y con la actual marcada", async () => {
  const { app, portatil, call } = await build();
  try {
    const r = await call("GET", "/api/auth/sessions", portatil);
    assert.equal(r.statusCode, 200);
    const list = r.json() as AuthSession[];
    assert.equal(list.length, 3, "no incluye la de otra persona");
    assert.deepEqual(list.map((s) => s.current), [true, false, false], "la de hace 5 min (la actual) va primero");
    assert.ok(list[0].userAgent!.includes("Windows"));
    assert.ok(list[1].lastSeen > list[2].lastSeen);
    assert.equal(list.filter((s) => s.current).length, 1);
  } finally { await app.close(); }
});

test("no se filtra ni el token ni el hash completo", async () => {
  const { app, db, alex, movil, portatil, tele, call } = await build();
  try {
    const body = (await call("GET", "/api/auth/sessions", portatil)).body;
    for (const t of [movil, portatil, tele]) assert.ok(!body.includes(t.token), "token en claro");
    for (const row of db.prepare("SELECT token_hash AS h FROM sessions WHERE user_id=?").all(alex) as { h: string }[]) {
      assert.ok(!body.includes(row.h), "hash completo");
    }
    for (const s of JSON.parse(body) as AuthSession[]) assert.match(s.id, /^[0-9a-f]{16}$/);
  } finally { await app.close(); }
});

test("las sesiones caducadas no salen", async () => {
  const { app, db, portatil, movil, call } = await build();
  try {
    db.prepare("UPDATE sessions SET expires_at=? WHERE token_hash=?").run(Date.now() - 1000, createHash("sha256").update(movil.token).digest("hex"));
    assert.equal(((await call("GET", "/api/auth/sessions", portatil)).json() as AuthSession[]).length, 2);
  } finally { await app.close(); }
});

test("cerrar otra sesión: 204 y esa sesión deja de valer, las demás siguen", async () => {
  const { app, portatil, movil, tele, call, alive } = await build();
  try {
    const list = (await call("GET", "/api/auth/sessions", portatil)).json() as AuthSession[];
    const movilId = list.find((s) => s.userAgent!.includes("iPhone"))!.id;
    assert.equal((await call("DELETE", `/api/auth/sessions/${movilId}`, portatil)).statusCode, 204);
    assert.equal(await alive(movil), false);
    assert.equal(await alive(tele), true);
    assert.equal(await alive(portatil), true);
    assert.equal(((await call("GET", "/api/auth/sessions", portatil)).json() as AuthSession[]).length, 2);
    assert.equal((await call("DELETE", `/api/auth/sessions/${movilId}`, portatil)).statusCode, 404, "ya no existe");
  } finally { await app.close(); }
});

test("la sesión actual no se cierra por esta vía (409) y sigue valiendo", async () => {
  const { app, portatil, call, alive } = await build();
  try {
    const cur = ((await call("GET", "/api/auth/sessions", portatil)).json() as AuthSession[]).find((s) => s.current)!;
    const r = await call("DELETE", `/api/auth/sessions/${cur.id}`, portatil);
    assert.equal(r.statusCode, 409);
    assert.equal(r.json().error, "current_session");
    assert.equal(await alive(portatil), true);
  } finally { await app.close(); }
});

test("no se puede cerrar la sesión de otra cuenta (404, y la víctima sigue dentro)", async () => {
  const { app, portatil, ajena, call, alive } = await build();
  try {
    const victimId = ((await call("GET", "/api/auth/sessions", ajena)).json() as AuthSession[])[0].id;
    assert.equal((await call("DELETE", `/api/auth/sessions/${victimId}`, portatil)).statusCode, 404);
    assert.equal(await alive(ajena), true);
  } finally { await app.close(); }
});

test("ids con formato raro: 404 sin tocar nada (ni comodines ni inyección)", async () => {
  const { app, portatil, tele, movil, call, alive } = await build();
  try {
    for (const id of ["%25", "_", "0", "zzzzzzzzzzzzzzzz", "0123456789abcdef0", "'%20OR%201=1--", "..%2F..%2Fx"]) {
      const r = await call("DELETE", `/api/auth/sessions/${id}`, portatil);
      assert.equal(r.statusCode, 404, id);
    }
    assert.equal((await call("DELETE", "/api/auth/sessions/%", portatil)).statusCode, 400, "URL mal codificada: la rechaza el servidor antes de llegar a la ruta");
    assert.equal(await alive(tele) && await alive(movil) && await alive(portatil), true);
  } finally { await app.close(); }
});

test("cerrar el resto: devuelve cuántas, deja la actual y no toca otras cuentas", async () => {
  const { app, portatil, movil, tele, ajena, call, alive } = await build();
  try {
    const r = await call("DELETE", "/api/auth/sessions", portatil);
    assert.equal(r.statusCode, 200);
    assert.deepEqual(r.json(), { closed: 2 });
    assert.equal(await alive(portatil), true);
    assert.equal(await alive(movil), false);
    assert.equal(await alive(tele), false);
    assert.equal(await alive(ajena), true);
    assert.deepEqual((await call("DELETE", "/api/auth/sessions", portatil)).json(), { closed: 0 });
  } finally { await app.close(); }
});

test("sin sesión: 401 en las tres rutas", async () => {
  const { app, call } = await build();
  try {
    assert.equal((await call("GET", "/api/auth/sessions")).statusCode, 401);
    assert.equal((await call("DELETE", "/api/auth/sessions")).statusCode, 401);
    assert.equal((await call("DELETE", "/api/auth/sessions/0123456789abcdef")).statusCode, 401);
  } finally { await app.close(); }
});

test("una petición desde otro origen no puede cerrar sesiones (CSRF)", async () => {
  const { app, portatil, tele, call, alive } = await build();
  try {
    const r = await call("DELETE", "/api/auth/sessions", portatil, { origin: "https://malo.example" });
    assert.equal(r.statusCode, 403);
    assert.equal(await alive(tele), true);
  } finally { await app.close(); }
});
