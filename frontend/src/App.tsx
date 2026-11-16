import { Route, Routes } from "react-router-dom";
import { LinkButton } from "./components/Button";
import { Layout } from "./components/Layout";
import { PageHeading } from "./components/PageHeading";
import Downloads from "./pages/Downloads";
import Home from "./pages/Home";
import Movies from "./pages/Movies";
import Series from "./pages/Series";
import SeriesDetail from "./pages/SeriesDetail";
import Settings from "./pages/Settings";
import System from "./pages/System";
import Watch from "./pages/Watch";
import { usePageTitle } from "./lib/usePageTitle";

function NotFound() {
  usePageTitle("Página no encontrada");
  return (
    <>
      <PageHeading title="Página no encontrada" />
      <p className="mb-6">Esta dirección no existe en Nebula.</p>
      <LinkButton to="/peliculas">Ir a las películas</LinkButton>
    </>
  );
}

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="peliculas" element={<Movies />} />
        <Route path="series" element={<Series />} />
        <Route path="series/:id" element={<SeriesDetail />} />
        <Route path="ajustes" element={<Settings />} />
        <Route path="descargas" element={<Downloads />} />
        <Route path="sistema" element={<System />} />
        <Route path="*" element={<NotFound />} />
      </Route>
      <Route path="ver/:id" element={<Watch />} />
    </Routes>
  );
}
