import { useEffect, useRef, useState, type RefObject } from "react";
import type { DecisionReason, PlaybackDecision } from "@nebula/shared";
import { detectCapabilities } from "../lib/capabilities";
import type { SubtitleTrack } from "../lib/tracks";
import { postJson, sendJson } from "../lib/useApi";
import { Button } from "./Button";

const ERRORS: Record<string, string> = {
  cannot_play: "Este navegador no puede reproducir este vídeo.",
  transcoding_unavailable:
    "Este vídeo necesita convertirse, pero FFmpeg no está disponible en el servidor. Ejecuta «npm run doctor» en el equipo donde está Nebula.",
  unknown_duration: "No se pudo saber la duración del vídeo, así que no se puede convertir.",
  transcode_failed: "La conversión del vídeo ha fallado en el servidor.",
  network: "No se pudo conectar con el servidor de Nebula.",
  generic: "No se pudo reproducir el vídeo.",
};

export function describeReason(r: DecisionReason): string {
  switch (r.code) {
    case "container": return `El navegador no admite el contenedor ${r.detail}`;
    case "video_codec": return `El navegador no admite el vídeo ${r.detail}`;
    case "video_profile": return `Perfil de vídeo no compatible (${r.detail})`;
    case "audio_codec": return `El navegador no admite el audio ${r.detail}`;
    case "audio_track": return "Se eligió una pista de audio distinta de la predeterminada";
    case "bitrate": return "El vídeo supera el ancho de banda indicado";
    case "forced": return "Conversión activada a mano";
  }
}

interface Props {
  fileId: number;
  audioIdx?: number;
  forceTranscode: boolean;
  setForceTranscode: (v: boolean) => void;
  onDecision: (d: PlaybackDecision | null) => void;
  onEnded?: () => void;
  /** Se avisa cuando el navegador no pudo reproducir en directo y se pasa a convertir solo. */
  onDirectFailed?: () => void;
  /** Segundo desde el que empezar (retomar donde se dejó). */
  startAt?: number;
  /** Para que la página pueda mover el vídeo (p. ej. «empezar desde el principio»). */
  videoRef?: RefObject<HTMLVideoElement | null>;
  /** Subtítulos de texto disponibles y el que se muestra (null = ninguno). */
  subtitles?: SubtitleTrack[];
  subtitleIdx?: number | null;
  onSubtitleState?: (s: "loading" | "ready" | "error") => void;
  /** El usuario cambió el subtítulo desde el menú del propio reproductor. */
  onSubtitleChange?: (idx: number | null) => void;
}

const SAVE_EVERY_MS = 10_000;

