export function PageHeading({ title, count }: { title: string; count?: number }) {
  return (
    <div className="mb-6 flex items-baseline gap-3">
      <h1 tabIndex={-1} className="font-display text-4xl font-semibold leading-none tracking-tight outline-none md:text-5xl">
        {title}
      </h1>
      {count !== undefined && (
        <span className="text-lg font-bold text-muted" aria-label={`${count} en total`}>{count}</span>
      )}
    </div>
  );
}
