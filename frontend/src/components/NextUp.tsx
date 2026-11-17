import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { AUTOPLAY_SECONDS, countdownStep } from "../lib/autoplay";
import { Button } from "./Button";

/**
 * Aparece al acabar un episodio. Con `auto`, cuenta atrás y pasa solo al siguiente; se puede cancelar (botón o Escape).
 * La cuenta se ve pero no se lee en voz alta segundo a segundo: el lector de pantalla oye una sola vez cuánto falta.
 * Con «reducir movimiento» no hay barra animada; la cuenta sigue siendo un número.
 */
export function NextUp({ label, auto, onGo, onCancel }: { label: string; auto: boolean; onGo: () => void; onCancel: () => void }) {
  const [remaining, setRemaining] = useState(AUTOPLAY_SECONDS);
  const goBtn = useRef<HTMLButtonElement>(null);
  const go = useRef(onGo);
  go.current = onGo;

  useEffect(() => { goBtn.current?.focus(); }, []);

  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => setRemaining((r) => countdownStep(r).remaining), 1000);
    return () => clearInterval(t);
  }, [auto]);

  useEffect(() => { if (auto && remaining === 0) go.current(); }, [auto, remaining]);

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape" && auto) { e.stopPropagation(); onCancel(); }
  }

  return (
    <section aria-label="Siguiente episodio" onKeyDown={onKeyDown} className="mt-3 rounded-ctl border border-line bg-surface p-4">
      <p className="label">Siguiente</p>
      <p className="mt-1 font-bold">{label}</p>
      <p role="status" className="mt-1 text-muted">
        {auto ? `Empieza solo en ${AUTOPLAY_SECONDS} segundos. Pulsa Cancelar o Escape para quedarte aquí.` : "Listo para ver cuando quieras."}
      </p>
      {auto && (
        <>
          <p aria-hidden="true" className="mt-2 font-mono text-meta tabular text-soft">Empieza en {remaining} s</p>
          <div aria-hidden="true" className="mt-1 h-1 overflow-hidden rounded-ctl bg-raised motion-reduce:hidden">
            <div className="h-full bg-accent motion-safe:transition-[width] motion-safe:duration-1000 motion-safe:ease-linear"
              style={{ width: `${(remaining / AUTOPLAY_SECONDS) * 100}%` }} />
          </div>
        </>
      )}
      <div className="mt-3 flex flex-col gap-3 sm:flex-row">
        <Button ref={goBtn} onClick={onGo}>Ver ahora</Button>
        {auto && <Button variant="secondary" onClick={onCancel}>Cancelar</Button>}
      </div>
    </section>
  );
}
