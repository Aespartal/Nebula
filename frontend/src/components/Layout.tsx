import { useEffect, useRef } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { GlobalSearch } from "./GlobalSearch";
import { Icon, type IconName } from "./Icon";

const ITEMS: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: "/", label: "Inicio", icon: "home", end: true },
  { to: "/peliculas", label: "Películas", icon: "film" },
  { to: "/series", label: "Series", icon: "tv" },
  { to: "/ajustes", label: "Ajustes", icon: "sliders" },
];
const DOWNLOADS: (typeof ITEMS)[number] = { to: "/descargas", label: "Descargas", icon: "download" };
const SYSTEM: (typeof ITEMS)[number] = { to: "/sistema", label: "Sistema", icon: "cpu" };
const COLS: Record<number, string> = { 4: "grid-cols-4", 5: "grid-cols-5", 6: "grid-cols-6" };

export function Wordmark() {
  return (
    <Link to="/" className="text-sm font-bold tracking-wordmark text-text">
      NEBULA
    </Link>
  );
}

export function Layout() {
  const { pathname } = useLocation();
  const { user, logout } = useAuth();
  const firstRender = useRef(true);

  // Al cambiar de página, el foco va al título: lectores de pantalla y teclado se sitúan solos.
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    window.scrollTo(0, 0);
    // Si la página aún no tiene título (carga datos), ella misma moverá el foco al tenerlo.
    document.querySelector<HTMLElement>("main h1")?.focus({ preventScroll: true });
  }, [pathname]);

  const items = user?.role === "admin" ? [...ITEMS, DOWNLOADS, SYSTEM] : ITEMS;
  const initials = (user?.username ?? "").slice(0, 2).toUpperCase();

  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#contenido"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-ctl focus:bg-accent focus:px-4 focus:py-3 focus:font-bold focus:text-on-accent">
        Saltar al contenido
      </a>

      <header className="sticky top-0 z-30 h-[var(--topbar-h)] border-b border-rule bg-bg/95 backdrop-blur-sm">
        <div className="mx-auto flex h-full max-w-page items-center justify-between gap-4 px-4 sm:px-8">
          <div className="flex items-center gap-7">
            <Wordmark />
            <nav aria-label="Principal" className="hidden md:block">
              <ul className="flex items-center gap-1">
                {items.map((i) => (
                  <li key={i.to}>
                    <NavLink to={i.to} end={i.end}
                      className={({ isActive }) =>
                        `flex min-h-[var(--control-h)] items-center gap-2 rounded-ctl px-3 text-meta font-bold transition-colors ${isActive ? "bg-raised text-text" : "text-muted hover:text-text"}`}>
                      {i.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <GlobalSearch />
            <span className="flex items-center gap-2 text-meta text-muted" title="Sesión iniciada como">
              <span aria-hidden="true" className="flex size-7 items-center justify-center rounded-ctl border border-rule bg-raised font-mono text-label font-bold text-text">{initials}</span>
              <span className="hidden max-w-40 truncate text-soft sm:inline">{user?.username}</span>
            </span>
            <button type="button" onClick={logout}
              className="min-h-[var(--control-h)] rounded-ctl border border-line px-3 text-meta font-bold hover:border-muted hover:bg-raised">
              Salir
            </button>
          </div>
        </div>
      </header>

      <main id="contenido" tabIndex={-1}
        className="mx-auto w-full max-w-page flex-1 px-4 pb-28 pt-6 outline-none sm:px-8 md:pb-12">
        <Outlet />
      </main>

      <nav aria-label="Principal"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-rule bg-bg pb-[env(safe-area-inset-bottom)] md:hidden">
        <ul className={`grid ${COLS[items.length]}`}>
          {items.map((i) => (
            <li key={i.to}>
              <NavLink to={i.to} end={i.end}
                className={({ isActive }) =>
                  `flex min-h-16 flex-col items-center justify-center gap-1 border-t-2 text-label font-bold ${isActive ? "border-accent bg-surface text-text" : "border-transparent text-muted"}`}>
                <Icon name={i.icon} className="size-5" />
                {i.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
