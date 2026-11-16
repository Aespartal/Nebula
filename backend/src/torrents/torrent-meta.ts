import { createHash } from "node:crypto";
import { TorrentError } from "./client.js";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32ToHex(s: string): string {
  let bits = "";
  for (const ch of s.toUpperCase()) {
    const v = BASE32.indexOf(ch);
    if (v < 0) throw new TorrentError("invalid_magnet", "El enlace magnet no es válido");
    bits += v.toString(2).padStart(5, "0");
  }
  let hex = "";
  for (let i = 0; i + 4 <= bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex.slice(0, 40);
}

/**
 * Valida un enlace magnet y devuelve su hash (hexadecimal en minúsculas).
 * Solo se aceptan enlaces `magnet:?xt=urn:btih:…`: nunca URLs, para que nadie haga pedir direcciones al servidor.
 */
export function magnetHash(uri: string): string {
  const bad = () => new TorrentError("invalid_magnet", "El enlace magnet no es válido");
  if (typeof uri !== "string" || uri.length > 4096 || /[\s\u0000-\u001f]/.test(uri.trim())) throw bad();
  let u: URL;
  try { u = new URL(uri.trim()); } catch { throw bad(); }
  if (u.protocol !== "magnet:") throw bad();
  const xt = u.searchParams.getAll("xt").find((v) => v.toLowerCase().startsWith("urn:btih:"));
  if (!xt) throw bad();
  const id = xt.slice("urn:btih:".length);
  if (/^[0-9a-f]{40}$/i.test(id)) return id.toLowerCase();
  if (/^[a-z2-7]{32}$/i.test(id)) return base32ToHex(id);
  throw bad();
}

type Bencoded = number | Buffer | Bencoded[] | { [k: string]: Bencoded };

/** Lector mínimo de bencode que recuerda dónde empieza y acaba cada valor del diccionario superior. */
function parse(buf: Buffer, i: number, depth = 0): [Bencoded, number] {
  if (depth > 32 || i >= buf.length) throw new Error("bencode");
  const c = buf[i];
  if (c === 0x69) { // i<número>e
    const end = buf.indexOf(0x65, i);
    if (end < 0) throw new Error("bencode");
    const n = Number(buf.toString("latin1", i + 1, end));
    if (!Number.isFinite(n)) throw new Error("bencode");
    return [n, end + 1];
  }
  if (c === 0x6c || c === 0x64) { // l…e | d…e
    const isDict = c === 0x64;
    let p = i + 1;
    const list: Bencoded[] = [];
    const dict: { [k: string]: Bencoded } = {};
    while (buf[p] !== 0x65) {
      if (p >= buf.length) throw new Error("bencode");
      if (isDict) {
        const [k, afterKey] = parse(buf, p, depth + 1);
        if (!Buffer.isBuffer(k)) throw new Error("bencode");
        const [v, afterVal] = parse(buf, afterKey, depth + 1);
        dict[k.toString("latin1")] = v;
        p = afterVal;
      } else {
        const [v, next] = parse(buf, p, depth + 1);
        list.push(v);
        p = next;
      }
    }
    return [isDict ? dict : list, p + 1];
  }
  if (c >= 0x30 && c <= 0x39) { // <largo>:<bytes>
    const colon = buf.indexOf(0x3a, i);
    if (colon < 0) throw new Error("bencode");
    const len = Number(buf.toString("latin1", i, colon));
    if (!Number.isInteger(len) || len < 0 || colon + 1 + len > buf.length) throw new Error("bencode");
    return [buf.subarray(colon + 1, colon + 1 + len), colon + 1 + len];
  }
  throw new Error("bencode");
}

/** Valida un archivo `.torrent` y devuelve su hash (SHA-1 del diccionario `info`, en hexadecimal). */
export function torrentHash(data: Buffer): string {
  const bad = () => new TorrentError("invalid_torrent", "El archivo no es un .torrent válido");
  if (!Buffer.isBuffer(data) || data.length < 20 || data[0] !== 0x64) throw bad();
  try {
    // Recorre el diccionario superior para conocer los límites exactos del valor de «info».
    let p = 1, infoStart = -1, infoEnd = -1;
    while (data[p] !== 0x65) {
      const [k, afterKey] = parse(data, p);
      if (!Buffer.isBuffer(k)) throw bad();
      const [, afterVal] = parse(data, afterKey);
      if (k.toString("latin1") === "info") { infoStart = afterKey; infoEnd = afterVal; }
      p = afterVal;
    }
    if (infoStart < 0 || data[infoStart] !== 0x64) throw bad();
    return createHash("sha1").update(data.subarray(infoStart, infoEnd)).digest("hex");
  } catch (e) {
    throw e instanceof TorrentError ? e : bad();
  }
}
