/**
 * Comprobación de la conexión con qBittorrent (hito 0 de «Descargas»).
 * Uso:  npm run torrents:doctor        (lee TORRENT_URL, TORRENT_USER y TORRENT_PASS del entorno o de .env)
 * Solo lee, salvo una prueba reversible: crea y borra una categoría temporal para confirmar que Nebula podrá gestionarlas.
 */
import { QBittorrent, QbError } from "./qbittorrent.js";

const url = process.env.TORRENT_URL ?? "http://127.0.0.1:8080";
const username = process.env.TORRENT_USER ?? "";
const password = process.env.TORRENT_PASS ?? "";

let problems = 0;
const ok = (m: string) => console.log(`  ✓ ${m}`);
const warn = (m: string) => console.log(`  ! ${m}`);
const fail = (m: string, hint?: string) => { problems++; console.log(`  ✗ ${m}`); if (hint) console.log(`    → ${hint}`); };
const title = (m: string) => console.log(`\n${m}`);

if (!username || !password) {
  console.log("Faltan TORRENT_USER y TORRENT_PASS. Añádelos al archivo .env (junto a package.json):\n\n  TORRENT_URL=http://127.0.0.1:8080\n  TORRENT_USER=tu_usuario\n  TORRENT_PASS=tu_contraseña\n");
  process.exit(1);
}

const qb = new QBittorrent({ url, username, password });
const v = (x: unknown) => (x === undefined ? "(no existe en esta versión)" : String(x));

title(`Conexión con qBittorrent en ${url}`);
try {
  await qb.login();
  ok("Inicio de sesión correcto");
  ok(`qBittorrent ${await qb.version()} · API web ${await qb.webApiVersion()}`);
} catch (e) {
  const err = e as QbError;
  if (err.code === "unreachable") fail(err.message, "¿Está qBittorrent abierto y con la interfaz web activada (Herramientas → Opciones → Interfaz web)? ¿El puerto coincide con TORRENT_URL?");
  else if (err.code === "auth") fail(err.message, "Revisa TORRENT_USER y TORRENT_PASS. Cuidado: tras varios fallos seguidos qBittorrent bloquea la dirección un rato.");
  else if (err.code === "banned") fail(err.message, "Espera unos minutos, o reinicia qBittorrent, y vuelve a probar.");
  else fail(err.message);
  console.log("\nNo se puede seguir sin conexión.");
  process.exit(1);
}

title("Lectura");
try {
  const torrents = await qb.list();
  ok(`${torrents.length} torrent(s) en la lista`);
  const cats = await qb.categories();
  ok(`${Object.keys(cats).length} categoría(s): ${Object.keys(cats).join(", ") || "ninguna"}`);
} catch (e) { fail((e as Error).message); }

title("Carpetas");
let prefs: Record<string, unknown> = {};
try {
  prefs = await qb.preferences();
  ok(`Carpeta de descargas por defecto: ${v(prefs.save_path)}`);
  if (prefs.temp_path_enabled === true) ok(`Carpeta de descargas en curso: ${v(prefs.temp_path)}`);
  else warn("No hay carpeta separada para descargas en curso. Actívala en Opciones → Descargas → «Mantener los torrents incompletos en». Así Nebula nunca ve un vídeo a medias.");
  if (prefs.auto_tmm_enabled === true) ok("Gestión automática de torrents activada (se mueven a la carpeta de su categoría al terminar)");
  else warn("Gestión automática de torrents desactivada. Se activa en Opciones → Descargas → «Modo de gestión de torrents por defecto: Automático».");
} catch (e) { fail((e as Error).message); }

title("Siembra (recomendado: ratio 1,0 o 24 h, lo que ocurra primero, y pausar)");
const ratioOn = prefs.max_ratio_enabled === true;
const timeOn = prefs.max_seeding_time_enabled === true;
console.log(`  · Límite de ratio: ${ratioOn ? v(prefs.max_ratio) : "desactivado"}`);
console.log(`  · Límite de tiempo: ${timeOn ? `${v(prefs.max_seeding_time)} min` : "desactivado"}`);
console.log(`  · Al llegar al límite (max_ratio_act): ${v(prefs.max_ratio_act)}   [según la documentación: 0 = pausar, 1 = quitar torrent, 2 = super siembra, 3 = quitar torrent y archivos. Si lo que ves en Opciones no coincide, avísame]`);
if (!ratioOn && !timeOn) warn("Sin límites: seguirá compartiendo para siempre. Se configura en Opciones → BitTorrent → «Límites de compartición».");
if ((ratioOn || timeOn) && prefs.max_ratio_act !== undefined && prefs.max_ratio_act !== 0) warn("Al llegar al límite NO pausa. Con «eliminar» se perdería el archivo; ponlo en «Pausar torrent».");

title("Prueba de escritura (reversible)");
const name = "nebula-doctor";
try {
  await qb.createCategory(name, `${String(prefs.save_path ?? "").replace(/[\\/]+$/, "")}/${name}`);
  const created = (await qb.categories())[name];
  if (created) ok(`Categoría temporal creada (ruta ${created.savePath || "por defecto"})`);
  else fail("La categoría no aparece tras crearla");
  await qb.removeCategories([name]);
  if ((await qb.categories())[name]) fail("No se pudo borrar la categoría temporal"); else ok("Categoría temporal borrada");
} catch (e) {
  fail((e as Error).message, "Nebula necesita poder crear categorías para separar películas y series.");
  try { await qb.removeCategories([name]); } catch { /* ya no existía */ }
}

console.log(problems ? `\n${problems} problema(s). Corrígelos y vuelve a ejecutarlo.` : "\nTodo listo para el siguiente hito.");
process.exit(problems ? 1 : 0);
