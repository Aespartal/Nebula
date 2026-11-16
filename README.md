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

Variables: `PORT`, `HOST` (por defecto `127.0.0.1`; `0.0.0.0` para la red local), `DATA_DIR`, `MOVIES_DIR`, `SERIES_DIR`,
`FFMPEG_PATH`, `FFPROBE_PATH`, `HLS_DIR` (temporales de conversión), `MAX_TRANSCODES` (sesiones simultáneas, 3 por defecto),
`TRUST_PROXY=1` (cuando haya un proxy inverso delante).

## Cuentas y seguridad

- **Primer arranque**: al abrir Nebula se pide crear la cuenta de administrador. Solo funciona mientras no exista ningún usuario.
- **Cuentas**: el administrador crea más cuentas desde Ajustes. Cada una tiene su propio progreso («Seguir viendo», visto/no visto). Todas las cuentas ven todas las carpetas; añadir carpetas y gestionar cuentas es solo del administrador.
- **Contraseñas**: `scrypt` con sal propia (viene con Node, no hay que compilar nada). Mínimo 8 caracteres.
- **Sesiones**: cookie `HttpOnly` + `SameSite=Lax` (y `Secure` en HTTPS); en la base de datos solo se guarda el hash del token. Caducan a los 30 días sin uso, se revocan al cerrar sesión, al cambiar la contraseña y al borrar la cuenta. Como el vídeo va por el mismo origen, `<video>` y hls.js envían la cookie solos: no hacen falta URLs firmadas.
- **Protección**: toda la API (vídeo incluido) exige sesión salvo `/api/health` y el acceso; bloqueo temporal tras 5 intentos fallidos; las peticiones que cambian datos desde otro origen se rechazan (CSRF); no hay CORS.
- **Antes de abrirlo a Internet** hace falta HTTPS (fase 6): sin cifrado, la contraseña y la cookie viajan en claro.
- Si pierdes la contraseña del único administrador: borra la fila de `users` de `data/nebula.db` y vuelve a abrir Nebula para repetir el alta.

## Reproducción y conversión

El navegador informa de lo que sabe reproducir y el servidor decide:

- **Directa**: contenedor, vídeo y audio compatibles → se envía el archivo tal cual (con `Range`).
- **Convertida**: en otro caso FFmpeg genera HLS al vuelo (H.264 + AAC, hasta 1080p). La línea de tiempo es la del vídeo completo, así que se puede saltar a cualquier punto.
- Si el navegador dice poder y luego falla, la app cambia sola a conversión y retoma por donde iba.
- Rutas de conversión, por orden: GPU NVIDIA completa → decodificación en CPU + NVENC → CPU (x264). Si una no funciona en tu equipo, Nebula pasa a la siguiente sola.

**Diagnóstico:** `npm run doctor` comprueba FFmpeg, la tarjeta NVIDIA y prueba de verdad cada ruta de conversión.
Limitación actual: no hay *remux* (copiar el vídeo sin recodificar cuando solo falla el audio o el contenedor); siempre se recodifica.

## Estructura

- `backend/`: Fastify + SQLite + ffprobe + FFmpeg. Escaneo incremental, catálogo, streaming con Range y conversión HLS.
- `frontend/`: React + Tailwind. Mobile-first, claro/oscuro según el sistema.
- `shared/`: tipos compartidos de la API.

## Diseño y accesibilidad

- Tipografía: Fraunces (títulos) y Atkinson Hyperlegible (texto, pensada para máxima legibilidad). Autoalojadas.
- Contrastes WCAG AA o superior en ambos temas; objetivos táctiles de al menos 48 px.
- Navegación por teclado, enlace "Saltar al contenido", foco visible, foco al título al cambiar de página.
- Respeta `prefers-color-scheme`, `prefers-reduced-motion` y el tamaño de texto del sistema.
- Reproductor con los controles nativos del navegador (accesibles y familiares en cada plataforma), con selector de audio.
