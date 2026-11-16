import { Link } from "react-router-dom";
import { tintFor } from "../lib/format";
import { Icon } from "./Icon";

interface Props {
  to: string; title: string; kind: "Película" | "Serie" | "Episodio"; meta: string;
  /** Fracción vista (0–1): barra al pie del cartel. */
  progress?: number;
  watched?: boolean;
}

/** Cartel tipográfico: sin pósters todavía, cada título tiene su propio tono. */
export function TitleCard({ to, title, kind, meta, progress = 0, watched = false }: Props) {
  return (
    <Link to={to} className="group block">
      <div
        style={{ background: tintFor(title) }}
        className="relative flex aspect-[2/3] flex-col justify-between p-4 text-[#f6efe4]
                   motion-safe:transition-transform motion-safe:group-hover:-translate-y-1"
      >
        <span aria-hidden="true" className="pointer-events-none absolute inset-2 border border-[#f6efe4]/40" />
        <span className="relative text-xs font-bold uppercase tracking-[0.16em]">{kind}</span>
        {watched && (
          <span className="absolute right-3 top-3 inline-flex items-center gap-1 bg-[#f6efe4] px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-[#231c16]">
            <Icon name="check" className="size-3.5" /> Vista
          </span>
        )}
        {!watched && progress > 0.02 && (
          <span aria-hidden="true" className="absolute inset-x-4 bottom-3 h-1.5 bg-[#f6efe4]/35">
            <span className="block h-full bg-[#f6efe4]" style={{ width: `${Math.min(100, Math.round(progress * 100))}%` }} />
          </span>
        )}
        <span className={`relative line-clamp-5 font-display text-[clamp(1.25rem,5.5vw,1.75rem)] font-semibold leading-[1.05] [overflow-wrap:anywhere] ${progress > 0.02 && !watched ? "mb-4" : ""}`}>
          {title}
        </span>
      </div>
      <p className="mt-2 text-muted group-hover:text-text">{meta}</p>
    </Link>
  );
}
