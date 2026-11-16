import { useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "./Icon";

interface Props {
  to: string; title: string; kind: "Película" | "Serie" | "Episodio";
  /** Dato principal bajo el título (año, «T1 E2»…). */
  meta: string;
  /** Dato secundario a la derecha, en mono (duración, «Retomar en 12:30»…). */
  aside?: string | null;
  /** Fracción vista (0–1): barra de 2 px al pie del cartel. */
  progress?: number;
  watched?: boolean;
  /** Carátula (URL de Nebula). Sin ella, o si no carga, se usa el cartel tipográfico. */
  poster?: string | null;
}

/** Cartel 2:3 con borde fino. Con carátula, y con ratón, al pasar por encima aparece el botón de reproducir. */
export function TitleCard({ to, title, kind, meta, aside, progress = 0, watched = false, poster }: Props) {
  const [failed, setFailed] = useState(false);
  const withPoster = !!poster && !failed;
  const showBar = !watched && progress > 0.02;

  return (
    <Link to={to} className="group block">
      <div className="relative aspect-[2/3] overflow-hidden rounded-ctl border border-rule bg-surface transition-colors group-hover:border-rule-strong group-focus-visible:border-muted">
        {withPoster ? (
          <img src={poster!} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} className="size-full object-cover" />
        ) : (
          <div className="flex size-full flex-col justify-between p-3">
            <span className="label">{kind}</span>
            <span className="line-clamp-5 text-[clamp(1rem,4.6vw,1.375rem)] font-bold leading-[1.1] tracking-tight [overflow-wrap:anywhere]">{title}</span>
          </div>
        )}

        {/* Velo con botón de reproducir: solo con ratón o al enfocar con teclado; en táctil el cartel entero es el toque. */}
        <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center bg-scrim opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 [@media(pointer:coarse)]:hidden">
          <span className="flex size-10 items-center justify-center rounded-full bg-accent text-on-accent"><Icon name="play" className="ml-0.5 size-4" /></span>
        </span>

        {watched && (
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-ctl border border-rule bg-bg/90 px-1.5 py-0.5 font-mono text-label text-soft">
            <Icon name="check" className="size-3" /> VISTA
          </span>
        )}
        {showBar && (
          <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[3px] bg-track">
            <span className="block h-full bg-accent" style={{ width: `${Math.min(100, Math.round(progress * 100))}%` }} />
          </span>
        )}
      </div>

      <div className="space-y-0.5 pt-2.5">
        {withPoster && <p className="truncate text-meta font-bold text-text group-hover:text-white" title={title}>{title}</p>}
        <p className="flex items-baseline justify-between gap-2 font-mono text-label text-faint">
          <span className={aside ? "truncate" : ""}>{meta}</span>
          {aside && <span className="shrink-0 text-muted">{aside}</span>}
        </p>
      </div>
    </Link>
  );
}
