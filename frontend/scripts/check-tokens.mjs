// Comprueba los contrastes WCAG de los pares de colores que la app usa de verdad.
// Uso: npm run tokens   (falla con código 1 si algún par no llega)
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");
const c = Object.fromEntries([...css.matchAll(/--color-([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));

const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(c[a]), lum(c[b])].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const backgrounds = ["bg", "surface", "raised"];
const checks = [];
for (const fg of ["text", "soft", "muted", "faint", "accent", "ok", "warn", "danger"])
  for (const bg of backgrounds) checks.push([fg, bg, 4.5, "texto"]);
checks.push(["on-accent", "accent", 4.5, "texto sobre botón principal"]);
for (const bg of ["bg", "surface"]) checks.push(["line", bg, 3, "borde de control"]);
checks.push(["accent", "bg", 3, "anillo de foco"]);

let bad = 0;
for (const [fg, bg, min, what] of checks) {
  if (!c[fg] || !c[bg]) { console.log(`FALTA  ${fg} o ${bg} en tokens.css`); bad++; continue; }
  const r = ratio(fg, bg);
  const ok = r >= min;
  if (!ok) bad++;
  console.log(`${ok ? "ok    " : "FALLA "} ${fg.padEnd(10)} sobre ${bg.padEnd(8)} ${r.toFixed(2).padStart(5)}:1  (mín. ${min}, ${what})`);
}
console.log(bad ? `\n${bad} par(es) sin contraste suficiente` : "\nTodos los contrastes cumplen WCAG AA");
process.exit(bad ? 1 : 0);
