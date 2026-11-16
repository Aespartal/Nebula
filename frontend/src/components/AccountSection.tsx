import { useState, type FormEvent } from "react";
import { PasswordField, describeAuthError, MIN_PASSWORD } from "../pages/Access";
import { useAuth, useUser } from "../lib/auth";
import { sendJson } from "../lib/useApi";
import { Button } from "./Button";

export function AccountSection() {
  const user = useUser();
  const { logout } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function change(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const r = await sendJson("POST", "/api/auth/password", { current, next });
    setBusy(false);
    if (r.ok) {
      setCurrent(""); setNext("");
      setMsg({ ok: true, text: "Contraseña cambiada. Se cerró la sesión en los demás dispositivos." });
    } else setMsg({ ok: false, text: describeAuthError(r) });
  }

  return (
    <section aria-labelledby="cuenta" className="max-w-2xl">
      <h2 id="cuenta" className="font-display text-2xl font-semibold">Tu cuenta</h2>
      <p className="mt-2">
        Has entrado como <strong>{user.username}</strong>
        <span className="text-muted"> · {user.role === "admin" ? "Administrador" : "Usuario"}</span>
      </p>
      <Button variant="secondary" className="mt-3 w-full sm:w-auto" onClick={logout}>Cerrar sesión</Button>

      <h3 className="mt-8 font-display text-xl font-semibold">Cambiar la contraseña</h3>
      <form onSubmit={change} className="mt-3 space-y-5">
        <PasswordField label="Contraseña actual" value={current} onChange={setCurrent} autoComplete="current-password" />
        <PasswordField label="Contraseña nueva" value={next} onChange={setNext} autoComplete="new-password" hint={`Mínimo ${MIN_PASSWORD} caracteres.`} />
        <Button type="submit" disabled={busy} aria-busy={busy} className="w-full sm:w-auto">{busy ? "Cambiando…" : "Cambiar contraseña"}</Button>
      </form>
      <div role={msg?.ok === false ? "alert" : "status"} className="mt-3 min-h-7">
        {msg && <p className={`border-l-4 py-1 pl-4 font-bold ${msg.ok ? "border-line" : "border-accent text-accent"}`}>{msg.text}</p>}
      </div>
    </section>
  );
}
