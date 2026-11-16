import { useEffect, useRef } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { Icon, type IconName } from "./Icon";

const ITEMS: { to: string; label: string; icon: IconName }[] = [
  { to: "/peliculas", label: "Películas", icon: "film" },
  { to: "/series", label: "Series", icon: "tv" },
  { to: "/ajustes", label: "Ajustes", icon: "sliders" },
];

export function Wordmark() {
  return (
    <Link to="/" className="font-display text-3xl font-semibold tracking-tight">
      Nebula<span className="text-accent">.</span>
    </Link>
  );
}

export function Layout() {
  const { pathname } = useLocation();
  const firstRender = useRef(true);

  // Al cambiar de página, el foco va al título: lectores de pantalla y teclado se sitúan solos.
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    window.scrollTo(0, 0);
    // Si la página aún no tiene título (carga datos), ella misma moverá el foco al tenerlo.
    document.querySelector<HTMLElement>("main h1")?.focus({ preventScroll: true });
  }, [pathname]);

  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#contenido"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:bg-accent focus:px-4 focus:py-3 focus:font-bold focus:text-on-accent">
        Saltar al contenido
      </a>

      <header className="border-b border-rule">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Wordmark />
          <nav aria-label="Principal" className="hidden md:block">
            <ul className="flex gap-2">
              {ITEMS.map((i) => (
                <li key={i.to}>
                  <NavLink to={i.to}
                    className={({ isActive }) =>
                      `flex min-h-12 items-center gap-2 border-b-4 px-4 font-bold ${isActive ? "border-accent text-accent" : "border-transparent hover:border-line"}`}>
                    <Icon name={i.icon} className="size-5" />
                    {i.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>

      <main id="contenido" tabIndex={-1}
        className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-6 outline-none md:pb-12">
        <Outlet />
      </main>

      <nav aria-label="Principal"
        className="fixed inset-x-0 bottom-0 z-10 border-t border-rule bg-bg pb-[env(safe-area-inset-bottom)] md:hidden">
        <ul className="grid grid-cols-3">
          {ITEMS.map((i) => (
            <li key={i.to}>
              <NavLink to={i.to}
                className={({ isActive }) =>
                  `flex min-h-[4.5rem] flex-col items-center justify-center gap-1 border-t-4 font-bold ${isActive ? "border-accent text-accent" : "border-transparent text-muted"}`}>
                <Icon name={i.icon} />
                {i.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
