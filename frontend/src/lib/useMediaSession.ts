import { useEffect, useRef, type RefObject } from "react";
import { bindMediaSession, type MediaInfo, type MediaNav } from "./mediaSession";

/** Teclas multimedia, auriculares y pantalla de bloqueo para el vídeo de `videoRef`. No hace nada donde no hay Media Session. */
export function useMediaSession(videoRef: RefObject<HTMLVideoElement | null>, info: MediaInfo, nav: MediaNav) {
  // Las funciones de navegación cambian en cada render: se leen por ref para no reconectar la sesión por ello.
  const navRef = useRef(nav);
  navRef.current = nav;
  const hasNext = !!nav.onNext;
  const hasPrevious = !!nav.onPrevious;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || typeof navigator === "undefined" || !("mediaSession" in navigator) || typeof MediaMetadata === "undefined") return;
    return bindMediaSession(
      navigator.mediaSession, video, info,
      {
        onNext: hasNext ? () => navRef.current.onNext?.() : undefined,
        onPrevious: hasPrevious ? () => navRef.current.onPrevious?.() : undefined,
      },
      (init) => new MediaMetadata(init),
    );
  }, [videoRef, info.title, info.subtitle, info.poster, hasNext, hasPrevious]);
}
