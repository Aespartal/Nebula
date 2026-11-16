import { useId, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { MediaFileInfo, MediaStreamInfo, PlaybackDecision } from "@nebula/shared";
import { Button, LinkButton } from "../components/Button";
import { Icon } from "../components/Icon";
import { Wordmark } from "../components/Layout";
import { ErrorBox, Loading } from "../components/States";
import { VideoPlayer, describeReason } from "../components/VideoPlayer";
import { formatClock, formatDuration, formatSize, plural } from "../lib/format";
import { languageName, normalizeLang } from "../lib/lang";
import { audioPref, subtitlePref } from "../lib/prefs";
import { pickAudio, pickSubtitle, subtitleLabel, textSubtitles } from "../lib/tracks";
import { useFocusWhen } from "../lib/useFocusWhen";
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
        <Link to={backTo} className="inline-flex min-h-12 items-center gap-1 pr-3 font-bold">
          <Icon name="back" className="size-6" /> {backLabel}
        </Link>
        <Wordmark />
      </header>

      <main id="contenido">
        {loading && <Loading />}
        {error && <ErrorBox message={error} onRetry={reload} />}
        {info && <WatchContent info={info} />}
      </main>
    </div>
  );
}

function WatchContent({ info }: { info: MediaFileInfo }) {
  const id = String(info.id);
  const [decision, setDecision] = useState<PlaybackDecision | null>(null);
  const [forceTranscode, setForceTranscode] = useState(false);
  const [fellBack, setFellBack] = useState(false);
  // Idioma de audio y subtítulos: se parte de lo que se eligió la última vez en este navegador.
  const [audioIdx, setAudioIdx] = useState<number | undefined>(() => pickAudio(info.streams, audioPref.get()));
  const tracks = useMemo(() => textSubtitles(info.streams), [info.streams]);
  const [subtitleIdx, setSubtitleIdx] = useState<number | null>(() => pickSubtitle(tracks, subtitlePref.get()));
  const [subState, setSubState] = useState<"loading" | "ready" | "error" | null>(null);
  const nextRef = useRef<HTMLAnchorElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [startedOver, setStartedOver] = useState(false);
  const [watched, setWatched] = useState<boolean | null>(null);
  const h1 = useRef<HTMLHeadingElement>(null);
  useFocusWhen(h1, true);

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
        onDirectFailed={() => setFellBack(true)}
        onEnded={() => nextRef.current?.focus()}
        startAt={resumeAt} videoRef={videoRef}
        subtitles={tracks} subtitleIdx={subtitleIdx}
        onSubtitleState={setSubState} onSubtitleChange={chooseSubtitle}
      />

      <div className="mt-5">
        {info.subtitle && <p className="font-bold text-muted">{info.subtitle}</p>}
        <h1 ref={h1} tabIndex={-1} className="font-display text-3xl font-semibold leading-tight outline-none md:text-4xl">{info.title}</h1>
        {info.overview && <p className="mt-3 max-w-prose text-muted">{info.overview}</p>}
      </div>

      {resumeAt > 0 && !startedOver && (
        <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-muted">
          Retomando en {formatClock(resumeAt)}.
          <button type="button" className="min-h-12 font-bold text-text underline underline-offset-4"
            onClick={() => { if (videoRef.current) videoRef.current.currentTime = 0; setStartedOver(true); }}>
            Empezar desde el principio
          </button>
        </p>
      )}

      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <Button variant="secondary" aria-pressed={isWatched} onClick={toggleWatched}>
          <Icon name="check" className="size-5" /> {isWatched ? "Vista · quitar marca" : "Marcar como vista"}
        </Button>
        {info.next && (
          <LinkButton ref={nextRef} to={`/ver/${info.next.fileId}`} className="w-full sm:w-auto">
            <Icon name="play" className="size-5" /> Siguiente: {info.next.label}
          </LinkButton>
        )}
      </div>

      <div className="mt-6 grid max-w-2xl gap-5 sm:grid-cols-2">
        <AudioPicker streams={info.streams} value={audioIdx} onChange={chooseAudio} />
        <SubtitlePicker streams={info.streams} value={subtitleIdx} onChange={chooseSubtitle} state={subState} />
      </div>

      <details className="mt-8 border-t border-rule pt-3">
        <summary className="min-h-12 py-2 font-bold">Detalles técnicos</summary>
        <PlaybackStatus decision={decision} forced={forceTranscode} fellBack={fellBack}
          setForced={(v) => { setFellBack(false); setForceTranscode(v); }} />
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
      <label htmlFor={id} className="mb-1 block font-bold">Audio</label>
      <select id={id} value={current} onChange={(e) => onChange(Number(e.target.value))}
        className={selectCls}>
        {audio.map((s) => <option key={s.idx} value={s.idx}>{label(s)}</option>)}
      </select>
    </div>
  );
}

const selectCls = "min-h-12 w-full rounded-md border-2 border-line bg-surface px-3 py-2 text-text";

function SubtitlePicker({ streams, value, onChange, state }: {
  streams: MediaStreamInfo[]; value: number | null; onChange: (v: number | null) => void; state: "loading" | "ready" | "error" | null;
}) {
  const id = useId();
  const subs = streams.filter((s) => s.kind === "subtitle");
  if (subs.length === 0) return null;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block font-bold">Subtítulos</label>
      <select id={id} value={value === null ? "" : String(value)} className={selectCls}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}>
        <option value="">Sin subtítulos</option>
        {subs.map((s) => <option key={s.idx} value={s.idx} disabled={!s.textual}>{subtitleLabel(s)}</option>)}
      </select>
      <p role="status" className="mt-1 min-h-6 text-muted">
        {value !== null && state === "loading" && "Cargando subtítulos… En un archivo grande puede tardar un poco la primera vez."}
        {value !== null && state === "error" && "No se pudieron cargar estos subtítulos."}
      </p>
    </div>
  );
}

function PlaybackStatus({ decision, forced, fellBack, setForced }: { decision: PlaybackDecision | null; forced: boolean; fellBack: boolean; setForced: (v: boolean) => void }) {
  if (!decision) return null;
  const direct = decision.mode === "direct";
  return (
    <div className="mt-2 max-w-2xl border-b border-rule pb-4">
      <p className="font-bold">{direct ? "Reproducción directa" : `Convertido en el servidor (${decision.encoder === "nvenc" ? "GPU NVIDIA" : "CPU"})`}</p>
      {direct ? (
        <p className="text-muted">El archivo se envía tal cual, sin convertir.</p>
      ) : (
        <ul className="mt-1 list-disc pl-5 text-muted">
          {decision.reasons.map((r) => (
            <li key={r.code}>
              {r.code === "forced" && fellBack ? "El navegador no pudo reproducir el archivo en directo" : describeReason(r)}
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
