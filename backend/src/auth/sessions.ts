import { createHash, randomBytes } from "node:crypto";
import type { Db } from "../db/index.js";

export type Role = "admin" | "user";
export interface AuthUser { id: number; username: string; role: Role }

export const SESSION_TTL_MS = 30 * 24 * 3600_000;
const TOUCH_EVERY_MS = 10 * 60_000;

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export function createSession(db: Db, userId: number, userAgent?: string, now = Date.now()): { token: string; expiresAt: number } {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = now + SESSION_TTL_MS;
  db.prepare("INSERT INTO sessions(token_hash,user_id,created_at,last_seen,expires_at,user_agent) VALUES(?,?,?,?,?,?)")
    .run(hashToken(token), userId, now, now, expiresAt, userAgent?.slice(0, 200) ?? null);
  return { token, expiresAt };
}

/** Devuelve el usuario de una sesión válida y la renueva (caducidad deslizante) como mucho cada 10 min. */
export function getSessionUser(db: Db, token: string, now = Date.now()): AuthUser | null {
  const h = hashToken(token);
  const row = db.prepare(`
    SELECT u.id, u.username, u.role, s.last_seen AS lastSeen, s.expires_at AS expiresAt
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).get(h) as
    | { id: number; username: string; role: Role; lastSeen: number; expiresAt: number } | undefined;
  if (!row) return null;
  if (row.expiresAt <= now) { db.prepare("DELETE FROM sessions WHERE token_hash=?").run(h); return null; }
  if (now - row.lastSeen > TOUCH_EVERY_MS) {
    db.prepare("UPDATE sessions SET last_seen=?, expires_at=? WHERE token_hash=?").run(now, now + SESSION_TTL_MS, h);
  }
  return { id: row.id, username: row.username, role: row.role };
}

export const deleteSession = (db: Db, token: string) => db.prepare("DELETE FROM sessions WHERE token_hash=?").run(hashToken(token));

/** Cierra todas las sesiones de un usuario, salvo (opcionalmente) la actual. */
export function deleteUserSessions(db: Db, userId: number, exceptToken?: string) {
  if (exceptToken) db.prepare("DELETE FROM sessions WHERE user_id=? AND token_hash<>?").run(userId, hashToken(exceptToken));
  else db.prepare("DELETE FROM sessions WHERE user_id=?").run(userId);
}

export const purgeExpiredSessions = (db: Db, now = Date.now()) => db.prepare("DELETE FROM sessions WHERE expires_at<=?").run(now);
