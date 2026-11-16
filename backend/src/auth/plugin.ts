import cookie from "@fastify/cookie";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Db } from "../db/index.js";
import { getSessionUser, purgeExpiredSessions, SESSION_TTL_MS, type AuthUser } from "./sessions.js";

export const COOKIE_NAME = "nebula_session";

declare module "fastify" {
  interface FastifyRequest {
    user: AuthUser | null;
    sessionToken: string | null;
  }
}

/** Rutas accesibles sin sesión. Todo lo demás bajo /api la exige. */
const PUBLIC = new Set(["/api/health", "/api/auth/status", "/api/auth/setup", "/api/auth/login"]);

export function setSessionCookie(req: FastifyRequest, reply: FastifyReply, token: string) {
  reply.setCookie(COOKIE_NAME, token, {
    path: "/", httpOnly: true, sameSite: "lax",
    secure: req.protocol === "https", // con HTTPS (fase 6) la cookie solo viaja cifrada
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export const clearSessionCookie = (reply: FastifyReply) => reply.clearCookie(COOKIE_NAME, { path: "/" });

export async function registerAuth(app: FastifyInstance, db: Db) {
  await app.register(cookie);
  app.decorateRequest("user", null);
  app.decorateRequest("sessionToken", null);
  purgeExpiredSessions(db);

  app.addHook("onRequest", async (req, reply) => {
    const url = req.url.split("?")[0];
    if (!url.startsWith("/api/")) return; // el frontend estático es público; los datos no

    // Defensa contra CSRF además de SameSite=Lax: una petición que cambia datos debe venir de nuestro propio origen.
    if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
      const origin = req.headers.origin;
      const site = req.headers["sec-fetch-site"];
      let bad = typeof site === "string" && site !== "same-origin" && site !== "none";
      if (origin && origin !== "null") {
        try { bad ||= new URL(origin).host !== req.host; } catch { bad = true; }
      } else if (origin === "null") bad = true;
      if (bad) return reply.code(403).send({ error: "bad_origin" });
    }

    const token = req.cookies[COOKIE_NAME];
    if (token) {
      const user = getSessionUser(db, token);
      if (user) { req.user = user; req.sessionToken = token; }
      else clearSessionCookie(reply); // cookie caducada o revocada
    }
    if (!req.user && !PUBLIC.has(url)) return reply.code(401).send({ error: "unauthorized" });
  });
}

/** preHandler para rutas solo de administradores. */
export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  if (req.user?.role !== "admin") return reply.code(403).send({ error: "forbidden" });
}
