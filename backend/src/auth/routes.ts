import type { FastifyInstance } from "fastify";
import type { AuthStatus, User } from "@nebula/shared";
import type { Db } from "../db/index.js";
import { clearSessionCookie, requireAdmin, setSessionCookie } from "./plugin.js";
import { FailureLimiter } from "./limiter.js";
import { DUMMY_HASH, hashPassword, verifyPassword } from "./password.js";
import { createSession, deleteSession, deleteUserSessions, type Role } from "./sessions.js";

const USERNAME_RE = /^[\p{L}\p{N}_.-]{3,32}$/u;
export const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200;

interface UserRow { id: number; username: string; role: Role; password_hash: string; created_at: number }
const toUser = (r: UserRow): User => ({ id: r.id, username: r.username, role: r.role, createdAt: r.created_at });

const credentials = {
  type: "object", required: ["username", "password"], additionalProperties: false,
  properties: { username: { type: "string", maxLength: 64 }, password: { type: "string", maxLength: MAX_PASSWORD } },
} as const;

function checkNewUser(username: string, password: string): string | null {
  if (!USERNAME_RE.test(username)) return "invalid_username";
  if (password.length < MIN_PASSWORD) return "weak_password";
  return null;
}

export function registerAuthRoutes(app: FastifyInstance, db: Db) {
  const perUser = new FailureLimiter(5, 15 * 60_000);
  const perIp = new FailureLimiter(30, 15 * 60_000);
  const userCount = () => (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
  const adminCount = () => (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin'").get() as { n: number }).n;
  const byId = (id: number) => db.prepare("SELECT * FROM users WHERE id=?").get(id) as UserRow | undefined;

  app.get("/api/auth/status", async (req): Promise<AuthStatus> => ({
    setupRequired: userCount() === 0,
    user: req.user,
  }));

  // Primer arranque: crea el administrador. Solo funciona mientras no exista ningún usuario.
  app.post<{ Body: { username: string; password: string } }>(
    "/api/auth/setup", { schema: { body: credentials } },
    async (req, reply) => {
      const { username, password } = req.body;
      const problem = checkNewUser(username, password);
      if (problem) return reply.code(400).send({ error: problem });
      const hash = await hashPassword(password);
      let id: number | null = null;
      db.transaction(() => { // la comprobación y el alta van juntas: dos peticiones a la vez no crean dos administradores
        if (userCount() === 0) {
          id = Number(db.prepare("INSERT INTO users(username,password_hash,role,created_at) VALUES(?,?,'admin',?)")
            .run(username, hash, Date.now()).lastInsertRowid);
        }
      })();
      if (id === null) return reply.code(409).send({ error: "already_set_up" });
      const s = createSession(db, id, req.headers["user-agent"]);
      setSessionCookie(req, reply, s.token);
      return reply.code(201).send(toUser(byId(id)!));
    },
  );

  app.post<{ Body: { username: string; password: string } }>(
    "/api/auth/login", { schema: { body: credentials } },
    async (req, reply) => {
      const { username, password } = req.body;
      const kUser = `${req.ip}|${username.toLowerCase()}`;
      const wait = Math.max(perUser.retryAfter(kUser), perIp.retryAfter(req.ip));
      if (wait > 0) return reply.code(429).header("Retry-After", String(wait)).send({ error: "too_many_attempts", retryAfter: wait });

      const row = db.prepare("SELECT * FROM users WHERE username=?").get(username) as UserRow | undefined;
      const ok = await verifyPassword(password, row?.password_hash ?? DUMMY_HASH);
      if (!row || !ok) {
        perUser.fail(kUser); perIp.fail(req.ip);
        return reply.code(401).send({ error: "invalid_credentials" }); // mismo mensaje para usuario o contraseña incorrectos
      }
      perUser.reset(kUser);
      const s = createSession(db, row.id, req.headers["user-agent"]);
      setSessionCookie(req, reply, s.token);
      return toUser(row);
    },
  );

  app.post("/api/auth/logout", async (req, reply) => {
    if (req.sessionToken) deleteSession(db, req.sessionToken);
    clearSessionCookie(reply);
    return reply.code(204).send();
  });

  // Cambio de contraseña propio: cierra las demás sesiones de esta cuenta.
  app.post<{ Body: { current: string; next: string } }>(
    "/api/auth/password",
    { schema: { body: { type: "object", required: ["current", "next"], properties: { current: { type: "string", maxLength: MAX_PASSWORD }, next: { type: "string", maxLength: MAX_PASSWORD } } } } },
    async (req, reply) => {
      const row = byId(req.user!.id)!;
      if (req.body.next.length < MIN_PASSWORD) return reply.code(400).send({ error: "weak_password" });
      const key = `pw|${row.id}`;
      const wait = perUser.retryAfter(key);
      if (wait > 0) return reply.code(429).header("Retry-After", String(wait)).send({ error: "too_many_attempts", retryAfter: wait });
      if (!(await verifyPassword(req.body.current, row.password_hash))) {
        perUser.fail(key);
        return reply.code(401).send({ error: "invalid_credentials" });
      }
      perUser.reset(key);
      db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(await hashPassword(req.body.next), row.id);
      deleteUserSessions(db, row.id, req.sessionToken ?? undefined);
      return reply.code(204).send();
    },
  );

  // --- Gestión de usuarios (solo administradores) ---
  app.get("/api/users", { preHandler: requireAdmin }, async (): Promise<User[]> =>
    (db.prepare("SELECT * FROM users ORDER BY username COLLATE NOCASE").all() as UserRow[]).map(toUser));

  app.post<{ Body: { username: string; password: string; role?: Role } }>(
    "/api/users",
    {
      preHandler: requireAdmin,
      schema: { body: { ...credentials, properties: { ...credentials.properties, role: { enum: ["admin", "user"] } } } },
    },
    async (req, reply) => {
      const { username, password, role = "user" } = req.body;
      const problem = checkNewUser(username, password);
      if (problem) return reply.code(400).send({ error: problem });
      try {
        const id = Number(db.prepare("INSERT INTO users(username,password_hash,role,created_at) VALUES(?,?,?,?)")
          .run(username, await hashPassword(password), role, Date.now()).lastInsertRowid);
        return reply.code(201).send(toUser(byId(id)!));
      } catch {
        return reply.code(409).send({ error: "username_taken" });
      }
    },
  );

  // Restablecer la contraseña de otra cuenta (cierra sus sesiones).
  app.post<{ Params: { id: string }; Body: { password: string } }>(
    "/api/users/:id/password",
    { preHandler: requireAdmin, schema: { body: { type: "object", required: ["password"], properties: { password: { type: "string", maxLength: MAX_PASSWORD } } } } },
    async (req, reply) => {
      const u = byId(Number(req.params.id));
      if (!u) return reply.code(404).send({ error: "not_found" });
      if (req.body.password.length < MIN_PASSWORD) return reply.code(400).send({ error: "weak_password" });
      db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(await hashPassword(req.body.password), u.id);
      deleteUserSessions(db, u.id, u.id === req.user!.id ? req.sessionToken ?? undefined : undefined);
      return reply.code(204).send();
    },
  );

  app.delete<{ Params: { id: string } }>("/api/users/:id", { preHandler: requireAdmin }, async (req, reply) => {
    const u = byId(Number(req.params.id));
    if (!u) return reply.code(404).send({ error: "not_found" });
    if (u.id === req.user!.id) return reply.code(409).send({ error: "cannot_delete_self" });
    if (u.role === "admin" && adminCount() <= 1) return reply.code(409).send({ error: "last_admin" });
    db.prepare("DELETE FROM users WHERE id=?").run(u.id); // sesiones y progreso se borran en cascada
    return reply.code(204).send();
  });
}
