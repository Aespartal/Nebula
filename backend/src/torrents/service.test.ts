import assert from "node:assert/strict";
import test from "node:test";
import type { TorrentClient, TorrentInfo } from "./client.js";
import { TorrentService, isActive, nextDelay, type TorrentServiceOptions } from "./service.js";

const mk = (hash: string, over: Partial<TorrentInfo> = {}): TorrentInfo => ({
  hash, name: `t-${hash}`, state: "downloading", progress: 0.2, done: false, sizeBytes: 100, downloadedBytes: 20,
  speedDown: 5, speedUp: 0, etaS: 10, category: "nebula-peliculas", savePath: "D:\\EnCurso", addedAt: null, completedAt: null, ...over,
});
const finished = (hash: string, over: Partial<TorrentInfo> = {}) => mk(hash, { state: "seeding", progress: 1, done: true, speedDown: 0, etaS: 0, ...over });

class Fake implements TorrentClient {
  torrents: TorrentInfo[] = [];
  down = false;
  lists = 0;
  async check() { return { ok: !this.down }; }
  async list() { this.lists++; if (this.down) throw new Error("ECONNREFUSED"); return this.torrents.map((t) => ({ ...t })); }
  async addMagnet() { return "x"; } async addFile() { return "x"; }
  async pause() {} async resume() {} async remove() {}
  async ensureCategory() {} async freeSpaceBytes() { return null; }
}

function setup(opts: TorrentServiceOptions = {}) {
  const fake = new Fake();
  const done: string[] = [];
  const logs: string[] = [];
  const svc = new TorrentService(fake, { onCompleted: (t) => { done.push(t.hash); }, log: (m) => logs.push(m), ...opts });
  return { fake, svc, done, logs };
}

test("completado: se avisa una sola vez, aunque siga apareciendo terminado", async () => {
  const { fake, svc, done } = setup();
  fake.torrents = [mk("a")];
  await svc.refresh();
  assert.deepEqual(done, []);
  fake.torrents = [finished("a")];
  await svc.refresh(); await svc.refresh(); await svc.refresh();
  assert.deepEqual(done, ["a"]);
});

test("los torrents que ya estaban terminados al arrancar no disparan el aviso", async () => {
  const { fake, svc, done } = setup();
  fake.torrents = [finished("viejo")];
  await svc.refresh(); await svc.refresh();
  assert.deepEqual(done, []);
});

test("mientras se mueve a su carpeta final no cuenta como terminado; avisa cuando ya está en su sitio", async () => {
  const { fake, svc, done } = setup();
  fake.torrents = [mk("a")];
  await svc.refresh();
  fake.torrents = [finished("a", { state: "moving" })];
  await svc.refresh();
  assert.deepEqual(done, []);
  fake.torrents = [finished("a", { state: "checking" })];
  await svc.refresh();
  assert.deepEqual(done, []);
  fake.torrents = [finished("a", { state: "paused" })]; // parado al llegar al límite de siembra: también es «terminado»
  await svc.refresh();
  assert.deepEqual(done, ["a"]);
});

test("shouldNotify (la base de datos) permite avisar de lo que terminó con Nebula apagado", async () => {
  const pendientes = new Set(["x"]);
  const { fake, svc, done } = setup({ shouldNotify: (t) => pendientes.has(t.hash) });
  fake.torrents = [finished("x"), finished("y")];
  await svc.refresh(); await svc.refresh();
  assert.deepEqual(done, ["x"]);
});

test("si quitas un torrent y lo vuelves a añadir, avisa otra vez al terminar", async () => {
  const { fake, svc, done } = setup();
  fake.torrents = [mk("a")]; await svc.refresh();
  fake.torrents = [finished("a")]; await svc.refresh();
  fake.torrents = []; await svc.refresh();
  fake.torrents = [mk("a")]; await svc.refresh();
  fake.torrents = [finished("a")]; await svc.refresh();
  assert.deepEqual(done, ["a", "a"]);
});

test("un fallo dentro del aviso no lo repite en bucle ni rompe el sondeo", async () => {
  let calls = 0;
  const { fake, svc, logs } = setup({ onCompleted: () => { calls++; throw new Error("fallo al escanear"); } });
  fake.torrents = [mk("a")]; await svc.refresh();
  fake.torrents = [finished("a")]; await svc.refresh(); await svc.refresh();
  assert.equal(calls, 1);
  assert.ok(logs.some((l) => /fallo al escanear/.test(l)));
  assert.equal(svc.snapshot().connected, true);
});

test("cliente caído: se marca desconectado, conserva la última lista y se recupera solo", async () => {
  const { fake, svc, logs } = setup();
  fake.torrents = [mk("a")];
  await svc.refresh();
  fake.down = true;
  await svc.refresh(); await svc.refresh();
  const s = svc.snapshot();
  assert.equal(s.connected, false);
  assert.match(s.error!, /ECONNREFUSED/);
  assert.equal(s.torrents.length, 1, "no se vacía la lista por un fallo momentáneo");
  assert.equal(logs.filter((l) => /no responde/.test(l)).length, 1, "avisa una sola vez, no en cada reintento");
  fake.down = false;
  await svc.refresh();
  assert.equal(svc.snapshot().connected, true);
  assert.ok(logs.some((l) => /vuelve a responder/.test(l)));
});

test("varios refresh a la vez comparten un solo sondeo", async () => {
  const { fake, svc } = setup();
  await Promise.all([svc.refresh(), svc.refresh(), svc.refresh()]);
  assert.equal(fake.lists, 1);
});

test("espera entre sondeos: rápida con trabajo, lenta en reposo y creciente si el cliente no responde", () => {
  const base = { activeMs: 3000, idleMs: 30_000, backoffMs: 5000, maxBackoffMs: 60_000 };
  assert.equal(nextDelay({ ...base, active: true, failures: 0 }), 3000);
  assert.equal(nextDelay({ ...base, active: false, failures: 0 }), 30_000);
  assert.deepEqual([1, 2, 3, 4, 5, 9].map((failures) => nextDelay({ ...base, active: true, failures })), [5000, 10_000, 20_000, 40_000, 60_000, 60_000]);
});

test("qué cuenta como «en curso»", () => {
  assert.ok(isActive(mk("a")));
  assert.ok(isActive(mk("a", { state: "checking" })));
  assert.ok(isActive(mk("a", { state: "queued" })));
  assert.ok(isActive(mk("a", { state: "stalled" })));
  assert.ok(!isActive(finished("a")));
  assert.ok(!isActive(finished("a", { state: "paused" })));
  assert.ok(!isActive(mk("a", { state: "paused" })));
  assert.ok(isActive(finished("a", { state: "moving" })));
});

test("start/stop: sondea solo y se detiene del todo", async () => {
  const { fake, svc } = setup({ activeMs: 15, idleMs: 15 });
  fake.torrents = [mk("a")];
  svc.start(); svc.start(); // llamarlo dos veces no duplica el bucle
  await new Promise((r) => setTimeout(r, 120));
  svc.stop();
  const n = fake.lists;
  assert.ok(n >= 3 && n <= 12, `sondeos: ${n}`);
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(fake.lists, n, "tras stop() no sondea más");
});
