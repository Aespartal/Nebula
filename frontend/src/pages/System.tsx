import { useEffect, useState } from "react";
import type { ConversionsInfo, ConversionSession, StorageLibrary } from "@nebula/shared";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { PageHeading } from "../components/PageHeading";
import { Empty, ErrorBox, Loading } from "../components/States";
import { useUser } from "../lib/auth";
import { formatBytes, formatClock } from "../lib/format";
import { sendJson, useApi } from "../lib/useApi";
import { usePageTitle } from "../lib/usePageTitle";

const PROFILE: Record<string, string> = {
  "nvenc-gpu": "GPU NVIDIA (decodifica y codifica)",
  "nvenc-cpu-decode": "GPU NVIDIA (decodifica la CPU)",
  x264: "CPU (x264)",
};

function Bar({ value, label }: { value: number; label: string }) {
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}
      className="h-1.5 w-full overflow-hidden rounded-bar bg-track">
      <div className="h-full bg-accent" style={{ width: `${Math.min(100, Math.round(value * 100))}%` }} />
    </div>
  );
}

function Conversions() {
  const { data, error, loading, reload } = useApi<ConversionsInfo>("/api/system/conversions");
  const [note, setNote] = useState("");

  // Se actualiza solo mientras la página está abierta.
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) reload(); }, 3000);
    return () => clearInterval(t);
  }, [reload]);

  async function stop(s: ConversionSession) {
    const r = await sendJson("POST", `/api/system/conversions/${s.id}/stop`, {});
    setNote(r.ok ? `Conversión de «${s.title}» detenida.` : "No se pudo detener.");
    reload();
  }

  return (
    <section aria-labelledby="conv" className="mb-12">
      <div className="mb-4 flex flex-col gap-2 border-b border-rule pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="label">FFmpeg {data?.ffmpeg ?? ""}</div>
          <h2 id="conv" className="text-lg font-bold tracking-tight">Conversión de vídeo</h2>
        </div>
        {data && (
          <div className="rounded-ctl border border-rule bg-surface px-3 py-1.5 font-mono text-meta text-soft tabular">
            {data.nvenc ? "NVENC activo" : "Solo CPU"} · Sesiones {data.sessions.length}/{data.maxSessions}
          </div>
        )}
      </div>
      {loading && !data && <Loading />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      <p role="status" className="sr-only">{note}</p>
      {data && data.sessions.length === 0 && (
        <Empty title="No hay conversiones en curso">
          Lo que tu navegador reproduce directamente no pasa por FFmpeg, así que aquí solo aparece lo que hay que convertir.
        </Empty>
      )}
      {data && data.sessions.length > 0 && (
        <ul className="divide-y divide-rule rounded-ctl border border-rule bg-surface">
          {data.sessions.map((s) => (
            <li key={s.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_14rem_auto] sm:items-center">
              <div className="min-w-0">
                <p className="truncate font-bold">{s.title}</p>
                <p className="mt-0.5 font-mono text-label text-faint">
                  {s.profile ? PROFILE[s.profile] ?? s.profile : "Sin proceso activo"} · hasta {s.maxHeight}p
                </p>
                <p className="mt-1 font-mono text-label">
                  {s.failed ? <span className="text-danger">Error</span>
                    : s.running ? <span className="inline-flex items-center gap-1.5 text-warn"><span aria-hidden="true" className="size-1.5 rounded-full bg-warn" />Convirtiendo</span>
                    : <span className="text-muted">En espera</span>}
                </p>
              </div>
              <div className="space-y-1.5 font-mono text-label text-muted tabular">
                <Bar value={s.durationS ? s.positionS / s.durationS : 0} label={`Posición en ${s.title}`} />
                <div className="flex justify-between">
                  <span>{formatClock(s.positionS)} / {formatClock(s.durationS)}</span>
                  <span>{s.idleS < 5 ? "viendo ahora" : `parado hace ${formatClock(s.idleS)}`}</span>
                </div>
              </div>
              <Button variant="secondary" onClick={() => stop(s)} aria-label={`Detener la conversión de ${s.title}`}>Detener</Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Storage() {
  const { data, error, loading, reload } = useApi<StorageLibrary[]>("/api/system/storage");
  return (
    <section aria-labelledby="alm">
      <div className="mb-4 border-b border-rule pb-4">
        <div className="label">Carpetas de las bibliotecas</div>
        <h2 id="alm" className="text-lg font-bold tracking-tight">Almacenamiento</h2>
      </div>
      {loading && !data && <Loading />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && data.length === 0 && <Empty title="Todavía no hay carpetas">Añádelas en Ajustes.</Empty>}
      <ul className="grid gap-4">
        {data?.map((l) => {
          const used = l.disk ? l.disk.totalBytes - l.disk.freeBytes : 0;
          return (
            <li key={l.id} className="panel space-y-3">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-bold">{l.name} <span className="font-mono text-label font-normal text-faint">{l.type === "movies" ? "PELÍCULAS" : "SERIES"}</span></p>
                  <p className="break-all font-mono text-label text-muted">{l.rootPath}</p>
                </div>
                {l.disk && (
                  <p className="font-mono text-meta text-soft tabular">
                    {formatBytes(used)} / {formatBytes(l.disk.totalBytes)} ({Math.round((used / l.disk.totalBytes) * 100)} %)
                  </p>
                )}
              </div>
              {l.disk ? <Bar value={used / l.disk.totalBytes} label={`Disco de ${l.name} ocupado`} />
                : <p className="msg-error">No se puede leer esta carpeta. ¿Está el disco conectado?</p>}
              <p className="flex flex-col justify-between gap-1 font-mono text-label text-faint tabular sm:flex-row">
                <span>{l.files} {l.files === 1 ? "archivo" : "archivos"} · {formatBytes(l.sizeBytes)} de vídeo</span>
                {l.disk && <span>{formatBytes(l.disk.freeBytes)} libres</span>}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default function System() {
  usePageTitle("Sistema");
  const user = useUser();
  if (user.role !== "admin") {
    return (
      <>
        <PageHeading title="Sistema" />
        <p className="max-w-prose text-muted">Esta página es solo para administradores.</p>
      </>
    );
  }
  return (
    <>
      <PageHeading title="Sistema" eyebrow="Este equipo" />
      <Conversions />
      <Storage />
    </>
  );
}
