import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { MediaFileInfo, MediaStreamInfo, PlaybackDecision, SubtitleUploadResult, SystemInfo } from "@nebula/shared";
import { Button, LinkButton } from "../components/Button";
import { Icon } from "../components/Icon";
import { Wordmark } from "../components/Layout";
import { ErrorBox, Loading } from "../components/States";
import { CastPanel } from "../components/CastPanel";
import { NextUp } from "../components/NextUp";
import { FixMetadata } from "../components/FixMetadata";
import { SubtitleUpload } from "../components/SubtitleUpload";
import { VideoPlayer, describeReason } from "../components/VideoPlayer";
import { shouldAutoplay } from "../lib/autoplay";
import { useUser } from "../lib/auth";
import { formatClock, formatDuration, formatSize, plural } from "../lib/format";
import { languageName, normalizeLang } from "../lib/lang";
import { audioPref, autoplayNextPref, subtitleOffsetPref, subtitlePref } from "../lib/prefs";
import { OFFSET_STEP_S, clampOffset, formatOffset } from "../lib/subtitleOffset";
import { pickAudio, pickSubtitle, subtitleLabel, textSubtitles } from "../lib/tracks";
import { useFocusWhen } from "../lib/useFocusWhen";
import { useMediaSession } from "../lib/useMediaSession";
import { usePageTitle } from "../lib/usePageTitle";
import { sendJson, useApi } from "../lib/useApi";

export default function Watch() {
  const { id } = useParams();
  // key: al pasar al siguiente episodio se reinicia todo el estado del reproductor.
  return <WatchView key={id} id={id!} />;
}

function WatchView({ id }: { id: string }) {
  const { data: info, error, loading, reload } = useApi<MediaFileInfo>(`/api/files/${id}`);
  usePageTitle(info?.title);
  const backTo = info?.seriesId ? `/series/${info.seriesId}` : "/peliculas";
  const backLabel = info?.seriesId ? "Volver a la serie" : "Volver a películas";

  return (
    <div className="mx-auto min-h-dvh max-w-5xl px-4 pb-12">
      <header className="flex items-center justify-between py-3">
        <Link to={backTo} className="inline-flex min-h-[var(--control-h)] items-center gap-1 pr-3 font-bold">
          <Icon name="back" className="size-6" /> {backLabel}
        </Link>
        <Wordmark />
      </header>

      <main id="contenido">
        {loading && <Loading />}
        {error && <ErrorBox message={error} onRetry={reload} />}
        {info && <WatchContent info={info} onReload={reload} />}
      </main>
    </div>
  );
}

