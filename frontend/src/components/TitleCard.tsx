import { useState } from "react";
import { Link } from "react-router-dom";
import { tintFor } from "../lib/format";
import { Icon } from "./Icon";

interface Props {
  to: string; title: string; kind: "Película" | "Serie" | "Episodio"; meta: string;
  /** Fracción vista (0–1): barra al pie del cartel. */
  progress?: number;
  watched?: boolean;
  /** Carátula (URL de Nebula). Sin ella, o si no carga, se usa el cartel tipográfico. */
  poster?: string | null;
}

/** Cartel con carátula si la hay; si no, un cartel tipográfico con tono propio por título. */
export function TitleCard({ to, title, kind, meta, progress = 0, watched = false, poster }: Props) {
  const [failed, setFailed] = useState(false);
  const withPoster = !!poster && !failed;
  const showBar = !watched && progress > 0.02;

  const overlays = (
    <>
      {watched && (
        <span className="absolute right-3 top-3 inline-flex items-center gap-1 bg-[#f6efe4] px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-[#231c16]">
          <Icon name="check" className="size-3.5" /> Vista
        </span>
      )}
      {showBar && (
        <span aria-hidden="true" className={`absolute inset-x-0 bottom-0 ${withPoster ? "bg-black/70 px-3 py-2" : "mx-4 mb-3"}`}>
          <span className="block h-1.5 bg-[#f6efe4]/35">
            <span className="block h-full bg-[#f6efe4]" style={{ width: `${Math.min(100, Math.round(progress * 100))}%` }} />
          </span>
        </span>
      )}
    </>
  );

  if (withPoster) {
    return (
      <Link to={to} className="group block">
        <div className="relative aspect-[2/3] overflow-hidden bg-surface motion-safe:transition-transform motion-safe:group-hover:-translate-y-1">
          <img src={poster!} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} className="size-full object-cover" />
          {overlays}
        </div>
        <p className="mt-2 line-clamp-2 font-display text-lg font-semibold leading-tight">{title}</p>
        <p className="text-muted group-hover:text-text">{meta}</p>
      </Link>
    );
  }

  return (
    <Link to={to} className="group block">
      <div
        style={{ background: tintFor(title) }}
        className="relative flex aspect-[2/3] flex-col justify-between p-4 text-[#f6efe4]
                   motion-safe:transition-transform motion-safe:group-hover:-translate-y-1"
      >
        <span aria-hidden="true" className="pointer-events-none absolute inset-2 border border-[#f6efe4]/40" />
        <span className="relative text-xs font-bold uppercase tracking-[0.16em]">{kind}</span>
        <span className={`relative line-clamp-5 font-display text-[clamp(1.25rem,5.5vw,1.75rem)] font-semibold leading-[1.05] [overflow-wrap:anywhere] ${showBar ? "mb-4" : ""}`}>
          {title}
        </span>
        {overlays}
      </div>
      <p className="mt-2 text-muted group-hover:text-text">{meta}</p>
    </Link>
  );
}
