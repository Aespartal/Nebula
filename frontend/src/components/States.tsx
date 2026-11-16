import type { ReactNode } from "react";
import { Button } from "./Button";

export function Loading({ label = "Cargando…" }: { label?: string }) {
  return (
    <div role="status" className="py-16 text-center font-mono text-meta text-muted">
      <span className="motion-safe:animate-pulse">{label}</span>
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="my-8 rounded-ctl border border-danger bg-surface p-5">
      <p className="label text-danger!">Error</p>
      <p className="mt-1 font-bold">Algo no ha ido bien</p>
      <p className="mt-1 text-muted">{message}</p>
      {onRetry && <Button variant="secondary" className="mt-4" onClick={onRetry}>Reintentar</Button>}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="my-10 rounded-ctl border border-dashed border-line bg-surface p-6">
      <p className="text-lg font-bold">{title}</p>
      {children && <div className="mt-2 text-muted">{children}</div>}
    </div>
  );
}
