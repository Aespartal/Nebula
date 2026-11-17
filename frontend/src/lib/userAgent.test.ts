import { test } from "node:test";
import assert from "node:assert/strict";
import { describeUserAgent } from "./userAgent";

const CASES: [string, string][] = [
  ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", "Chrome en Windows"],
  ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0", "Edge en Windows"],
  ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 OPR/106.0.0.0", "Opera en Windows"],
  ["Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0", "Firefox en Linux"],
  ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1", "Safari en iOS"],
  ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1", "Chrome en iOS"],
  ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/121.0 Mobile/15E148 Safari/605.1.15", "Firefox en iOS"],
  ["Mozilla/5.0 (iPad; CPU OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1", "Safari en iOS"],
  ["Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36", "Chrome en Android"],
  ["Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36", "Samsung Internet en Android"],
  ["Mozilla/5.0 (Android 13; Mobile; rv:121.0) Gecko/121.0 Firefox/121.0", "Firefox en Android"],
  ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15", "Safari en macOS"],
  ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", "Chrome en macOS"],
  ["Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", "Chrome en ChromeOS"],
];

for (const [ua, expected] of CASES) test(`user-agent → ${expected}`, () => assert.equal(describeUserAgent(ua), expected));

test("sin dato o irreconocible: textos neutros, sin inventar", () => {
  assert.equal(describeUserAgent(null), "Dispositivo desconocido");
  assert.equal(describeUserAgent(undefined), "Dispositivo desconocido");
  assert.equal(describeUserAgent("   "), "Dispositivo desconocido");
  assert.equal(describeUserAgent("curl/8.4.0"), "Navegador desconocido");
  assert.equal(describeUserAgent("MiApp/1.0 (Android 14)"), "Navegador desconocido en Android");
});

test("un user-agent hostil no rompe nada ni se cuela en el texto", () => {
  const ua = '<script>alert(1)</script>"' + "A".repeat(5000);
  assert.equal(describeUserAgent(ua), "Navegador desconocido");
  assert.ok(!describeUserAgent(ua).includes("<"));
});
