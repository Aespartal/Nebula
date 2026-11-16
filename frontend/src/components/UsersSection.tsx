import { useId, useState, type FormEvent } from "react";
import type { Role, User } from "@nebula/shared";
import { PasswordField, describeAuthError, MIN_PASSWORD } from "../pages/Access";
import { useUser } from "../lib/auth";
import { sendJson, useApi } from "../lib/useApi";
import { Button } from "./Button";
import { ErrorBox, Loading } from "./States";

const field = "min-h-12 w-full rounded-md border-2 border-line bg-surface px-3 py-2 text-text";

export function UsersSection() {
  const me = useUser();
  const users = useApi<User[]>("/api/users");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("user");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ id: number; kind: "password" | "delete" } | null>(null);
  const [newPass, setNewPass] = useState("");
  const ids = { user: useId(), role: useId() };

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const r = await sendJson<User>("POST", "/api/users", { username: username.trim(), password, role });
    setBusy(false);
    if (r.ok) {
      setMsg({ ok: true, text: `Cuenta «${r.data.username}» creada. Dale la contraseña en persona; podrá cambiarla desde Ajustes.` });
      setUsername(""); setPassword(""); setRole("user"); users.reload();
    } else setMsg({ ok: false, text: describeAuthError(r) });
  }

  async function resetPassword(u: User) {
    setBusy(true); setMsg(null);
    const r = await sendJson("POST", `/api/users/${u.id}/password`, { password: newPass });
    setBusy(false);
    if (r.ok) { setMsg({ ok: true, text: `Contraseña de «${u.username}» cambiada. Su sesión se cerró en todos los dispositivos.` }); setEditing(null); setNewPass(""); }
    else setMsg({ ok: false, text: describeAuthError(r) });
  }

  async function remove(u: User) {
    setBusy(true); setMsg(null);
    const r = await sendJson("DELETE", `/api/users/${u.id}`);
    setBusy(false);
    if (r.ok) { setMsg({ ok: true, text: `Cuenta «${u.username}» eliminada, con su progreso de reproducción.` }); setEditing(null); users.reload(); }
    else setMsg({ ok: false, text: r.code === "cannot_delete_self" ? "No puedes eliminar tu propia cuenta." : describeAuthError(r) });
  }

  return (
    <section aria-labelledby="usuarios" className="mt-12 max-w-2xl">
      <h2 id="usuarios" className="font-display text-2xl font-semibold">Cuentas</h2>
      {users.loading && <Loading />}
      {users.error && <ErrorBox message={users.error} onRetry={users.reload} />}
      {users.data && (
        <ul className="mt-3">
          {users.data.map((u) => (
            <li key={u.id} className="border-t border-rule py-3 last:border-b">
              <p className="font-bold">
                {u.username}
                <span className="font-normal text-muted"> · {u.role === "admin" ? "Administrador" : "Usuario"}{u.id === me.id ? " · tú" : ""}</span>
              </p>
              {u.id !== me.id && editing?.id !== u.id && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => { setEditing({ id: u.id, kind: "password" }); setNewPass(""); setMsg(null); }}>
                    Cambiar contraseña<span className="sr-only"> de {u.username}</span>
                  </Button>
                  <Button variant="secondary" onClick={() => { setEditing({ id: u.id, kind: "delete" }); setMsg(null); }}>
                    Eliminar<span className="sr-only"> la cuenta de {u.username}</span>
                  </Button>
                </div>
              )}
              {editing?.id === u.id && editing.kind === "password" && (
                <form className="mt-3 space-y-4" onSubmit={(e) => { e.preventDefault(); void resetPassword(u); }}>
                  <PasswordField label={`Contraseña nueva para ${u.username}`} value={newPass} onChange={setNewPass}
                    autoComplete="new-password" hint={`Mínimo ${MIN_PASSWORD} caracteres.`} />
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" disabled={busy}>Guardar contraseña</Button>
                    <Button variant="secondary" onClick={() => setEditing(null)}>Cancelar</Button>
                  </div>
                </form>
              )}
              {editing?.id === u.id && editing.kind === "delete" && (
                <div className="mt-3 border-l-4 border-accent pl-4">
                  <p className="font-bold">¿Eliminar la cuenta de {u.username}?</p>
                  <p className="text-muted">Se borra también su progreso de reproducción. No se puede deshacer.</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button onClick={() => remove(u)} disabled={busy}>Sí, eliminar</Button>
                    <Button variant="secondary" onClick={() => setEditing(null)}>Cancelar</Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <h3 className="mt-8 font-display text-xl font-semibold">Crear una cuenta</h3>
      <form onSubmit={create} className="mt-3 space-y-5">
        <div>
          <label htmlFor={ids.user} className="mb-1 block font-bold">Usuario</label>
          <input id={ids.user} className={field} value={username} onChange={(e) => setUsername(e.target.value)} required
            autoComplete="off" autoCapitalize="none" spellCheck={false} />
        </div>
        <PasswordField label="Contraseña inicial" value={password} onChange={setPassword} autoComplete="new-password" hint={`Mínimo ${MIN_PASSWORD} caracteres.`} />
        <div>
          <label htmlFor={ids.role} className="mb-1 block font-bold">Tipo de cuenta</label>
          <select id={ids.role} className={field} value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="user">Usuario: ve y reproduce</option>
            <option value="admin">Administrador: además gestiona carpetas y cuentas</option>
          </select>
        </div>
        <Button type="submit" disabled={busy} aria-busy={busy} className="w-full sm:w-auto">{busy ? "Creando…" : "Crear cuenta"}</Button>
      </form>

      <div role={msg?.ok === false ? "alert" : "status"} className="mt-4 min-h-7">
        {msg && <p className={`border-l-4 py-1 pl-4 font-bold ${msg.ok ? "border-line" : "border-accent text-accent"}`}>{msg.text}</p>}
      </div>
    </section>
  );
}
