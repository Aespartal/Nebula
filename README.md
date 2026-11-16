# Nebula

Servidor multimedia personal: biblioteca de películas y series en tu equipo, reproducción web desde cualquier sitio.

## Arranque rápido

```bash
npm install
# Backend (puerto 3000)
MOVIES_DIR=/ruta/peliculas SERIES_DIR=/ruta/series npm run dev:backend
# Frontend en desarrollo (puerto 5173, proxy a /api)
npm run dev:frontend
```

Producción en un solo puerto: `npm run build` y arranca el backend; si existe `frontend/dist` lo sirve él mismo.

También puedes añadir carpetas desde la propia app (Ajustes). Requisitos: Node 22+, `ffprobe` en el PATH (o `FFPROBE_PATH`).

Variables: `PORT`, `HOST` (por defecto `127.0.0.1` hasta tener autenticación), `DATA_DIR`, `MOVIES_DIR`, `SERIES_DIR`.

## Estructura

- `backend/`: Fastify + SQLite + ffprobe. Escaneo incremental, catálogo y streaming con Range.
- `frontend/`: React + Tailwind. Mobile-first, claro/oscuro según el sistema.
- `shared/`: tipos compartidos de la API.

## Diseño y accesibilidad

- Tipografía: Fraunces (títulos) y Atkinson Hyperlegible (texto, pensada para máxima legibilidad). Autoalojadas.
- Contrastes WCAG AA o superior en ambos temas; objetivos táctiles de al menos 48 px.
- Navegación por teclado, enlace "Saltar al contenido", foco visible, foco al título al cambiar de página.
- Respeta `prefers-color-scheme`, `prefers-reduced-motion` y el tamaño de texto del sistema.
- Reproductor con los controles nativos del navegador (accesibles y familiares en cada plataforma).
