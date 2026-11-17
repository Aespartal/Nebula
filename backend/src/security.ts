import type { FastifyInstance } from "fastify";

const csp = (cast: boolean) => [
  "default-src 'self'",
  cast ? "script-src 'self' https://www.gstatic.com" : "script-src 'self'", // gstatic: SDK de Google Cast, solo si hay PUBLIC_URL
  "style-src 'self' 'unsafe-inline'", // React usa estilos en línea para la barra de progreso y similares
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/** Cabeceras de seguridad en todas las respuestas. HSTS solo si la petición llegó por HTTPS. */
export function registerSecurityHeaders(app: FastifyInstance, opts: { cast?: boolean } = {}) {
  const CSP = csp(!!opts.cast);
  app.addHook("onSend", async (req, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    reply.header("Cross-Origin-Opener-Policy", "same-origin");
    if (!req.url.startsWith("/api/")) reply.header("Content-Security-Policy", CSP);
    if (req.protocol === "https") reply.header("Strict-Transport-Security", "max-age=15552000");
    // Nada de cuentas ni sesiones en cachés compartidas o del navegador.
    if (req.url.startsWith("/api/auth") || req.url.startsWith("/api/users")) reply.header("Cache-Control", "no-store");
    return payload;
  });
}