function WatchContent({ info, onReload }: { info: MediaFileInfo; onReload: () => void }) {
  const id = String(info.id);
  const isAdmin = useUser().role === "admin";
  const [decision, setDecision] = useState<PlaybackDecision | null>(null);
  const [forceTranscode, setForceTranscode] = useState(false);
  const [fellBack, setFellBack] = useState<"direct" | "remux" | null>(null);
  // Idioma de audio y subtítulos: se parte de lo que se eligió la última vez en este navegador.
  const [audioIdx, setAudioIdx] = useState<number | undefined>(() => pickAudio(info.streams, audioPref.get()));
  const tracks = useMemo(() => textSubtitles(info.streams), [info.streams]);
  const [subtitleIdx, setSubtitleIdx] = useState<number | null>(() => pickSubtitle(tracks, subtitlePref.get()));
  const [subState, setSubState] = useState<"loading" | "ready" | "error" | null>(null);
  // Desfase por pista (se lee de lo guardado la primera vez que se muestra esa pista).
  const [offsets, setOffsets] = useState<Record<number, number>>({});
  const subtitleOffset = subtitleIdx === null ? 0 : (offsets[subtitleIdx] ?? subtitleOffsetPref.get(info.id, subtitleIdx));
  function changeOffset(seconds: number) {
    if (subtitleIdx === null) return;
    const v = clampOffset(seconds);
    subtitleOffsetPref.set(info.id, subtitleIdx, v);
    setOffsets((o) => ({ ...o, [subtitleIdx]: v }));
  }
  const nextRef = useRef<HTMLAnchorElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  // Siguiente episodio: al acabar aparece el aviso (con cuenta atrás si procede). Volver a dar al play lo descarta.
  const [upNext, setUpNext] = useState<{ auto: boolean } | null>(null);
  const [autoplay, setAutoplay] = useState(() => autoplayNextPref.get());
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const dismiss = () => setUpNext(null);
    v.addEventListener("play", dismiss);
    return () => v.removeEventListener("play", dismiss);
  }, []);
  // Un subtítulo recién subido se activa en cuanto llega con los datos recargados del archivo.
  const [pendingSub, setPendingSub] = useState<number | null>(null);
  useEffect(() => {
    if (pendingSub !== null && tracks.some((t) => t.idx === pendingSub)) { chooseSubtitle(pendingSub); setPendingSub(null); }
  }, [tracks, pendingSub]);
  const [startedOver, setStartedOver] = useState(false);
  const [watched, setWatched] = useState<boolean | null>(null);
  const h1 = useRef<HTMLHeadingElement>(null);
  const system = useApi<SystemInfo>("/api/system");
  useFocusWhen(h1, true);

  // Teclas multimedia, auriculares y pantalla de bloqueo. Al cambiar de episodio la página se vuelve a montar.
  const navigate = useNavigate();
  useMediaSession(videoRef, { title: info.title, subtitle: info.subtitle, poster: info.poster }, {
    onNext: info.next ? () => navigate(`/ver/${info.next!.fileId}`) : undefined,
    onPrevious: info.previous ? () => navigate(`/ver/${info.previous!.fileId}`) : undefined,
  });

  // Se retoma solo si había avanzado algo y aún no estaba casi al final.
  const resumeAt = info.resume.positionS >= 10 &&
    (!info.resume.durationS || info.resume.positionS / info.resume.durationS < 0.9) ? info.resume.positionS : 0;
  const isWatched = watched ?? info.resume.watched;

  async function toggleWatched() {
    const r = await sendJson<{ watched: boolean }>("POST", `/api/progress/${id}/watched`, { watched: !isWatched });
    if (r.ok) setWatched(r.data.watched);
  }

  function chooseAudio(idx: number | undefined) {
    setAudioIdx(idx);
    const s = info.streams.find((x) => x.kind === "audio" && x.idx === (idx ?? -1)) ??
      info.streams.filter((x) => x.kind === "audio").find((x) => x.isDefault);
    const lang = normalizeLang(s?.language);
    if (lang) audioPref.set(lang);
  }

  function chooseSubtitle(idx: number | null) {
    setSubtitleIdx(idx);
    setSubState(idx === null ? null : "loading");
    subtitlePref.set(idx === null ? "" : (tracks.find((t) => t.idx === idx)?.lang ?? ""));
  }

  return (
    <>
      <VideoPlayer
        fileId={info.id} audioIdx={audioIdx}
        forceTranscode={forceTranscode} setForceTranscode={setForceTranscode}
        onDecision={setDecision}
        onDirectFailed={setFellBack}
        onEnded={() => {
          if (!info.next) return;
          setUpNext({ auto: shouldAutoplay({ enabled: autoplayNextPref.get(), hasNext: true, fullscreen: !!document.fullscreenElement }) });
        }}
        startAt={resumeAt} videoRef={videoRef}
        subtitles={tracks} subtitleIdx={subtitleIdx}
        onSubtitleState={setSubState} onSubtitleChange={chooseSubtitle} subtitleOffset={subtitleOffset}
      />
      {upNext && info.next && (
        <NextUp label={info.next.label} auto={upNext.auto} onGo={() => navigate(`/ver/${info.next!.fileId}`)}
          onCancel={() => { setUpNext(null); nextRef.current?.focus(); }} />
      )}
      {system.data?.castAvailable && <CastPanel fileId={info.id} title={info.title} audioIdx={audioIdx} videoRef={videoRef} />}

      <div className="mt-5">
        {info.subtitle && <p className="font-bold text-muted">{info.subtitle}</p>}
        <h1 ref={h1} tabIndex={-1} className="text-2xl font-bold leading-tight tracking-tight outline-none md:text-3xl">{info.title}</h1>
        {info.overview && <p className="mt-3 max-w-prose text-muted">{info.overview}</p>}
      </div>

      {resumeAt > 0 && !startedOver && (
        <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-muted">
          Retomando en {formatClock(resumeAt)}.
          <button type="button" className="min-h-[var(--control-h)] font-bold text-text underline underline-offset-4"
            onClick={() => { if (videoRef.current) videoRef.current.currentTime = 0; setStartedOver(true); }}>
            Empezar desde el principio
          </button>
        </p>
      )}

      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <Button variant="secondary" aria-pressed={isWatched} onClick={toggleWatched}>
          <Icon name="check" className="size-5" /> {isWatched ? "Vista · quitar marca" : "Marcar como vista"}
        </Button>
        <a href={`/api/files/${info.id}/download`} download
          className="inline-flex min-h-[var(--control-h)] items-center justify-center gap-2 rounded-ctl border border-line bg-surface px-4 text-meta font-bold text-text transition-colors hover:border-muted hover:bg-raised">
          <Icon name="download" className="size-5" /> Descargar archivo <span className="font-normal text-muted">({formatSize(info.sizeBytes)})</span>
        </a>
        {info.next && (
          <LinkButton ref={nextRef} to={`/ver/${info.next.fileId}`} className="w-full sm:w-auto">
            <Icon name="play" className="size-5" /> Siguiente: {info.next.label}
          </LinkButton>
        )}
      </div>

      {info.next && (
        <label className="mt-3 flex min-h-[var(--control-h)] max-w-2xl items-center gap-3 text-meta">
          <input type="checkbox" checked={autoplay} className="size-5 accent-[var(--color-accent)]"
            onChange={(e) => { setAutoplay(e.target.checked); autoplayNextPref.set(e.target.checked); }} />
          Pasar solo al siguiente episodio al terminar
        </label>
      )}

      <div className="mt-6 grid max-w-2xl gap-5 sm:grid-cols-2">
        <AudioPicker streams={info.streams} value={audioIdx} onChange={chooseAudio} />
        <SubtitlePicker streams={info.streams} value={subtitleIdx} onChange={chooseSubtitle} state={subState}
          offset={subtitleOffset} onOffset={changeOffset} />
      </div>

      {isAdmin && (
        <SubtitleUpload fileId={info.id} onUploaded={(r: SubtitleUploadResult) => { setPendingSub(r.idx); onReload(); }} />
      )}
      {isAdmin && info.movieId !== null && (
        <FixMetadata kind="movie" id={info.movieId} title={info.title} year={info.subtitle && /^\d{4}$/.test(info.subtitle) ? Number(info.subtitle) : null}
          locked={info.metaLocked} onChanged={onReload} />
      )}

      <details className="mt-8 border-t border-rule pt-3">
        <summary className="min-h-[var(--control-h)] py-2 font-bold">Detalles técnicos</summary>
        <PlaybackStatus decision={decision} forced={forceTranscode} fellBack={fellBack}
          setForced={(v) => { setFellBack(null); setForceTranscode(v); }} />
        <TechDetails info={info} />
      </details>
    </>
  );
}

