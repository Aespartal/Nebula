import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { DownloadItem, DownloadKind, DownloadsStatus, SearchHit } from "@nebula/shared";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { PageHeading } from "../components/PageHeading";
import { Empty, ErrorBox, Loading } from "../components/States";
import { useUser } from "../lib/auth";
import { formatBytes, formatEta, formatSpeed } from "../lib/format";
import { sendJson, useApi } from "../lib/useApi";
import { usePageTitle } from "../lib/usePageTitle";

const KIND_LABEL: Record<DownloadKind, string> = { movies: "Película", series: "Serie" };

/** Lo que se ve de cada estado: siempre con palabras, nunca solo con color. */
function stateLabel(d: DownloadItem): { text: string; tone: "ok" | "warn" | "danger" | "muted" } {
  if (d.state === "missing") return { text: "Ya no está en qBittorrent", tone: "danger" };
  if (d.state === "error") return { text: "Error en qBittorrent", tone: "danger" };
  if (d.state === "moving") return { text: "Moviendo a la biblioteca", tone: "warn" };
  if (d.state === "checking") return { text: "Verificando archivos", tone: "warn" };
  if (d.done) {
    const where = d.completedAt ? "En la biblioteca" : "Completada";
    if (d.state === "paused") return { text: `${where} · compartición parada`, tone: "ok" };
    return { text: `${where} · compartiendo`, tone: "ok" };
  }
  if (d.state === "paused") return { text: "Pausada", tone: "muted" };
  if (d.state === "queued") return { text: "En cola", tone: "muted" };
  if (d.state === "stalled") return { text: "Sin conexiones: esperando pares", tone: "warn" };
  if (d.state === "downloading") return { text: "Descargando", tone: "warn" };
  return { text: "Estado desconocido", tone: "muted" };
}
const TONE = { ok: "text-ok", warn: "text-warn", danger: "text-danger", muted: "text-muted" } as const;

const ERRORS: Record<string, string> = {
  invalid_magnet: "Eso no es un enlace magnet válido. Debe empezar por «magnet:?xt=urn:btih:». No se aceptan direcciones web.",
  invalid_torrent: "El archivo no es un .torrent válido.",
  torrent_too_large: "El archivo .torrent pesa más de 1 MB.",
  already_added: "Esa descarga ya está añadida.",
  no_library: "No hay ninguna carpeta de ese tipo. Añádela primero en Ajustes.",
  client_unreachable: "Nebula no puede hablar con qBittorrent ahora mismo. ¿Está abierto?",
  not_configured: "Las descargas no están configuradas: faltan TORRENT_USER y TORRENT_PASS en el archivo .env.",
  magnet_or_torrent: "Pega un enlace magnet o elige un archivo .torrent.",
  both: "Usa solo una opción: o el enlace magnet, o el archivo .torrent.",
  network: "No se pudo conectar con el servidor de Nebula.",
  search_not_configured: "El buscador no está configurado: falta PROWLARR_API_KEY en el archivo .env.",
  search_auth: "Prowlarr rechazó la API key. Revisa PROWLARR_API_KEY en el archivo .env.",
  search_unreachable: "Nebula no puede hablar con Prowlarr ahora mismo. ¿Está abierto y la dirección es correcta?",
  not_found: "Ese resultado ya no está disponible. Vuelve a buscar.",
  bad_source: "Ese resultado no se puede descargar de forma segura.",
  fetch_failed: "Prowlarr no pudo darle a Nebula el archivo de ese resultado. Prueba con otro.",
};

function Bar({ value, label }: { value: number; label: string }) {
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}
      className="h-1.5 w-full overflow-hidden rounded-bar bg-track">
      <div className="h-full bg-accent" style={{ width: `${Math.min(100, Math.round(value * 100))}%` }} />
    </div>
  );
}

