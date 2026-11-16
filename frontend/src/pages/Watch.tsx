import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { MediaFileInfo } from "@nebula/shared";
import { Button, LinkButton } from "../components/Button";
import { Icon } from "../components/Icon";
import { Wordmark } from "../components/Layout";
import { ErrorBox, Loading } from "../components/States";
import { formatDuration, formatSize } from "../lib/format";
import { useFocusWhen } from "../lib/useFocusWhen";
import { usePageTitle } from "../lib/usePageTitle";
import { useApi } from "../lib/useApi";

export default function Watch() {
  const { id } = useParams();
  // key: al pasar al siguiente episodio se reinicia todo el estado del reproductor.
  return <WatchView key={id} id={id!} />;
}

function describeVideo(info: MediaFileInfo) {
  const v = info.streams.find((s) => s.kind === "video");
  return `contenedor ${info.container?.split(",")[0] ?? "desconocido"}, vídeo ${v?.codec ?? "desconocido"}`;
}

function playbackMessage(code: number | undefined, info: MediaFileInfo): string | null {
  switch (code) {
    case 1: return null; // abortado por el propio usuario
    case 2: return "Se perdió la conexión con el servidor mientras se reproducía.";
    case 3:
    case 4:
      return `Este navegador no puede reproducir el archivo tal cual (${describeVideo(info)}). ` +
        "La conversión automática llegará en una próxima versión de Nebula. Mientras tanto, prueba con otro navegador.";
    default: return "No se pudo reproducir el vídeo.";
  }
}

function WatchView({ id }: { id: string }) {
  const { data: info, error, loading, reload } = useApi<MediaFileInfo>(`/api/files/${id}`);
  usePageTitle(info?.title);
  const [playError, setPlayError] = useState<string | null>(null);
  const nextRef = useRef<HTMLAnchorElement>(null);
  const h1 = useRef<HTMLHeadingElement>(null);
  useFocusWhen(h1, !!info);

  const backTo = info?.seriesId ? `/series/${info.seriesId}` : "/peliculas";
  const backLabel = info?.seriesId ? "Volver a la serie" : "Volver a películas";

  return (
    <div className="mx-auto min-h-dvh max-w-5xl px-4 pb-12">
      <header className="flex items-center justify-between py-3">
        <Link to={backTo} className="inline-flex min-h-12 items-center gap-1 pr-3 font-bold">
          <Icon name="back" className="size-6" /> {backLabel}
        </Link>
        <Wordmark />
      </header>

      <main id="contenido">
        {loading && <Loading />}
        {error && <ErrorBox message={error} onRetry={reload} />}
        {info && (
          <>
            <video
              key={playError ? "retry" : "ok"}
              controls autoPlay playsInline preload="metadata"
              src={`/api/stream/${info.id}`}
              className="aspect-video w-full bg-black"
              onError={(e) => setPlayError(playbackMessage(e.currentTarget.error?.code, info))}
              onEnded={() => nextRef.current?.focus()}
            >
              Tu navegador no admite vídeo HTML5.
            </video>

            {playError && (
              <div role="alert" className="mt-4 border-2 border-accent p-4">
                <p>{playError}</p>
                <Button variant="secondary" className="mt-3" onClick={() => setPlayError(null)}>Intentarlo de nuevo</Button>
              </div>
            )}

            <div className="mt-5">
              {info.subtitle && <p className="font-bold text-muted">{info.subtitle}</p>}
              <h1 ref={h1} tabIndex={-1} className="font-display text-3xl font-semibold leading-tight outline-none md:text-4xl">{info.title}</h1>
            </div>

            {info.next && (
              <LinkButton ref={nextRef} to={`/ver/${info.next.fileId}`} className="mt-5 w-full sm:w-auto">
                <Icon name="play" className="size-5" /> Siguiente: {info.next.label}
              </LinkButton>
            )}

            <details className="mt-8 border-t border-rule pt-3">
              <summary className="min-h-12 py-2 font-bold">Detalles técnicos</summary>
              <TechDetails info={info} />
            </details>
          </>
        )}
      </main>
    </div>
  );
}

function TechDetails({ info }: { info: MediaFileInfo }) {
  const video = info.streams.filter((s) => s.kind === "video");
  const audio = info.streams.filter((s) => s.kind === "audio");
  const subs = info.streams.filter((s) => s.kind === "subtitle");
  const row = (k: string, v: string) => (
    <div className="grid grid-cols-[8rem_1fr] gap-2 border-t border-rule py-2 first:border-t-0">
      <dt className="text-muted">{k}</dt>
      <dd>{v}</dd>
    </div>
  );
  return (
    <dl className="mt-2 max-w-2xl">
      {row("Archivo", info.relPath)}
      {row("Duración", formatDuration(info.durationS))}
      {row("Tamaño", formatSize(info.sizeBytes))}
      {row("Contenedor", info.container ?? "—")}
      {video.map((v, i) => row(i === 0 ? "Vídeo" : "", `${v.codec ?? "?"}${v.width ? ` · ${v.width}×${v.height}` : ""}${v.pixFmt ? ` · ${v.pixFmt}` : ""}`))}
      {audio.map((a, i) => row(i === 0 ? "Audio" : "", `${a.codec ?? "?"}${a.channels ? ` · ${a.channels} canales` : ""}${a.language ? ` · ${a.language}` : ""}`))}
      {subs.length > 0 && row("Subtítulos", subs.map((s) => `${s.language ?? "sin idioma"}${s.isExternal ? " (archivo)" : ""}`).join(", "))}
    </dl>
  );
}
