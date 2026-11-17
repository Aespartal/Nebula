import assert from "node:assert/strict";
import test from "node:test";
import { openDb } from "../db/index.js";
import { KeyframeIndex, parseKeyframeCsv, planSegments, type KeyframeData } from "./keyframes.js";

test("parseKeyframeCsv: solo keyframes, ordenados, sin duplicados ni N/A, con el retardo dts→pts", () => {
  const d = parseKeyframeCsv([
    "0.000000,N/A,K_", "0.120000,0.040000,__", "10.005000,9.925000,K_", "5.005000,4.925000,K_", "5.005000,4.925000,K_",
    "N/A,N/A,K_", "15.005000,14.925000,K__", "20.000000,19.920000,_K",
  ]);
  assert.deepEqual(d.pts, [0, 5.005, 10.005, 15.005, 20]);
  assert.equal(d.delay, 0.08);
});

test("parseKeyframeCsv: sin dts (o absurdo) el retardo es 0 / como mucho 1 s", () => {
  assert.equal(parseKeyframeCsv(["0,N/A,K_", "4,N/A,K_"]).delay, 0);
  assert.equal(parseKeyframeCsv(["4,0.5,K_", "8,4,K_"]).delay, 1);
  assert.deepEqual(parseKeyframeCsv([]), { pts: [], delay: 0 });
});

test("planSegments: primer keyframe y después el primero que llega a 6 s, cerrando con la duración", () => {
  assert.deepEqual(planSegments([0, 2, 4, 6, 8, 10, 12, 14], 15), [0, 6, 12, 15]);
  // Cadencia irregular: los cortes siguen a los keyframes reales, no a una rejilla fija.
  assert.deepEqual(planSegments([0, 4.5, 13, 14.2, 22, 31, 40.4], 60), [0, 13, 22, 31, 40.4, 60]);
});

test("planSegments: el primer keyframe puede no ser 0 y la playlist empieza ahí", () => {
  assert.deepEqual(planSegments([1.4, 7.4, 13.4], 20), [1.4, 7.4, 13.4, 20]);
});

test("planSegments: un resto final casi vacío se absorbe y un keyframe pegado al final no crea segmento", () => {
  assert.deepEqual(planSegments([0, 6, 12, 19.6], 20), [0, 6, 12, 20]);
  assert.deepEqual(planSegments([0, 6, 12, 12.5], 12.8), [0, 6, 12.8]);
});

test("planSegments: sin garantías no hay plan (pocos keyframes, segmentos enormes, duración desconocida)", () => {
  assert.equal(planSegments([0], 100), null);
  assert.equal(planSegments([], 100), null);
  assert.equal(planSegments([0, 40, 80], 120), null, "segmentos de 40 s: arranque y saltos demasiado lentos");
  assert.equal(planSegments([0, 6, 12], 0), null);
  assert.equal(planSegments([0, 6, 12], NaN), null);
});

test("planSegments: los límites cubren siempre el archivo entero y ningún segmento pasa del máximo", () => {
  const kf = Array.from({ length: 400 }, (_, i) => i * 2.5 + (i % 7) * 0.1);
  const b = planSegments(kf, 1000)!;
  assert.equal(b[0], kf[0]);
  assert.equal(b[b.length - 1], 1000);
  for (let i = 1; i < b.length; i++) { assert.ok(b[i] > b[i - 1]); assert.ok(b[i] - b[i - 1] <= 30); }
});

// --- KeyframeIndex ---
function setup() {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO libraries(id,name,type,root_path) VALUES(1,'P','movies','/p')").run();
  db.prepare("INSERT INTO movies(id,library_id,title) VALUES(1,1,'X')").run();
  const add = (id: number, mtime = 1000, size = 5000) =>
    db.prepare("INSERT INTO media_files(id,library_id,movie_id,path,rel_path,size_bytes,mtime_ms) VALUES(?,1,1,?,?,?,?)").run(id, `/p/${id}.mkv`, `${id}.mkv`, size, mtime);
  add(1);
  let calls = 0;
  let release: (() => void) | null = null;
  const data: KeyframeData = { pts: [0, 6, 12], delay: 0.08 };
  const probe = async () => { calls++; if (release === null) return data; await new Promise<void>((r) => { release = r; }); return data; };
  return { db, add, probe, calls: () => calls, hold: () => { release = () => {}; }, unlock: () => release?.(), data };
}

