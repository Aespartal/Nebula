import { useEffect, useId, useRef } from "react";
import { Icon } from "./Icon";

/** Campo de búsqueda. «/» o Ctrl/⌘+K lo enfocan desde cualquier parte de la página. */
export function SearchBox({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? "") || (document.activeElement as HTMLElement | null)?.isContentEditable;
      if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") || (e.key === "/" && !typing)) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="mb-6">
      <label htmlFor={id} className="label mb-1.5 block">{label}</label>
      <div className="relative md:max-w-md">
        <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
        <input
          ref={ref} id={id} type="search" value={value} onChange={(e) => onChange(e.target.value)}
          autoComplete="off" spellCheck={false}
          className="min-h-[var(--control-h)] w-full rounded-ctl border border-line bg-surface py-2 pl-9 pr-12 text-meta text-text placeholder:text-faint focus:border-muted"
        />
        <kbd aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-ctl border border-rule bg-bg px-1.5 font-mono text-label text-faint [@media(pointer:fine)]:inline-block">
          /
        </kbd>
      </div>
    </div>
  );
}
