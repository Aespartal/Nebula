import { Link } from "react-router-dom";
import { tintFor } from "../lib/format";

interface Props { to: string; title: string; kind: "Película" | "Serie"; meta: string }

/** Cartel tipográfico: sin pósters todavía, cada título tiene su propio tono. */
export function TitleCard({ to, title, kind, meta }: Props) {
  return (
    <Link to={to} className="group block">
      <div
        style={{ background: tintFor(title) }}
        className="relative flex aspect-[2/3] flex-col justify-between p-4 text-[#f6efe4]
                   motion-safe:transition-transform motion-safe:group-hover:-translate-y-1"
      >
        <span aria-hidden="true" className="pointer-events-none absolute inset-2 border border-[#f6efe4]/40" />
        <span className="relative text-xs font-bold uppercase tracking-[0.16em]">{kind}</span>
        <span className="relative line-clamp-5 font-display text-[clamp(1.25rem,5.5vw,1.75rem)] font-semibold leading-[1.05] [overflow-wrap:anywhere]">
          {title}
        </span>
      </div>
      <p className="mt-2 text-muted group-hover:text-text">{meta}</p>
    </Link>
  );
}