/** Estado de la conexión con qBittorrent: siempre visible, y si falla, con lo que hay que hacer. */
function Connection({ status, loading, error, reload }: { status: DownloadsStatus | null; loading: boolean; error: string | null; reload: () => void }) {
  if (loading && !status) return <Loading label="Comprobando qBittorrent…" />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!status) return null;

  if (!status.configured) {
    return (
      <div role="status" className="panel mb-8 space-y-2">
        <p className="label text-warn!">Sin configurar</p>
        <p className="font-bold">Falta conectar Nebula con qBittorrent</p>
        <ol className="list-decimal space-y-1 pl-5 text-muted">
          <li>En qBittorrent: <em>Herramientas → Opciones → Interfaz web</em>. Actívala y pon un usuario y una contraseña.</li>
          <li>En el archivo <code>.env</code> de Nebula añade <code>TORRENT_USER</code>, <code>TORRENT_PASS</code> y, si no usas el puerto 8080, <code>TORRENT_URL</code>.</li>
          <li>Reinicia Nebula. Puedes comprobarlo con <code>npm run torrents:doctor</code>.</li>
        </ol>
      </div>
    );
  }

  if (!status.connected) {
    const help =
      status.error === "auth" ? "qBittorrent rechazó el usuario o la contraseña. Revisa TORRENT_USER y TORRENT_PASS en el archivo .env."
        : status.error === "unsupported" ? "qBittorrent respondió algo que Nebula no entiende. Comprueba TORRENT_URL en el archivo .env."
          : "Nebula no consigue hablar con qBittorrent. Comprueba que está abierto, que la interfaz web está activada y que TORRENT_URL (dirección y puerto) es correcto.";
    return (
      <div role="alert" className="mb-8 rounded-ctl border border-danger bg-surface p-5">
        <p className="label text-danger!">Sin conexión</p>
        <p className="mt-1 font-bold">No hay conexión con qBittorrent</p>
        <p className="mt-1 text-muted">{help}</p>
        {status.message && <p className="mt-2 break-words font-mono text-label text-faint">{status.message}</p>}
        <Button variant="secondary" className="mt-4" onClick={reload}>Reintentar</Button>
      </div>
    );
  }

  const low = status.freeBytes !== null && status.freeBytes < status.minFreeBytes;
  return (
    <div className="mb-8 space-y-2">
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-ctl border border-rule bg-surface px-3 py-2 font-mono text-meta text-soft tabular">
        <span className="inline-flex items-center gap-1.5 text-ok"><span aria-hidden="true" className="size-1.5 rounded-full bg-ok" />Conectado</span>
        <span>qBittorrent {status.version}</span>
        {status.freeBytes !== null && <span>{formatBytes(status.freeBytes)} libres</span>}
      </p>
      {low && (
        <p role="alert" className="msg-error">
          Queda poco espacio en el disco de descargas. Nebula no aceptará descargas nuevas hasta que haya al menos {formatBytes(status.minFreeBytes)} libres.
        </p>
      )}
    </div>
  );
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error);
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.readAsDataURL(file);
  });
}

function AddForm({ disabled, onAdded }: { disabled: boolean; onAdded: (name: string) => void }) {
  const ids = { magnet: useId(), file: useId(), kind: useId(), hint: useId() };
  const [magnet, setMagnet] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<DownloadKind>("movies");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (magnet.trim() && file) { setError(ERRORS.both); return; }
    if (!magnet.trim() && !file) { setError(ERRORS.magnet_or_torrent); return; }
    setBusy(true);
    const body = file ? { torrentBase64: await readBase64(file), kind } : { magnet: magnet.trim(), kind };
    const r = await sendJson<{ name: string }>("POST", "/api/downloads", body);
    setBusy(false);
    if (!r.ok) {
      if (r.code === "not_enough_space") {
        const b = r.body as { freeBytes?: number; neededBytes?: number } | undefined;
        setError(`No hay espacio suficiente: quedan ${formatBytes(b?.freeBytes ?? 0)} libres y hacen falta ${formatBytes(b?.neededBytes ?? 0)}.`);
      } else setError(ERRORS[r.code] ?? "No se pudo añadir la descarga.");
      return;
    }
    setMagnet(""); setFile(null);
    if (fileRef.current) fileRef.current.value = "";
    onAdded(r.data.name);
  }

  return (
    <section aria-labelledby="nueva-descarga" className="mb-10 max-w-2xl">
      <div className="mb-4 border-b border-rule pb-4">
        <div className="label">Torrent</div>
        <h2 id="nueva-descarga" className="text-lg font-bold tracking-tight">Añadir una descarga</h2>
      </div>
      <form onSubmit={submit} className="space-y-5" noValidate>
        <div>
          <label htmlFor={ids.magnet} className="mb-1 block text-meta font-bold text-soft">Enlace magnet</label>
          <input id={ids.magnet} className="field font-mono" value={magnet} onChange={(e) => setMagnet(e.target.value)}
            placeholder="magnet:?xt=urn:btih:…" autoComplete="off" spellCheck={false} disabled={disabled} aria-describedby={ids.hint} />
        </div>
        <div>
          <label htmlFor={ids.file} className="mb-1 block text-meta font-bold text-soft">O un archivo .torrent</label>
          <input id={ids.file} ref={fileRef} type="file" accept=".torrent,application/x-bittorrent" className="field"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)} disabled={disabled} aria-describedby={ids.hint} />
          <p id={ids.hint} className="mt-1 text-muted">Solo enlaces magnet y archivos .torrent de hasta 1 MB. No se aceptan direcciones web.</p>
        </div>
        <div>
          <label htmlFor={ids.kind} className="mb-1 block text-meta font-bold text-soft">Qué es</label>
          <select id={ids.kind} className="field" value={kind} onChange={(e) => setKind(e.target.value as DownloadKind)} disabled={disabled}>
            <option value="movies">Película</option>
            <option value="series">Serie</option>
          </select>
        </div>
        <Button type="submit" disabled={disabled || busy} aria-busy={busy} className="w-full sm:w-auto">
          {busy ? "Añadiendo…" : "Añadir descarga"}
        </Button>
        <div role="alert">{error && <p className="msg-error">{error}</p>}</div>
      </form>
    </section>
  );
}

