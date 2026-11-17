import { useState, type FormEvent } from "react";
import type { AuthSession } from "@nebula/shared";
import { PasswordField, describeAuthError, MIN_PASSWORD } from "../pages/Access";
import { useAuth, useUser } from "../lib/auth";
import { formatAgo, formatDate, plural } from "../lib/format";
import { sendJson, useApi } from "../lib/useApi";
import { describeUserAgent } from "../lib/userAgent";
import { Button } from "./Button";
import { ErrorBox, Loading } from "./States";

/** Dónde está abierta la cuenta: se puede cerrar cada sesión o todas menos esta. */
function Sessions() {
  const { data, error, loading, reload } = useApi<AuthSession[]>("/api/auth/sessions");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const others = (data ?? []).filter((s) => !s.current);

  async function revoke(s: AuthSession) {
    setBusy(s.id); setNote("");
    const r = await sendJson("DELETE", `/api/auth/sessions/${s.id}`);
    setBusy(null);
    setNote(r.ok ? "Sesión cerrada." : r.status === 404 ? "Esa sesión ya estaba cerrada." : "No se pudo cerrar la sesión.");
    reload();
  }

  async function revokeOthers() {
    setBusy("all"); setNote("");
    const r = await sendJson<{ closed: number }>("DELETE", "/api/auth/sessions");
    setBusy(null);
    setNote(!r.ok ? "No se pudieron cerrar las demás sesiones."
      : r.data.closed === 0 ? "No había otras sesiones abiertas." : `Se cerró ${plural(r.data.closed, "sesión", "sesiones")}.`);
    reload();
  }

  return (
    <div className="mt-8">
      <h3 className="text-base font-bold tracking-tight">Sesiones abiertas</h3>
      <p className="mt-1 text-muted">Los dispositivos donde has entrado. Cierra los que ya no uses.</p>
      {loading && !data && <Loading />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && (
        <ul className="mt-3 divide-y divide-rule rounded-ctl border border-rule bg-surface">
          {data.map((s) => {
            const label = describeUserAgent(s.userAgent);
            return (
              <li key={s.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-bold" title={s.userAgent ?? undefined}>
                    {label}
                    {s.current && (
                      <span className="ml-2 rounded-ctl border border-rule bg-raised px-1.5 py-0.5 align-middle font-mono text-label font-normal text-soft">ESTA SESIÓN</span>
                    )}
                  </p>
                  <p className="mt-0.5 font-mono text-label text-faint tabular">
                    {s.current ? "Activa ahora" : `Última actividad ${formatAgo(s.lastSeen)}`} · Iniciada el {formatDate(s.createdAt)}
                  </p>
                </div>
                {!s.current && (
                  <Button variant="secondary" disabled={busy !== null} aria-busy={busy === s.id} onClick={() => revoke(s)}
                    aria-label={`Cerrar la sesión de ${label}, iniciada el ${formatDate(s.createdAt)}`}>
                    {busy === s.id ? "Cerrando…" : "Cerrar"}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {others.length > 0 && (
        <Button variant="secondary" className="mt-3 w-full sm:w-auto" disabled={busy !== null} aria-busy={busy === "all"} onClick={revokeOthers}>
          {busy === "all" ? "Cerrando…" : "Cerrar el resto de sesiones"}
        </Button>
      )}
      <p role="status" className="mt-2 min-h-6 text-muted">{note}</p>
      {data && <p className="text-muted">La hora de última actividad es aproximada: se actualiza cada pocos minutos.</p>}
    </div>
  );
}

export function AccountSection() {
  const user = useUser();
  const { logout } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [sessionsKey, setSessionsKey] = useState(0); // al cambiar la contraseña se cierran las demás sesiones: se recarga la lista

  async function change(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const r = await sendJson("POST", "/api/auth/password", { current, next });
    setBusy(false);
    if (r.ok) {
      setCurrent(""); setNext(""); setSessionsKey((k) => k + 1);
      setMsg({ ok: true, text: "Contraseña cambiada. Se cerró la sesión en los demás dispositivos." });
    } else setMsg({ ok: false, text: describeAuthError(r) });
  }

  return (
    <section aria-labelledby="cuenta" className="max-w-2xl">
      <h2 id="cuenta" className="text-lg font-bold tracking-tight">Tu cuenta</h2>
      <p className="mt-2">
        Has entrado como <strong>{user.username}</strong>
        <span className="text-muted"> · {user.role === "admin" ? "Administrador" : "Usuario"}</span>
      </p>
      <Button variant="secondary" className="mt-3 w-full sm:w-auto" onClick={logout}>Cerrar sesión</Button>

      <Sessions key={sessionsKey} />

      <h3 className="mt-8 text-base font-bold tracking-tight">Cambiar la contraseña</h3>
      <form onSubmit={change} className="mt-3 space-y-5">
        <PasswordField label="Contraseña actual" value={current} onChange={setCurrent} autoComplete="current-password" />
        <PasswordField label="Contraseña nueva" value={next} onChange={setNext} autoComplete="new-password" hint={`Mínimo ${MIN_PASSWORD} caracteres.`} />
        <Button type="submit" disabled={busy} aria-busy={busy} className="w-full sm:w-auto">{busy ? "Cambiando…" : "Cambiar contraseña"}</Button>
      </form>
      <div role={msg?.ok === false ? "alert" : "status"} className="mt-3 min-h-7">
        {msg && <p className={`${msg.ok ? "msg-info" : "msg-error"}`}>{msg.text}</p>}
      </div>
    </section>
  );
}
