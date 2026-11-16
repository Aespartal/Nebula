import type { ReactNode } from "react";
import { Button } from "./Button";

export function Loading({ label = "Cargando…" }: { label?: string }) {
  return (
    <div role="status" className="py-16 text-center text-muted">
      <span className="font-display text-2xl motion-safe:animate-pulse">{label}</span>
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="my-8 border-2 border-accent p-5">
      <p className="font-bold">Algo no ha ido bien</p>
      <p className="mt-1">{message}</p>
      {onRetry && <Button variant="secondary" className="mt-4" onClick={onRetry}>Reintentar</Button>}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="my-10 border-2 border-dashed border-line p-6">
      <p className="font-display text-2xl font-semibold">{title}</p>
      {children && <div className="mt-2 text-muted">{children}</div>}
    </div>
  );
}