function SearchPanel({ disabled, onAdded }: { disabled: boolean; onAdded: (name: string) => void }) {
  const ids = { q: useId(), kind: useId() };
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<DownloadKind>("movies");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [asked, setAsked] = useState("");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [rowError, setRowError] = useState<{ id: string; text: string } | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const results = useRef<HTMLHeadingElement>(null);

  async function search(e: FormEvent) {
    e.preventDefault();
    const term = q.trim();
    setError(""); setRowError(null);
    if (term.length < 2) { setError("Escribe al menos 2 letras."); return; }
    setBusy(true);
    const r = await sendJson<SearchHit[]>("GET", `/api/downloads/search?q=${encodeURIComponent(term)}&kind=${kind}`);
    setBusy(false);
    if (!r.ok) { setHits(null); setError(ERRORS[r.code] ?? "No se pudo buscar."); return; }
    setHits(r.data); setAsked(term); setFocusTick((n) => n + 1);
  }
  // Tras buscar, el foco pasa al encabezado de resultados para quien usa lector de pantalla o teclado.
  useEffect(() => { if (focusTick > 0) results.current?.focus(); }, [focusTick]);

  async function add(h: SearchHit) {
    setRowError(null); setAdding(h.id);
    const r = await sendJson<{ name: string }>("POST", "/api/downloads/search/add", { id: h.id, kind });
    setAdding(null);
    if (!r.ok) {
      if (r.code === "not_enough_space") {
        const b = r.body as { freeBytes?: number; neededBytes?: number } | undefined;
        setRowError({ id: h.id, text: `No hay espacio suficiente: quedan ${formatBytes(b?.freeBytes ?? 0)} libres y hacen falta ${formatBytes(b?.neededBytes ?? 0)}.` });
      } else setRowError({ id: h.id, text: ERRORS[r.code] ?? "No se pudo añadir la descarga." });
      return;
    }
    setHits((cur) => cur && cur.map((x) => (x.id === h.id ? { ...x, added: true } : x)));
    onAdded(h.title);
  }

  return (
    <section aria-labelledby="buscar-torrents" className="mb-10 max-w-3xl">
      <div className="mb-4 border-b border-rule pb-4">
        <div className="label">Prowlarr</div>
        <h2 id="buscar-torrents" className="text-lg font-bold tracking-tight">Buscar torrents</h2>
      </div>
      <form onSubmit={search} className="flex flex-col gap-3 sm:flex-row sm:items-end" noValidate role="search" aria-label="Buscar torrents">
        <div className="flex-1">
          <label htmlFor={ids.q} className="mb-1 block text-meta font-bold text-soft">Título</label>
          <input id={ids.q} type="search" className="field" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" disabled={disabled} maxLength={120} />
        </div>
        <div>
          <label htmlFor={ids.kind} className="mb-1 block text-meta font-bold text-soft">Qué es</label>
          <select id={ids.kind} className="field" value={kind} onChange={(e) => setKind(e.target.value as DownloadKind)} disabled={disabled}>
            <option value="movies">Película</option>
            <option value="series">Serie</option>
          </select>
        </div>
        <Button type="submit" disabled={disabled || busy} aria-busy={busy} className="w-full sm:w-auto">{busy ? "Buscando…" : "Buscar"}</Button>
      </form>
      <div role="alert">{error && <p className="msg-error mt-3">{error}</p>}</div>
      <p role="status" className="sr-only">{busy ? "Buscando…" : hits ? `${hits.length} resultados para ${asked}` : ""}</p>

      {hits && (
        <div className="mt-6">
          <h3 ref={results} tabIndex={-1} className="mb-3 text-meta font-bold text-soft outline-none">
            {hits.length ? `${hits.length} resultados para «${asked}»` : `Sin resultados para «${asked}»`}
          </h3>
          {!hits.length && <p className="text-muted">Prueba con otro título, o con el nombre original. Los resultados dependen de los indexadores que tengas en Prowlarr.</p>}
          <ul className="divide-y divide-rule border-y border-rule">
            {hits.map((h) => (
              <li key={h.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <div className="min-w-0">
                  <p className="break-words font-bold">{h.title}</p>
                  <p className="text-meta text-muted">
                    {formatBytes(h.sizeBytes)} · <span className={h.seeders === 0 ? "text-warn" : "text-ok"}>{h.seeders} {h.seeders === 1 ? "semilla" : "semillas"}</span>
                    {h.indexer && <> · {h.indexer}</>}
                    {h.publishedAt && <> · {new Date(h.publishedAt).toLocaleDateString("es-ES")}</>}
                  </p>
                  {rowError?.id === h.id && <p role="alert" className="msg-error mt-1">{rowError.text}</p>}
                </div>
                {h.added
                  ? <span className="text-meta font-bold text-ok">Ya añadida</span>
                  : <Button variant="secondary" className="w-full shrink-0 sm:w-auto" disabled={disabled || adding !== null} aria-busy={adding === h.id}
                      aria-label={`Descargar ${h.title}`} onClick={() => add(h)}>
                      <Icon name="download" className="size-5" /> {adding === h.id ? "Añadiendo…" : "Descargar"}
                    </Button>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Row({ d, busy, onAct }: { d: DownloadItem; busy: boolean; onAct: (d: DownloadItem, act: "pause" | "resume" | "remove" | "purge") => void }) {
  const [confirming, setConfirming] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const s = stateLabel(d);
  const paused = d.state === "paused";
  const pct = Math.round(d.progress * 100);

  useEffect(() => { if (confirming) panel.current?.focus(); }, [confirming]);
  const cancel = () => { setConfirming(false); trigger.current?.focus(); };

  return (
    <li className="grid gap-3 p-4 sm:grid-cols-[1fr_15rem_auto] sm:items-center">
      <div className="min-w-0">
        <p className="truncate font-bold" title={d.name}>{d.name}</p>
        <p className="mt-0.5 font-mono text-label text-faint">
          {KIND_LABEL[d.kind].toUpperCase()}{d.addedBy ? ` · añadida por ${d.addedBy}` : ""}
        </p>
        <p className={`mt-1 font-mono text-label ${TONE[s.tone]}`}>{s.text}</p>
      </div>

      <div className="space-y-1.5 font-mono text-label text-muted tabular">
        <Bar value={d.progress} label={`Progreso de ${d.name}`} />
        <div className="flex justify-between gap-2">
          <span>{pct} % · {formatBytes(d.downloadedBytes)} / {formatBytes(d.sizeBytes)}</span>
          {d.state === "downloading" && <span>{formatSpeed(d.speedDown)} · {formatEta(d.etaS)}</span>}
        </div>
      </div>

      <div className="flex gap-2">
        {d.state !== "missing" && (
          <Button variant="secondary" disabled={busy} onClick={() => onAct(d, paused ? "resume" : "pause")}
            aria-label={`${paused ? "Reanudar" : "Pausar"} ${d.name}`}>
            {paused ? "Reanudar" : "Pausar"}
          </Button>
        )}
        <Button ref={trigger} id={`quitar-${d.hash}`} variant="secondary" disabled={busy} onClick={() => setConfirming(true)}
          aria-expanded={confirming} aria-label={`Quitar ${d.name}`}>
          Quitar
        </Button>
      </div>

      {confirming && (
        <div ref={panel} tabIndex={-1} role="group" aria-label={`Quitar ${d.name}`}
          className="space-y-3 rounded-ctl border border-line bg-raised p-4 outline-none sm:col-span-3">
          <p className="font-bold">¿Qué quieres hacer con «{d.name}»?</p>
          <p className="text-muted">
            <strong className="text-soft">Quitar de la lista</strong> deja el vídeo donde está y la biblioteca no cambia.{" "}
            <strong className="text-soft">Borrar torrent y archivos</strong> elimina también el vídeo del disco, desaparecerá de la biblioteca y dejará de compartirse. No se puede deshacer.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="secondary" disabled={busy} onClick={() => { setConfirming(false); onAct(d, "remove"); }}>Quitar de la lista</Button>
            <Button variant="secondary" disabled={busy} className="border-danger! text-danger!" onClick={() => { setConfirming(false); onAct(d, "purge"); }}>
              Borrar torrent y archivos
            </Button>
            <Button variant="secondary" onClick={cancel}>Cancelar</Button>
          </div>
        </div>
      )}
    </li>
  );
}

function List({ configured, connected, onNote }: { configured: boolean; connected: boolean; onNote: (m: string) => void }) {
  const { data, error, loading, reload } = useApi<DownloadItem[]>(configured ? "/api/downloads" : null);
  const [busy, setBusy] = useState(false);
  const known = useRef(new Map<string, number | null>());

  // Se actualiza solo mientras la página está a la vista.
  useEffect(() => {
    if (!configured) return;
    const t = setInterval(() => { if (!document.hidden) reload(); }, 3000);
    return () => clearInterval(t);
  }, [configured, reload]);

  // Aviso accesible cuando algo termina mientras se mira la página.
  useEffect(() => {
    if (!data) return;
    for (const d of data) {
      if (known.current.get(d.hash) === null && d.completedAt) onNote(`«${d.name}» ha terminado y está en la biblioteca.`);
      known.current.set(d.hash, d.completedAt);
    }
  }, [data, onNote]);

  async function act(d: DownloadItem, what: "pause" | "resume" | "remove" | "purge") {
    setBusy(true);
    const r = what === "remove" ? await sendJson("DELETE", `/api/downloads/${d.hash}?files=0`)
      : what === "purge" ? await sendJson("DELETE", `/api/downloads/${d.hash}?files=1`)
        : await sendJson("POST", `/api/downloads/${d.hash}/${what}`, {});
    setBusy(false);
    const done = { pause: "pausada", resume: "reanudada", remove: "quitada de la lista", purge: "borrada con sus archivos" }[what];
    onNote(r.ok ? `«${d.name}» ${done}.` : (ERRORS[r.code] ?? "No se pudo completar la acción."));
    reload();
  }

  return (
    <section aria-labelledby="lista" aria-busy={loading && !data}>
      <div className="mb-4 border-b border-rule pb-4">
        <div className="label">En curso y terminadas</div>
        <h2 id="lista" className="text-lg font-bold tracking-tight">Descargas</h2>
      </div>
      {!configured && <p className="text-muted">Cuando conectes qBittorrent, aquí verás tus descargas.</p>}
      {configured && loading && !data && <Loading />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && data.length === 0 && (
        <Empty title="Todavía no has añadido ninguna descarga">
          {connected ? "Pega un enlace magnet o sube un archivo .torrent arriba. Al terminar, el vídeo aparece en tu biblioteca." : "Cuando se restablezca la conexión podrás añadirlas."}
        </Empty>
      )}
      {data && data.length > 0 && (
        <ul className="divide-y divide-rule rounded-ctl border border-rule bg-surface">
          {data.map((d) => <Row key={d.hash} d={d} busy={busy} onAct={act} />)}
        </ul>
      )}
    </section>
  );
}

export default function Downloads() {
  usePageTitle("Descargas");
  const user = useUser();
  const isAdmin = user.role === "admin";
  const status = useApi<DownloadsStatus>(isAdmin ? "/api/downloads/status" : null);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!isAdmin) return;
    const t = setInterval(() => { if (!document.hidden) status.reload(); }, 10_000);
    return () => clearInterval(t);
  }, [isAdmin, status.reload]);

  if (!isAdmin) {
    return (
      <>
        <PageHeading title="Descargas" />
        <p className="max-w-prose text-muted">Esta página es solo para administradores.</p>
      </>
    );
  }

  return (
    <>
      <PageHeading title="Descargas" eyebrow="Torrents" />
      <Connection status={status.data} loading={status.loading} error={status.error} reload={status.reload} />
      <p role="status" className="sr-only">{note}</p>
      {note && <p aria-hidden="true" className="msg-info mb-6 max-w-2xl">{note}</p>}
      {status.data?.searchConfigured
        ? <SearchPanel disabled={!status.data?.connected} onAdded={(name) => { setNote(`Añadida «${name}».`); status.reload(); }} />
        : status.data?.configured && <p className="mb-10 max-w-2xl text-muted">Para buscar torrents desde aquí, instala Prowlarr y pon <code className="font-mono">PROWLARR_API_KEY</code> en el archivo <code className="font-mono">.env</code> (la guía está en el README).</p>}
      <AddForm disabled={!status.data?.connected} onAdded={(name) => { setNote(`Añadida «${name}».`); status.reload(); }} />
      <List configured={!!status.data?.configured} connected={!!status.data?.connected} onNote={setNote} />
    </>
  );
}
