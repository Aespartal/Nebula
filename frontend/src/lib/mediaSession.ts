// Media Session API: las teclas multimedia, los auriculares y la pantalla de bloqueo controlan el vídeo y muestran qué suena.
// Es una función pura (sin React) para poder probarla con un vídeo simulado.

const SEEK_S = 10; // salto por defecto de «adelantar» y «retroceder»
const RESTART_AFTER_S = 5; // «anterior» pasada esta marca reinicia el episodio en vez de ir al anterior

type Handler = ((details: { seekOffset?: number; seekTime?: number; fastSeek?: boolean }) => void) | null;

export interface MediaSessionLike {
  metadata: unknown;
  setActionHandler(action: string, handler: Handler): void;
  setPositionState?(state?: { duration: number; playbackRate: number; position: number }): void;
}

export interface MediaVideoLike extends EventTarget {
  currentTime: number;
  readonly duration: number;
  readonly playbackRate: number;
  play(): Promise<void> | void;
  pause(): void;
}

export interface MediaInfo {
  title: string;
  /** Línea bajo el título: «Serie · T1 E2» o el año. */
  subtitle?: string | null;
  poster?: string | null;
}

export interface MediaNav { onNext?: () => void; onPrevious?: () => void }

const ACTIONS = ["play", "pause", "seekbackward", "seekforward", "seekto", "previoustrack", "nexttrack"] as const;

/** Conecta el vídeo con el sistema. Devuelve la función que lo desconecta (la sesión es global del navegador: hay que limpiarla). */
export function bindMediaSession(
  session: MediaSessionLike,
  video: MediaVideoLike,
  info: MediaInfo,
  nav: MediaNav,
  makeMetadata: (init: { title: string; artist?: string; artwork?: { src: string }[] }) => unknown,
): () => void {
  session.metadata = makeMetadata({
    title: info.title,
    ...(info.subtitle ? { artist: info.subtitle } : {}),
    ...(info.poster ? { artwork: [{ src: info.poster }] } : {}),
  });

  // Un navegador puede no admitir alguna acción (p. ej. seekto en versiones viejas): se ignora esa y se sigue.
  const on = (action: (typeof ACTIONS)[number], handler: Handler) => {
    try { session.setActionHandler(action, handler); } catch { /* acción no admitida */ }
  };
  const seekBy = (s: number) => {
    const end = Number.isFinite(video.duration) ? video.duration : Infinity;
    video.currentTime = Math.min(end, Math.max(0, video.currentTime + s));
  };

  on("play", () => { Promise.resolve(video.play()).catch(() => {}); });
  on("pause", () => video.pause());
  on("seekbackward", (d) => seekBy(-(d.seekOffset ?? SEEK_S)));
  on("seekforward", (d) => seekBy(d.seekOffset ?? SEEK_S));
  on("seekto", (d) => { if (typeof d.seekTime === "number") video.currentTime = d.seekTime; });
  on("previoustrack", () => {
    if (video.currentTime > RESTART_AFTER_S || !nav.onPrevious) video.currentTime = 0;
    else nav.onPrevious();
  });
  // Sin siguiente episodio no se registra: así el sistema no muestra un botón que no hace nada.
  on("nexttrack", nav.onNext ? () => nav.onNext!() : null);

  // El sistema extrapola la posición a partir de esto, así que basta con avisar de los cambios (no en cada timeupdate).
  const syncPosition = () => {
    const d = video.duration;
    if (!Number.isFinite(d) || d <= 0) return;
    try {
      session.setPositionState?.({ duration: d, playbackRate: video.playbackRate || 1, position: Math.min(Math.max(video.currentTime, 0), d) });
    } catch { /* valores fuera de rango durante la carga: se reintenta en el siguiente evento */ }
  };
  const events = ["loadedmetadata", "durationchange", "ratechange", "seeked", "play", "pause"];
  for (const e of events) video.addEventListener(e, syncPosition);
  syncPosition();

  return () => {
    for (const e of events) video.removeEventListener(e, syncPosition);
    for (const a of ACTIONS) on(a, null);
    session.metadata = null;
    try { session.setPositionState?.(); } catch { /* nada que limpiar */ }
  };
}