export function VideoPlayer({ fileId, audioIdx, forceTranscode, setForceTranscode, onDecision, onEnded, onDirectFailed, startAt = 0, videoRef: outerRef, subtitles = [], subtitleIdx = null, onSubtitleState, onSubtitleChange }: Props) {
  const ownRef = useRef<HTMLVideoElement>(null);
  const videoRef = outerRef ?? ownRef;
  const lastSaveRef = useRef(0);
  const resumeRef = useRef(startAt); // posición a retomar al cambiar de modo, pista o sesión
  const retriesRef = useRef(0);
  const decisionRef = useRef<PlaybackDecision | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(true);
  const [mode, setMode] = useState<"direct" | "transcode" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cb = useRef({ onDecision, onEnded, onDirectFailed, onSubtitleState, onSubtitleChange, subtitleIdx });
  cb.current = { onDecision, onEnded, onDirectFailed, onSubtitleState, onSubtitleChange, subtitleIdx };

  // --- Subtítulos: una pista <track> por subtítulo; solo se descarga la que se muestra. ---
  const trackEls = useRef(new Map<number, HTMLTrackElement>());
  useEffect(() => {
    for (const [idx, el] of trackEls.current) {
      const want = idx === subtitleIdx ? "showing" : "disabled";
      if (el.track.mode !== want) el.track.mode = want;
    }
    if (subtitleIdx === null) return;
    const el = trackEls.current.get(subtitleIdx);
    if (el && el.readyState === 2) cb.current.onSubtitleState?.("ready"); // ya estaba cargada
    else if (el && el.readyState !== 3) cb.current.onSubtitleState?.("loading");
  }, [subtitleIdx, subtitles]);
  useEffect(() => {
    const list = videoRef.current?.textTracks;
    if (!list) return;
    // El menú «CC» nativo también puede cambiar la pista: se refleja en nuestro selector.
    const onChange = () => {
      let showing: number | null = null;
      for (const [idx, el] of trackEls.current) if (el.track.mode === "showing") showing = idx;
      if (showing !== cb.current.subtitleIdx) cb.current.onSubtitleChange?.(showing);
    };
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [videoRef]);
  const trackRef = (idx: number) => (el: HTMLTrackElement | null) => {
    if (!el) { trackEls.current.delete(idx); return; }
    trackEls.current.set(idx, el);
    const ok = () => { if (cb.current.subtitleIdx === idx) cb.current.onSubtitleState?.("ready"); };
    const bad = () => { if (cb.current.subtitleIdx === idx) cb.current.onSubtitleState?.("error"); };
    el.addEventListener("load", ok); el.addEventListener("error", bad);
    return () => { el.removeEventListener("load", ok); el.removeEventListener("error", bad); trackEls.current.delete(idx); };
  };

  // Va antes del efecto principal: al salir, este limpia primero y aún ve el vídeo cargado.
  // --- Progreso: se guarda cada 10 s, al pausar, al terminar y al cerrar la pestaña. ---
  const progressBody = () => {
    const v = videoRef.current;
    if (!v || v.readyState < 1 || !Number.isFinite(v.currentTime)) return null; // aún no hay vídeo cargado: no machacar lo guardado
    const dur = decisionRef.current?.durationS ?? (Number.isFinite(v.duration) ? v.duration : null);
    return { positionS: v.ended && dur ? dur : v.currentTime, durationS: dur };
  };
  const saveProgress = () => {
    const body = progressBody();
    if (!body) return;
    lastSaveRef.current = Date.now();
    void sendJson("PUT", `/api/progress/${fileId}`, body);
  };
  useEffect(() => {
    const beacon = () => {
      const body = progressBody();
      if (body) navigator.sendBeacon(`/api/progress/${fileId}`, new Blob([JSON.stringify(body)], { type: "application/json" }));
    };
    const onHidden = () => { if (document.visibilityState === "hidden") beacon(); };
    window.addEventListener("pagehide", beacon);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("pagehide", beacon);
      document.removeEventListener("visibilitychange", onHidden);
      beacon(); // al salir de la página dentro de la app
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId]);

  useEffect(() => {
    const video = videoRef.current!;
    let cancelled = false;
    let hls: import("hls.js").default | null = null;
    let sessionId: string | null = null;
    setBusy(true);
    setError(null);

    const resumeWhenReady = () => {
      const at = resumeRef.current;
      if (at > 1) video.addEventListener("loadedmetadata", () => { video.currentTime = at; }, { once: true });
    };

    (async () => {
      const res = await postJson<PlaybackDecision>(`/api/playback/${fileId}/decide`, {
        capabilities: detectCapabilities(),
        audioStreamIdx: audioIdx,
        forceTranscode: forceTranscode || undefined,
      });
      if (cancelled) return;
      if (!res.ok) { setError(ERRORS[res.code] ?? ERRORS.generic); setBusy(false); return; }

      const d = res.data;
      decisionRef.current = d;
      cb.current.onDecision(d);
      setMode(d.mode);
      sessionId = d.sessionId ?? null;

      if (d.mode === "direct") {
        video.src = d.url;
        resumeWhenReady();
        return;
      }
      const caps = detectCapabilities();
      if (caps.hls === "native") {
        video.src = d.url; // Safari reproduce HLS por sí mismo
        resumeWhenReady();
        return;
      }
      const { default: Hls } = await import("hls.js");
      if (cancelled) return;
      hls = new Hls({ startPosition: resumeRef.current > 1 ? resumeRef.current : -1, maxBufferLength: 30 });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal || cancelled) return;
        const status = data.response?.code;
        if (status === 410 && retriesRef.current < 2) { // la sesión caducó en el servidor: se crea otra
          retriesRef.current++;
          resumeRef.current = video.currentTime;
          setAttempt((a) => a + 1);
        } else if (status === 500) {
          setError(ERRORS.transcode_failed);
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && retriesRef.current < 2) {
          retriesRef.current++;
          hls!.recoverMediaError();
        } else if (data.type === Hls.ErrorTypes.NETWORK_ERROR && retriesRef.current < 2) {
          retriesRef.current++;
          hls!.startLoad();
        } else {
          setError(ERRORS.generic);
        }
      });
      hls.loadSource(d.url);
      hls.attachMedia(video);
    })();

    const onPageHide = () => { if (sessionId) navigator.sendBeacon(`/api/hls/${sessionId}/stop`); };
    window.addEventListener("pagehide", onPageHide);

    return () => {
      window.removeEventListener("pagehide", onPageHide);
      cancelled = true;
      if (video.currentTime > 1) resumeRef.current = video.currentTime;
      hls?.destroy();
      if (sessionId) navigator.sendBeacon(`/api/hls/${sessionId}/stop`);
      video.removeAttribute("src");
      video.load();
    };
  }, [fileId, audioIdx, forceTranscode, attempt]);

  function onVideoError(e: React.SyntheticEvent<HTMLVideoElement>) {
    const code = e.currentTarget.error?.code;
    if (code === 1 || !decisionRef.current) return;
    if (decisionRef.current.mode === "direct" && !forceTranscode) {
      // El navegador dijo que podía, pero no pudo: se reintenta convirtiendo en el servidor.
      resumeRef.current = e.currentTarget.currentTime;
      cb.current.onDirectFailed?.();
      setForceTranscode(true);
      return;
    }
    if (!error) setError(ERRORS.generic);
  }

  return (
    <>
      <video
        ref={videoRef} controls autoPlay playsInline preload="metadata"
        className="aspect-video w-full bg-black"
        onError={onVideoError}
        onLoadStart={() => setBusy(true)}
        onWaiting={() => setBusy(true)}
        onCanPlay={() => setBusy(false)}
        onPlaying={() => { setBusy(false); retriesRef.current = 0; }}
        onTimeUpdate={() => { if (Date.now() - lastSaveRef.current >= SAVE_EVERY_MS) saveProgress(); }}
        onPause={saveProgress}
        onEnded={() => { saveProgress(); cb.current.onEnded?.(); }}
      >
        {subtitles.map((t) => (
          <track key={t.idx} ref={trackRef(t.idx)} kind="subtitles" label={t.label} srcLang={t.lang}
            src={`/api/subtitles/${fileId}/${t.idx}.vtt`} />
        ))}
        Tu navegador no admite vídeo HTML5.
      </video>

      <p role="status" className="mt-2 min-h-7 text-muted">
        {!error && busy ? (mode === "transcode" ? "Convirtiendo el vídeo para tu navegador…" : "Cargando…") : ""}
      </p>

      {error && (
        <div role="alert" className="mt-2 rounded-ctl border border-danger bg-surface p-4">
          <p>{error}</p>
          <Button variant="secondary" className="mt-3" onClick={() => { retriesRef.current = 0; setError(null); setAttempt((a) => a + 1); }}>
            Intentarlo de nuevo
          </Button>
        </div>
      )}
    </>
  );
}
