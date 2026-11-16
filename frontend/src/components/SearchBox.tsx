import { useId } from "react";
import { Icon } from "./Icon";

export function SearchBox({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <div className="mb-6">
      <label htmlFor={id} className="mb-1 block font-bold">{label}</label>
      <div className="relative">
        <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 size-6 -translate-y-1/2 text-muted" />
        <input
          id={id} type="search" value={value} onChange={(e) => onChange(e.target.value)}
          autoComplete="off" spellCheck={false}
          className="min-h-12 w-full rounded-md border-2 border-line bg-surface py-2 pl-12 pr-3 text-text md:max-w-md"
        />
      </div>
    </div>
  );
}
