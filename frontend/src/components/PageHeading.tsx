export function PageHeading({ title, count, eyebrow }: { title: string; count?: number; eyebrow?: string }) {
  return (
    <div className="mb-6 flex flex-col gap-1 border-b border-rule pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <div className="label">{eyebrow}</div>}
        <h1 tabIndex={-1} className="text-2xl font-bold leading-tight tracking-tight outline-none md:text-3xl">{title}</h1>
      </div>
      {count !== undefined && (
        <span className="font-mono text-meta text-faint" aria-label={`${count} en total`}>
          {count} {count === 1 ? "título" : "títulos"}
        </span>
      )}
    </div>
  );
}
