import { test } from "node:test";
import assert from "node:assert/strict";
import { OFFSET_MAX_S, clampOffset, formatOffset, shiftCues, type CueOriginals } from "./subtitleOffset";
import { subtitleOffsetPref } from "./prefs";

const cues = () => [{ startTime: 10, endTime: 12 }, { startTime: 0.2, endTime: 1 }, { startTime: 60, endTime: 63.5 }];
const times = (l: { startTime: number; endTime: number }[]) => l.map((c) => [c.startTime, c.endTime]);

test("clampOffset: múltiplos de 0,5, dentro de ±60 y sin valores raros", () => {
  assert.equal(clampOffset(0.5), 0.5);
  assert.equal(clampOffset(0.7), 0.5);
  assert.equal(clampOffset(0.8), 1);
  assert.equal(clampOffset(-1.25), -1);
  assert.equal(clampOffset(1000), OFFSET_MAX_S);
  assert.equal(clampOffset(-1000), -OFFSET_MAX_S);
  assert.equal(clampOffset(NaN), 0);
  assert.equal(clampOffset(Infinity), 0);
  assert.equal(Object.is(clampOffset(-0.1), -0), false, "no deja un -0");
});

test("formatOffset: signo explícito y coma decimal", () => {
  assert.equal(formatOffset(0), "0,0 s");
  assert.equal(formatOffset(0.5), "+0,5 s");
  assert.equal(formatOffset(-1.5), "−1,5 s");
  assert.equal(formatOffset(12), "+12,0 s");
});

test("shiftCues: desplaza inicio y fin de todas las líneas", () => {
  const c = cues(); const o: CueOriginals = new WeakMap();
  shiftCues(c, 1.5, o);
  assert.deepEqual(times(c), [[11.5, 13.5], [1.7, 2.5], [61.5, 65]]);
});

test("shiftCues: aplicar varias veces el mismo ajuste no acumula", () => {
  const c = cues(); const o: CueOriginals = new WeakMap();
  shiftCues(c, 2, o); shiftCues(c, 2, o); shiftCues(c, 2, o);
  assert.deepEqual(times(c), [[12, 14], [2.2, 3], [62, 65.5]]);
});

test("shiftCues: cambiar de ajuste parte del original, y 0 devuelve el original exacto", () => {
  const c = cues(); const o: CueOriginals = new WeakMap();
  shiftCues(c, 3, o); shiftCues(c, -1, o);
  assert.deepEqual(times(c), [[9, 11], [0, 0], [59, 62.5]]);
  shiftCues(c, 0, o);
  assert.deepEqual(times(c), times(cues()));
});

test("shiftCues: nunca deja tiempos negativos", () => {
  const c = [{ startTime: 0.2, endTime: 1 }]; const o: CueOriginals = new WeakMap();
  shiftCues(c, -5, o);
  assert.deepEqual(times(c), [[0, 0]]);
});

test("shiftCues: lista vacía o aún sin cargar no rompe", () => {
  assert.doesNotThrow(() => shiftCues([], 1, new WeakMap()));
});

// --- Persistencia por vídeo y pista ---
function fakeStorage(init: Record<string, string> = {}) {
  const data = new Map(Object.entries(init));
  (globalThis as any).localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
  };
  return data;
}

test("prefs: se guarda por vídeo y por pista, y 0 borra la clave", () => {
  const data = fakeStorage();
  assert.equal(subtitleOffsetPref.get(7, 2), 0);
  subtitleOffsetPref.set(7, 2, 1.5);
  subtitleOffsetPref.set(7, 3, -0.5);
  subtitleOffsetPref.set(8, 2, 4);
  assert.equal(subtitleOffsetPref.get(7, 2), 1.5);
  assert.equal(subtitleOffsetPref.get(7, 3), -0.5);
  assert.equal(subtitleOffsetPref.get(8, 2), 4);
  assert.equal(data.size, 3);
  subtitleOffsetPref.set(7, 2, 0);
  assert.equal(data.has("nebula.subOffset.7.2"), false);
  assert.equal(subtitleOffsetPref.get(7, 2), 0);
});

test("prefs: un valor guardado corrupto o fuera de rango no rompe nada", () => {
  fakeStorage({ "nebula.subOffset.1.1": "abc", "nebula.subOffset.1.2": "9999", "nebula.subOffset.1.3": "" });
  assert.equal(subtitleOffsetPref.get(1, 1), 0);
  assert.equal(subtitleOffsetPref.get(1, 2), OFFSET_MAX_S);
  assert.equal(subtitleOffsetPref.get(1, 3), 0);
});

test("prefs: sin almacenamiento (modo privado) no lanza excepciones", () => {
  (globalThis as any).localStorage = {
    getItem() { throw new Error("denegado"); }, setItem() { throw new Error("denegado"); }, removeItem() { throw new Error("denegado"); },
  };
  assert.equal(subtitleOffsetPref.get(1, 1), 0);
  assert.doesNotThrow(() => subtitleOffsetPref.set(1, 1, 2));
  assert.doesNotThrow(() => subtitleOffsetPref.set(1, 1, 0));
});