function AudioPicker({ streams, value, onChange }: { streams: MediaStreamInfo[]; value?: number; onChange: (v: number | undefined) => void }) {
  const audio = streams.filter((s) => s.kind === "audio");
  const id = useId();
  if (audio.length < 2) return null;
  const current = value ?? (audio.find((s) => s.isDefault) ?? audio[0]).idx;
  const label = (s: MediaStreamInfo) =>
    [languageName(s.language), s.codec?.toUpperCase(), s.channels ? plural(s.channels, "canal", "canales") : null].filter(Boolean).join(" · ");
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-meta font-bold text-soft">Audio</label>
      <select id={id} value={current} onChange={(e) => onChange(Number(e.target.value))}
        className={selectCls}>
        {audio.map((s) => <option key={s.idx} value={s.idx}>{label(s)}</option>)}
      </select>
    </div>
  );
}

const selectCls = "field";

function SubtitlePicker({ streams, value, onChange, state, offset, onOffset }: {
  streams: MediaStreamInfo[]; value: number | null; onChange: (v: number | null) => void; state: "loading" | "ready" | "error" | null;
  offset: number; onOffset: (seconds: number) => void;
}) {
  const id = useId();
  const subs = streams.filter((s) => s.kind === "subtitle");
  if (subs.length === 0) return null;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-meta font-bold text-soft">Subtítulos</label>
      <select id={id} value={value === null ? "" : String(value)} className={selectCls}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}>
        <option value="">Sin subtítulos</option>
        {subs.map((s) => <option key={s.idx} value={s.idx} disabled={!s.textual}>{subtitleLabel(s)}</option>)}
      </select>
      <p role="status" className="mt-1 min-h-6 text-muted">
        {value !== null && state === "loading" && "Cargando subtítulos… En un archivo grande puede tardar un poco la primera vez."}
        {value !== null && state === "error" && "No se pudieron cargar estos subtítulos."}
      </p>
      {value !== null && state !== "error" && (
        <div role="group" aria-labelledby={`${id}-sync`}>
          <span id={`${id}-sync`} className="label mb-1.5 block">Sincronía</span>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" className="px-3 font-mono" onClick={() => onOffset(offset - OFFSET_STEP_S)}
              aria-label="Adelantar los subtítulos 0,5 segundos (salen antes)">−0,5 s</Button>
            <output aria-live="polite" aria-label={offset === 0 ? "Subtítulos sin ajuste" : `Subtítulos ajustados ${formatOffset(offset)}`}
              className="min-w-16 text-center font-mono text-meta font-bold tabular">{formatOffset(offset)}</output>
            <Button variant="secondary" className="px-3 font-mono" onClick={() => onOffset(offset + OFFSET_STEP_S)}
              aria-label="Retrasar los subtítulos 0,5 segundos (salen después)">+0,5 s</Button>
            {offset !== 0 && (
              <button type="button" className="min-h-[var(--control-h)] px-2 text-meta font-bold text-text underline underline-offset-4"
                onClick={() => onOffset(0)}>Restablecer</button>
            )}
          </div>
          <p className="mt-1 text-muted">Si salen tarde, pulsa −0,5 s. Se recuerda para este vídeo.</p>
        </div>
      )}
    </div>
  );
}

