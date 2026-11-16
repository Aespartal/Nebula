import { useId, useState, type FormEvent } from "react";
import type { Library, LibraryType, ScanStats } from "@nebula/shared";
import { Button } from "../components/Button";
import { AccountSection } from "../components/AccountSection";
import { MetadataSection } from "../components/MetadataSection";
import { PageHeading } from "../components/PageHeading";
import { UsersSection } from "../components/UsersSection";
import { useUser } from "../lib/auth";
import { ErrorBox, Loading } from "../components/States";
import { plural } from "../lib/format";
import { usePageTitle } from "../lib/usePageTitle";
import { postJson, useApi } from "../lib/useApi";

const TYPE_LABEL: Record<LibraryType, string> = { movies: "Películas", series: "Series" };

const ERRORS: Record<string, string> = {
  root_path_not_a_directory: "Esa carpeta no existe o Nebula no puede acceder a ella. Revisa la ruta.",
  library_already_exists: "Esa carpeta ya está añadida.",
  network: "No se pudo conectar con el servidor de Nebula.",
  scan_in_progress: "Ya se está buscando en esa carpeta. Espera un momento.",
};

function describeScan(all: ScanStats[]): string {
  const sum = (k: keyof ScanStats) => all.reduce((n, s) => n + s[k], 0);
  const parts: string[] = [];
  if (sum("added")) parts.push(`${plural(sum("added"), "archivo nuevo", "archivos nuevos")}`);
  if (sum("updated")) parts.push(`${plural(sum("updated"), "actualizado", "actualizados")}`);
  if (sum("removed")) parts.push(`${plural(sum("removed"), "eliminado", "eliminados")} (ya no estaban en la carpeta)`);
  if (sum("skipped")) parts.push(`${plural(sum("skipped"), "ignorado", "ignorados")} por tener un nombre que Nebula no entiende`);
  if (sum("failed")) parts.push(`${plural(sum("failed"), "no se pudo leer", "no se pudieron leer")}`);
  return parts.length ? `Listo: ${parts.join(", ")}.` : "Todo estaba al día, no hay cambios.";
}

function LibrariesSection() {
  const libs = useApi<Library[]>("/api/libraries");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<LibraryType>("movies");
  const [rootPath, setRootPath] = useState("");
  const ids = { name: useId(), type: useId(), path: useId(), hint: useId() };

  async function scanAll() {
    setBusy(true); setMessage(null);
    const r = await postJson<Record<string, ScanStats>>("/api/scan");
    setBusy(false);
    setMessage(r.ok ? { kind: "ok", text: describeScan(Object.values(r.data)) } : { kind: "error", text: ERRORS[r.code] ?? "No se pudo completar la búsqueda." });
  }

  async function addLibrary(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setMessage(null);
    const created = await postJson<Library>("/api/libraries", { name: name.trim(), type, rootPath: rootPath.trim() });
    if (!created.ok) {
      setBusy(false);
      setMessage({ kind: "error", text: ERRORS[created.code] ?? "No se pudo añadir la carpeta." });
      return;
    }
    const scan = await postJson<ScanStats>(`/api/libraries/${created.data.id}/scan`);
    setBusy(false);
    setName(""); setRootPath("");
    libs.reload();
    setMessage({ kind: "ok", text: `Carpeta añadida. ${scan.ok ? describeScan([scan.data]) : "No se pudo hacer la primera búsqueda; pulsa «Buscar cambios»."}` });
  }

  const field = "field";

  return (
    <>
      <section aria-labelledby="carpetas" className="mt-10 max-w-2xl border-t border-rule pt-8">
        <h2 id="carpetas" className="text-lg font-bold tracking-tight">Tus carpetas</h2>
        {libs.loading && <Loading />}
        {libs.error && <ErrorBox message={libs.error} onRetry={libs.reload} />}
        {libs.data && libs.data.length === 0 && <p className="mt-2 text-muted">Aún no has añadido ninguna.</p>}
        {libs.data && libs.data.length > 0 && (
          <ul className="mt-3">
            {libs.data.map((l) => (
              <li key={l.id} className="border-t border-rule py-3 last:border-b">
                <p className="font-bold">
                  {l.name}
                  {l.name.trim().toLowerCase() !== TYPE_LABEL[l.type].toLowerCase() && (
                    <span className="font-normal text-muted"> · {TYPE_LABEL[l.type]}</span>
                  )}
                </p>
                <p className="break-all text-muted">{l.rootPath}</p>
              </li>
            ))}
          </ul>
        )}
        <Button variant="secondary" className="mt-4 w-full sm:w-auto" onClick={scanAll} disabled={busy || !libs.data?.length}>
          {busy ? "Buscando…" : "Buscar cambios"}
        </Button>
        <p className="mt-2 text-muted">Úsalo cuando copies películas o capítulos nuevos a las carpetas.</p>
      </section>

      <section aria-labelledby="nueva" className="mt-10 max-w-2xl border-t border-rule pt-8">
        <h2 id="nueva" className="text-lg font-bold tracking-tight">Añadir una carpeta</h2>
        <form onSubmit={addLibrary} className="mt-4 space-y-5">
          <div>
            <label htmlFor={ids.name} className="mb-1 block text-meta font-bold text-soft">Nombre</label>
            <input id={ids.name} className={field} value={name} onChange={(e) => setName(e.target.value)} required autoComplete="off" />
          </div>
          <div>
            <label htmlFor={ids.type} className="mb-1 block text-meta font-bold text-soft">Qué contiene</label>
            <select id={ids.type} className={field} value={type} onChange={(e) => setType(e.target.value as LibraryType)}>
              <option value="movies">Películas</option>
              <option value="series">Series</option>
            </select>
          </div>
          <div>
            <label htmlFor={ids.path} className="mb-1 block text-meta font-bold text-soft">Ruta de la carpeta</label>
            <input id={ids.path} className={field} value={rootPath} onChange={(e) => setRootPath(e.target.value)}
              required autoComplete="off" spellCheck={false} aria-describedby={ids.hint} />
            <p id={ids.hint} className="mt-1 text-muted">
              La ruta completa en el equipo donde está instalado Nebula, por ejemplo <code>D:\Películas</code> o <code>/home/usuario/series</code>.
            </p>
          </div>
          <Button type="submit" disabled={busy} aria-busy={busy} className="w-full sm:w-auto">
            {busy ? "Añadiendo…" : "Añadir y buscar"}
          </Button>
        </form>
      </section>

      <div role={message?.kind === "error" ? "alert" : "status"} className="mt-6 max-w-2xl">
        {message && (
          <p className={`${message.kind === "error" ? "msg-error" : "msg-info"}`}>
            {message.text}
          </p>
        )}
      </div>
    </>
  );
}

export default function Settings() {
  usePageTitle("Ajustes");
  const user = useUser();
  return (
    <>
      <PageHeading title="Ajustes" />
      <AccountSection />
      {user.role === "admin" && (
        <>
          <UsersSection />
          <LibrariesSection />
          <MetadataSection />
        </>
      )}
    </>
  );
}
