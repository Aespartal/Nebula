import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { TorrentError } from "./client.js";
import { magnetHash, torrentHash } from "./torrent-meta.js";

const HEX = "c12fe1c06bba254a9dc9f519b335aa7c1367a88a";
// El mismo hash en base32 (formato antiguo de los magnet)
const B32 = "YEX6DQDLXISUVHOJ6UM3GNNKPQJWPKEK";

test("magnet: acepta hash hexadecimal y base32, y lo devuelve en minúsculas", () => {
  assert.equal(magnetHash(`magnet:?xt=urn:btih:${HEX.toUpperCase()}&dn=debian&tr=udp%3A%2F%2Ftracker`), HEX);
  assert.equal(magnetHash(`magnet:?xt=urn:btih:${B32}`), HEX);
});

test("magnet: rechaza URLs, texto raro y hashes mal formados", () => {
  for (const bad of [
    "http://ejemplo.com/a.torrent", "https://ejemplo.com/?xt=urn:btih:" + HEX, "file:///etc/passwd",
    "magnet:?dn=sin-hash", "magnet:?xt=urn:btih:corto", `magnet:?xt=urn:btih:${HEX}\nhttp://x`, "", "  ",
    "magnet:?xt=urn:btih:" + "z".repeat(40), "magnet:?xt=urn:btih:" + HEX + "a".repeat(5000),
  ]) assert.throws(() => magnetHash(bad), (e) => e instanceof TorrentError && e.code === "invalid_magnet", bad.slice(0, 40));
});

/** .torrent mínimo hecho a mano: el hash es el SHA-1 de los bytes del diccionario «info». */
function makeTorrent(info: string, extra = "") {
  const infoBytes = Buffer.from(info, "latin1");
  const announce = "http://t.ejemplo/a";
  const buf = Buffer.concat([Buffer.from(`d8:announce${announce.length}:${announce}${extra}4:info`, "latin1"), infoBytes, Buffer.from("e", "latin1")]);
  return { buf, hash: createHash("sha1").update(infoBytes).digest("hex") };
}

test(".torrent: el hash es el SHA-1 del diccionario info, sin importar el orden de claves del resto", () => {
  const info = "d6:lengthi1048576e4:name8:film.mkv12:piece lengthi262144e6:pieces20:AAAAAAAAAAAAAAAAAAAAe";
  const a = makeTorrent(info);
  assert.equal(torrentHash(a.buf), a.hash);
  const b = makeTorrent(info, "7:comment4:hola");
  assert.equal(torrentHash(b.buf), b.hash);
  assert.equal(torrentHash(a.buf), torrentHash(b.buf));
});

test(".torrent: rechaza lo que no es un torrent válido", () => {
  for (const bad of [
    Buffer.from("esto no es un torrent, es texto"), Buffer.alloc(0), Buffer.from("d3:foo3:bare" + "x".repeat(30)),
    Buffer.from("d4:infoi5ee" + "x".repeat(20)), // «info» no es un diccionario
    Buffer.from("d4:infod4:name3:abc"), // truncado
    Buffer.from("l" + "l".repeat(100) + "e".repeat(101)), // anidado excesivo y no empieza por «d»
    Buffer.from("d" + "l".repeat(60) + "e".repeat(60) + "e"),
  ]) assert.throws(() => torrentHash(bad), (e) => e instanceof TorrentError && e.code === "invalid_torrent");
});