function PlaybackStatus({ decision, forced, fellBack, setForced }: { decision: PlaybackDecision | null; forced: boolean; fellBack: "direct" | "remux" | null; setForced: (v: boolean) => void }) {
  if (!decision) return null;
  const direct = decision.mode === "direct";
  const remux = decision.mode === "remux";
  return (
    <div className="mt-2 max-w-2xl border-b border-rule pb-4">
      <p className="font-bold">
        {direct ? "Reproducción directa" : remux ? "Sin recodificar el vídeo" : `Convertido en el servidor (${decision.encoder === "nvenc" ? "GPU NVIDIA" : "CPU"})`}
      </p>
      {direct ? (
        <p className="text-muted">El archivo se envía tal cual, sin convertir.</p>
      ) : (
        <ul className="mt-1 list-disc pl-5 text-muted">
          {remux && <li>La imagen no se toca: el servidor solo cambia el contenedor y convierte el audio, así que apenas gasta recursos.</li>}
          {decision.reasons.map((r) => (
            <li key={r.code}>
              {r.code === "forced" && fellBack ? (fellBack === "remux" ? "No se pudo reproducir sin recodificar el vídeo" : "El navegador no pudo reproducir el archivo en directo") : describeReason(r)}
            </li>
          ))}
        </ul>
      )}
      <Button variant="secondary" className="mt-3" onClick={() => setForced(!forced)}>
        {forced ? "Probar reproducción directa" : "Forzar conversión"}
      </Button>
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
      {audio.map((a, i) => row(i === 0 ? "Audio" : "", `${a.codec ?? "?"}${a.channels ? ` · ${plural(a.channels, "canal", "canales")}` : ""}${a.language ? ` · ${a.language}` : ""}`))}
      {subs.length > 0 && row("Subtítulos", subs.map((s) => `${s.language ?? "sin idioma"}${s.isExternal ? " (archivo)" : ""}`).join(", "))}
    </dl>
  );
}
