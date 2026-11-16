import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// scrypt viene con Node: no hace falta compilar nada (a diferencia de argon2) y es una opción recomendada por OWASP.
const N = 2 ** 15, R = 8, P = 1, KEYLEN = 32;
const opts: ScryptOptions = { N, r: R, p: P, maxmem: 128 * N * R * 2 };

const derive = (password: string, salt: Buffer, o: ScryptOptions = opts, len = KEYLEN) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(password.normalize("NFKC"), salt, len, o, (e, key) => (e ? reject(e) : resolve(key))));

/** Formato: scrypt$N$r$p$salt(base64)$hash(base64). Los parámetros viajan con el hash para poder subirlos en el futuro. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const nn = Number(n), rr = Number(r), pp = Number(p);
  try {
    const key = await derive(password, Buffer.from(salt, "base64"), { N: nn, r: rr, p: pp, maxmem: 128 * nn * rr * 2 }, expected.length);
    return key.length === expected.length && timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

/** Hash de relleno: se verifica contra él cuando el usuario no existe, para que el tiempo de respuesta no delate qué usuarios hay. */
export const DUMMY_HASH = await hashPassword(randomBytes(12).toString("hex"));
