import type { ReactNode } from "react";
import Access from "../pages/Access";
import { useAuth } from "../lib/auth";
import { Button } from "./Button";
import { Loading } from "./States";

/** Decide qué se ve: error de conexión, alta inicial, acceso o la aplicación. La URL no cambia, así que tras entrar se vuelve a donde ibas. */
export function AuthGate({ children }: { children: ReactNode }) {
  const { state, retry } = useAuth();
  if (state.phase === "loading") return <div className="min-h-dvh pt-24"><Loading /></div>;
  if (state.phase === "error") {
    return (
      <div role="alert" className="mx-auto max-w-md px-5 pt-24">
        <p className="text-2xl font-bold tracking-tight">No se pudo conectar</p>
        <p className="mt-2 text-muted">El servidor de Nebula no responde. Comprueba que está encendido.</p>
        <Button className="mt-5" onClick={retry}>Reintentar</Button>
      </div>
    );
  }
  if (state.setupRequired) return <Access mode="setup" />;
  if (!state.user) return <Access mode="login" />;
  return <>{children}</>;
}
