import { useEffect, useRef, useState, type RefObject } from "react";
import type { CastSession } from "@nebula/shared";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { formatClock } from "../lib/format";
import { sendJson } from "../lib/useApi";

/* Tipos mínimos del SDK de Google Cast (se carga desde gstatic.com). */
/* eslint-disable @typescript-eslint/no-explicit-any */
declare global { interface Window { cast?: any; chrome?: any; __onGCastApiAvailable?: (ok: boolean) => void } }

const SDK = "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";
let sdkPromise: Promise<boolean> | null = null;
function loadSdk(): Promise<boolean> {
  sdkPromise ??= new Promise<boolean>((resolve) => {
    window.__onGCastApiAvailable = (ok) => resolve(ok);
    const s = document.createElement("script");
    s.src = SDK; s.async = true; s.onerror = () => resolve(false);
    document.head.appendChild(s);
    setTimeout(() => resolve(false), 8000);
  });
  return sdkPromise;
}

const ERRORS: Record<string, string> = {
  cast_not_configured: "El envío a la tele no está configurado en este servidor (falta PUBLIC_URL).",
  transcoding_unavailable: "Este servidor no puede convertir vídeo (FFmpeg), y la tele lo necesita.",
  cannot_play: "Este archivo no se puede enviar a la tele.",
  unknown_duration: "Este archivo aún no está analizado del todo. Prueba tras «Buscar cambios» en Ajustes.",
  network: "No se pudo conectar con Nebula.",
};

type Phase = "loading" | "unsupported" | "idle" | "starting" | "casting";

export function CastPanel({ fileId, title, audioIdx, videoRef }: { fileId: number; title: string; audioIdx?: number; videoRef: RefObject<HTMLVideoElement | null> }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [device, setDevice] = useState("");
  const [paused, setPaused] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [error, setError] = useState("");
  const player = useRef<any>(null);
  const controller = useRef<any>(null);
  const sid = useRef<string | null>(null);
  const lastSave = useRef(0);
  const phaseRef = useRef<Phase>("loading");
  const set = (p: Phase) => { phaseRef.current = p; setPhase(p); };

  useEffect(() => {
    let dead = false;
    void loadSdk().then((ok) => {
      if (dead) return;
      if (!ok || !window.cast?.framework) { set("unsupported"); return; }
      const ctx = window.cast.framework.CastContext.getInstance();
      ctx.setOptions({ receiverApplicationId: window.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID, autoJoinPolicy: window.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED });
      player.current = new window.cast.framework.RemotePlayer();
      controller.current = new window.cast.framework.RemotePlayerController(player.current);
      const sync = () => {
        const p = player.current;
        setPaused(!!p.isPaused); setPos(p.currentTime || 0); setDur(p.duration || 0);
        if (p.isConnected && p.currentTime > 0 && Date.now() - lastSave.current > 15_000 && p.duration > 0) {
          lastSave.current = Date.now();
          void sendJson("PUT", `/api/progress/${fileId}`, { positionS: p.currentTime, durationS: p.duration });
        }
      };
      const T = window.cast.framework.RemotePlayerEventType;
      controller.current.addEventListener(T.ANY_CHANGE, sync);
      controller.current.addEventListener(T.IS_CONNECTED_CHANGED, () => {
        if (!player.current.isConnected && phaseRef.current === "casting") finish(false);
      });
      set("idle");
    });
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId]);

  // Si te vas de la página mientras se envía, la tele sigue con lo suyo: aquí solo se libera la conversión al volver a empezar.
  function finish(endSession: boolean) {
    const at = player.current?.currentTime ?? 0;
    if (endSession) window.cast.framework.CastContext.getInstance().endCurrentSession(true);
    if (sid.current) void sendJson("POST", `/api/hls/${sid.current}/stop`, {});
    sid.current = null;
    if (videoRef.current && at > 1) videoRef.current.currentTime = at;
    set("idle");
  }

  async function start() {
    setError("");
    const ctx = window.cast.framework.CastContext.getInstance();
    set("starting");
    try { await ctx.requestSession(); } catch { set("idle"); return; } // el usuario cerró el selector, o no hay tele
    const r = await sendJson<CastSession>("POST", `/api/cast/${fileId}`, audioIdx !== undefined ? { audioStreamIdx: audioIdx } : {});
    if (!r.ok) { ctx.endCurrentSession(true); setError(ERRORS[r.code] ?? "No se pudo preparar el envío."); set("idle"); return; }
    sid.current = r.data.sessionId;
    const cc = window.chrome.cast;
    const info = new cc.media.MediaInfo(r.data.url, "application/x-mpegURL");
    info.streamType = cc.media.StreamType.BUFFERED;
    info.duration = r.data.durationS;
    info.metadata = new cc.media.GenericMediaMetadata(); info.metadata.title = title;
    const req = new cc.media.LoadRequest(info);
    req.autoplay = true;
    req.currentTime = videoRef.current?.currentTime ?? 0;
    try {
      await ctx.getCurrentSession().loadMedia(req);
    } catch {
      setError("La tele no pudo cargar el vídeo. Comprueba que Nebula es accesible por Internet con HTTPS.");
      finish(true); return;
    }
    videoRef.current?.pause();
    setDevice(ctx.getCurrentSession().getCastDevice().friendlyName ?? "la tele");
    lastSave.current = Date.now();
    set("casting");
  }

  const seekBy = (d: number) => {
    const p = player.current; if (!p) return;
    p.currentTime = Math.max(0, Math.min(p.duration || Infinity, (p.currentTime || 0) + d));
    controller.current.seek();
  };

  if (phase === "loading" || phase === "unsupported") {
    return phase === "unsupported"
      ? <p className="mt-4 max-w-prose text-muted">Para enviar a una tele necesitas Chrome (Android o PC) y estar en la misma wifi que ella, o que la tele sea accesible desde tu red.</p>
      : null;
  }

  return (
    <section aria-label="Enviar a la TV" className="mt-6 max-w-2xl">
      {phase !== "casting" ? (
        <Button variant="secondary" className="w-full sm:w-auto" onClick={start} disabled={phase === "starting"} aria-busy={phase === "starting"}>
          <Icon name="cast" className="size-5" /> {phase === "starting" ? "Conectando…" : "Enviar a la TV"}
        </Button>
      ) : (
        <div className="panel p-4">
          <p role="status" className="mb-3 font-bold"><Icon name="cast" className="mr-2 inline size-5 align-text-bottom" />Reproduciendo en {device}</p>
          <div className="mb-3 h-1 bg-rule" role="progressbar" aria-label="Progreso en la tele" aria-valuemin={0} aria-valuemax={Math.round(dur)} aria-valuenow={Math.round(pos)} aria-valuetext={`${formatClock(pos)} de ${formatClock(dur)}`}>
            <div className="h-full bg-text" style={{ width: dur ? `${Math.min(100, (pos / dur) * 100)}%` : "0%" }} />
          </div>
          <p className="mb-3 text-meta text-muted">{formatClock(pos)} / {formatClock(dur)}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => seekBy(-10)} aria-label="Retroceder 10 segundos">−10 s</Button>
            <Button variant="secondary" onClick={() => controller.current.playOrPause()}>{paused ? "Reanudar" : "Pausar"}</Button>
            <Button variant="secondary" onClick={() => seekBy(10)} aria-label="Avanzar 10 segundos">+10 s</Button>
            <Button variant="secondary" onClick={() => finish(true)}>Dejar de enviar</Button>
          </div>
        </div>
      )}
      <div role="alert">{error && <p className="msg-error mt-3">{error}</p>}</div>
    </section>
  );
}