test("KeyframeIndex: la primera vez calcula y guarda; después sale de la base sin volver a leer el archivo", async () => {
  const { db, probe, calls, data } = setup();
  const idx = new KeyframeIndex(db, "ffprobe", probe);
  assert.equal(idx.cached(1), null);
  assert.deepEqual(await idx.get(1, "/p/1.mkv", 0, 1000), data);
  assert.deepEqual(await idx.get(1, "/p/1.mkv", 0, 1000), data);
  assert.equal(calls(), 1);
  assert.deepEqual(idx.cached(1), data);
});

test("KeyframeIndex: si el archivo cambió (mtime o tamaño) el índice viejo no vale", async () => {
  const { db, probe, calls } = setup();
  const idx = new KeyframeIndex(db, "ffprobe", probe);
  await idx.get(1, "/p/1.mkv", 0, 1000);
  db.prepare("UPDATE media_files SET mtime_ms=2000 WHERE id=1").run();
  assert.equal(idx.cached(1), null);
  await idx.get(1, "/p/1.mkv", 0, 1000);
  db.prepare("UPDATE media_files SET size_bytes=9 WHERE id=1").run();
  assert.equal(idx.cached(1), null);
  await idx.get(1, "/p/1.mkv", 0, 1000);
  assert.equal(calls(), 3);
});

test("KeyframeIndex: peticiones simultáneas comparten un solo cálculo", async () => {
  const { db, probe, calls } = setup();
  const idx = new KeyframeIndex(db, "ffprobe", probe);
  const all = await Promise.all([1, 2, 3].map(() => idx.get(1, "/p/1.mkv", 0, 1000)));
  assert.ok(all.every((x) => x?.pts.length === 3));
  assert.equal(calls(), 1);
});

test("KeyframeIndex: quien no puede esperar recibe null, pero el cálculo termina y la siguiente vez está listo", async () => {
  const { db, probe, hold, unlock, calls } = setup();
  const idx = new KeyframeIndex(db, "ffprobe", probe);
  hold();
  assert.equal(await idx.get(1, "/p/1.mkv", 0, 20), null);
  assert.equal(idx.cached(1), null);
  unlock();
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(idx.cached(1), "el cálculo siguió en segundo plano");
  assert.equal(calls(), 1);
});

test("KeyframeIndex: si ffprobe falla devuelve null, no guarda nada y lo vuelve a intentar", async () => {
  const { db } = setup();
  let n = 0;
  const logs: string[] = [];
  const idx = new KeyframeIndex(db, "ffprobe", async () => { n++; throw new Error("boom"); }, (m) => logs.push(m));
  assert.equal(await idx.get(1, "/p/1.mkv", 0, 1000), null);
  assert.equal(await idx.get(1, "/p/1.mkv", 0, 1000), null);
  assert.equal(n, 2);
  assert.equal(idx.cached(1), null);
  assert.ok(logs[0].includes("boom"));
});

test("KeyframeIndex: archivos distintos se calculan de uno en uno, y borrar el archivo borra su índice", async () => {
  const { db, add } = setup();
  add(2);
  let running = 0, peak = 0;
  const idx = new KeyframeIndex(db, "ffprobe", async () => {
    running++; peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 15));
    running--;
    return { pts: [0, 6], delay: 0 };
  });
  await Promise.all([idx.get(1, "/p/1.mkv", 0, 1000), idx.get(2, "/p/2.mkv", 0, 1000)]);
  assert.equal(peak, 1, "leer dos archivos enteros a la vez satura el disco");
  db.prepare("DELETE FROM media_files WHERE id=1").run();
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM keyframe_index").get() as { n: number }).n, 1, "ON DELETE CASCADE");
});

test("KeyframeIndex: un archivo borrado mientras se leía no deja una fila huérfana", async () => {
  const { db } = setup();
  const idx = new KeyframeIndex(db, "ffprobe", async () => { db.prepare("DELETE FROM media_files WHERE id=1").run(); return { pts: [0, 6], delay: 0 }; });
  await idx.get(1, "/p/1.mkv", 0, 1000);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM keyframe_index").get() as { n: number }).n, 0);
});
