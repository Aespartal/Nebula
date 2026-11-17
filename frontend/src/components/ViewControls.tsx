import { useId } from "react";
import { ESTADOS, type Estado } from "../lib/catalogView";

const chip = "inline-flex min-h-[var(--control-h)] items-center gap-2 rounded-ctl border px-3 text-meta font-bold transition-colors";
const chipOn = "border-muted bg-raised text-text";
const chipOff = "border-line bg-surface text-muted hover:border-muted hover:text-text";

/** Estado (chips) y orden (selector) de una lista de títulos. */
export function ViewControls<O extends string>({ estado, onEstado, counts, orders, order, onOrder }: {
  estado: Estado; onEstado: (e: Estado) => void; counts: Record<Estado, number>;
  orders: readonly { value: O; label: string }[]; order: O; onOrder: (o: O) => void;
}) {
  const groupId = useId();
  const selectId = useId();
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
      <div role="group" aria-labelledby={groupId}>
        <span id={groupId} className="label mb-1.5 block">Mostrar</span>
        <div className="flex flex-wrap gap-2">
          {ESTADOS.map((e) => (
            <button key={e.value} type="button" aria-pressed={estado === e.value} onClick={() => onEstado(e.value)}
              className={`${chip} ${estado === e.value ? chipOn : chipOff}`}>
              {e.label}
              <span className="font-mono text-label font-normal text-faint tabular">{counts[e.value]}</span>
            </button>
          ))}
        </div>
      </div>
      <div>
        <label htmlFor={selectId} className="label mb-1.5 block">Ordenar por</label>
        <select id={selectId} value={order} onChange={(e) => onOrder(e.target.value as O)} className="field sm:w-auto">
          {orders.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
    </div>
  );
}
