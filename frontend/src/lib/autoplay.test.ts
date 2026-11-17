import assert from "node:assert/strict";
import test from "node:test";
import { AUTOPLAY_SECONDS, countdownStep, shouldAutoplay } from "./autoplay";
import { autoplayNextPref } from "./prefs";

test("la cuenta atrás baja de uno en uno, avisa al llegar a 0 y no pasa de ahí", () => {
  let r = AUTOPLAY_SECONDS;
  const seen: number[] = [];
  for (let i = 0; i < AUTOPLAY_SECONDS; i++) { const s = countdownStep(r); r = s.remaining; seen.push(r); assert.equal(s.done, r === 0); }
  assert.deepEqual(seen, [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
  assert.deepEqual(countdownStep(0), { remaining: 0, done: true });
  assert.deepEqual(countdownStep(-3), { remaining: 0, done: true });
  assert.deepEqual(countdownStep(2.7), { remaining: 1, done: false });
});

test("hay margen para cancelar: la cuenta atrás es de varios segundos", () => {
  assert.ok(AUTOPLAY_SECONDS >= 5 && AUTOPLAY_SECONDS <= 15);
});

test("no arranca solo si está desactivado, si no hay siguiente o si está a pantalla completa", () => {
  const base = { enabled: true, hasNext: true, fullscreen: false };
  assert.equal(shouldAutoplay(base), true);
  assert.equal(shouldAutoplay({ ...base, enabled: false }), false);
  assert.equal(shouldAutoplay({ ...base, hasNext: false }), false);
  assert.equal(shouldAutoplay({ ...base, fullscreen: true }), false);
});

test("la preferencia es sí por defecto, también cuando no hay almacenamiento (modo privado)", () => {
  assert.equal(autoplayNextPref.get(), true); // en Node no existe localStorage: no debe romper
  assert.doesNotThrow(() => autoplayNextPref.set(false));
});

test("la preferencia solo guarda el «no» y vuelve al valor por defecto al activarla", () => {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k),
  };
  try {
    autoplayNextPref.set(false);
    assert.equal(autoplayNextPref.get(), false);
    assert.equal(store.size, 1);
    autoplayNextPref.set(true);
    assert.equal(autoplayNextPref.get(), true);
    assert.equal(store.size, 0, "sin claves de más");
  } finally { delete (globalThis as any).localStorage; }
});
