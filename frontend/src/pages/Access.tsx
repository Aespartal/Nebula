import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button } from "../components/Button";
import { useAuth } from "../lib/auth";
import { usePageTitle } from "../lib/usePageTitle";
import type { ApiResult } from "../lib/useApi";

export const MIN_PASSWORD = 8;

export function describeAuthError(r: Extract<ApiResult<unknown>, { ok: false }>): string {
  switch (r.code) {
    case "invalid_credentials": return "El usuario o la contraseña no son correctos.";
    case "too_many_attempts": {
      const min = Math.max(1, Math.ceil((r.retryAfter ?? 60) / 60));
      return `Demasiados intentos fallidos. Espera ${min === 1 ? "1 minuto" : `${min} minutos`} y vuelve a probar.`;
    }
    case "weak_password": return `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`;
    case "invalid_username": return "El usuario debe tener entre 3 y 32 caracteres: letras, números, punto, guion o guion bajo, sin espacios.";
    case "username_taken": return "Ya existe un usuario con ese nombre.";
    case "already_set_up": return "Nebula ya tiene un administrador. Recarga la página e inicia sesión.";
    case "bad_origin": return "La petición se rechazó por seguridad. Abre Nebula desde su propia dirección.";
    case "network": return "No se pudo conectar con el servidor de Nebula.";
    default: return "No se pudo completar la acción. Inténtalo de nuevo.";
  }
}

/** Campo de contraseña con botón para verla: ayuda a quien teclea en el móvil. */
export function PasswordField({ label, value, onChange, autoComplete, hint, id: given }: {
  label: string; value: string; onChange: (v: string) => void; autoComplete: "current-password" | "new-password"; hint?: string; id?: string;
}) {
  const auto = useId();
  const id = given ?? auto;
  const [show, setShow] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="mb-1 block font-bold">{label}</label>
      <div className="flex gap-2">
        <input id={id} type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)}
          required autoComplete={autoComplete} spellCheck={false} autoCapitalize="none" aria-describedby={hint ? `${id}-hint` : undefined}
          className="min-h-12 w-full min-w-0 rounded-md border-2 border-line bg-surface px-3 py-2 text-text" />
        <button type="button" aria-pressed={show} onClick={() => setShow(!show)}
          className="min-h-12 shrink-0 rounded-md border-2 border-line px-3 font-bold hover:bg-surface">
          {show ? "Ocultar" : "Mostrar"}
        </button>
      </div>
      {hint && <p id={`${id}-hint`} className="mt-1 text-muted">{hint}</p>}
    </div>
  );
}

const field = "min-h-12 w-full rounded-md border-2 border-line bg-surface px-3 py-2 text-text";

/** Pantalla única para el primer arranque (crear administrador) y para iniciar sesión. */
export default function Access({ mode }: { mode: "setup" | "login" }) {
  const setup = mode === "setup";
  usePageTitle(setup ? "Crear la cuenta de administrador" : "Iniciar sesión");
  const { login, setup: doSetup } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const h1 = useRef<HTMLHeadingElement>(null);
  const userId = useId();
  const againId = useId();

  useEffect(() => { h1.current?.focus({ preventScroll: true }); }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (setup && password !== again) { setError("Las dos contraseñas no coinciden."); return; }
    setBusy(true); setError(null);
    const r = await (setup ? doSetup : login)(username.trim(), password);
    if (!r.ok) { setBusy(false); setError(describeAuthError(r)); setPassword(""); setAgain(""); }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      <p className="font-display text-5xl font-semibold tracking-tight" aria-hidden="true">Nebula<span className="text-accent">.</span></p>
      <main id="contenido" className="mt-8">
        <h1 ref={h1} tabIndex={-1} className="font-display text-3xl font-semibold leading-tight outline-none">
          {setup ? "Crea tu cuenta de administrador" : "Iniciar sesión"}
        </h1>
        {setup && (
          <p className="mt-3 text-muted">
            Es la primera vez que se abre Nebula. Esta cuenta podrá añadir carpetas y crear cuentas para el resto de personas de casa.
          </p>
        )}

        <form onSubmit={submit} className="mt-6 space-y-5">
          <div>
            <label htmlFor={userId} className="mb-1 block font-bold">Usuario</label>
            <input id={userId} className={field} value={username} onChange={(e) => setUsername(e.target.value)} required
              autoComplete="username" autoCapitalize="none" spellCheck={false} />
          </div>
          <PasswordField label="Contraseña" value={password} onChange={setPassword}
            autoComplete={setup ? "new-password" : "current-password"}
            hint={setup ? `Mínimo ${MIN_PASSWORD} caracteres. Una frase larga es más fácil de recordar y más segura.` : undefined} />
          {setup && <PasswordField label="Repite la contraseña" value={again} onChange={setAgain} autoComplete="new-password" id={againId} />}

          <div role="alert" className="empty:hidden">
            {error && <p className="border-l-4 border-accent py-1 pl-4 font-bold text-accent">{error}</p>}
          </div>

          <Button type="submit" disabled={busy} aria-busy={busy} className="w-full">
            {busy ? "Entrando…" : setup ? "Crear cuenta y entrar" : "Entrar"}
          </Button>
        </form>
      </main>
    </div>
  );
}
