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
`TRUST_PROXY=1` (cuando haya un proxy inverso delante), `TLS_CERT`/`TLS_KEY`, `WATCH`, `WATCH_DEBOUNCE_MS`, `SCAN_INTERVAL_MINUTES`.

## Cuentas y seguridad

- **Primer arranque**: al abrir Nebula se pide crear la cuenta de administrador. Solo funciona mientras no exista ningún usuario.
- **Cuentas**: el administrador crea más cuentas desde Ajustes. Cada una tiene su propio progreso («Seguir viendo», visto/no visto). Todas las cuentas ven todas las carpetas; añadir carpetas y gestionar cuentas es solo del administrador.
- **Contraseñas**: `scrypt` con sal propia (viene con Node, no hay que compilar nada). Mínimo 8 caracteres.
- **Sesiones**: cookie `HttpOnly` + `SameSite=Lax` (y `Secure` en HTTPS); en la base de datos solo se guarda el hash del token. Caducan a los 30 días sin uso, se revocan al cerrar sesión, al cambiar la contraseña y al borrar la cuenta. Como el vídeo va por el mismo origen, `<video>` y hls.js envían la cookie solos: no hacen falta URLs firmadas.
- **Protección**: toda la API (vídeo incluido) exige sesión salvo `/api/health` y el acceso; bloqueo temporal tras 5 intentos fallidos; las peticiones que cambian datos desde otro origen se rechazan (CSRF); no hay CORS.
- **Antes de abrirlo a Internet** hace falta HTTPS (ver «Publicar en Internet»): sin cifrado, la contraseña y la cookie viajan en claro. Si escuchas en la red sin HTTPS ni proxy, Nebula lo avisa en el registro.
- **Cabeceras**: política de contenido estricta (CSP), `nosniff`, sin incrustación en otras webs (`frame-ancestors 'none'`), `Referrer-Policy: no-referrer` y HSTS cuando la conexión es HTTPS.
- Si pierdes la contraseña del único administrador: borra la fila de `users` de `data/nebula.db` y vuelve a abrir Nebula para repetir el alta.

## Reproducción y conversión

El navegador informa de lo que sabe reproducir y el servidor decide:

- **Directa**: contenedor, vídeo y audio compatibles → se envía el archivo tal cual (con `Range`).
- **Convertida**: en otro caso FFmpeg genera HLS al vuelo (H.264 + AAC, hasta 1080p). La línea de tiempo es la del vídeo completo, así que se puede saltar a cualquier punto.
- Si el navegador dice poder y luego falla, la app cambia sola a conversión y retoma por donde iba.
- Rutas de conversión, por orden: GPU NVIDIA completa → decodificación en CPU + NVENC → CPU (x264). Si una no funciona en tu equipo, Nebula pasa a la siguiente sola.

**Diagnóstico:** `npm run doctor` comprueba FFmpeg, la tarjeta NVIDIA y prueba de verdad cada ruta de conversión.
Limitación actual: no hay *remux* (copiar el vídeo sin recodificar cuando solo falla el audio o el contenedor); siempre se recodifica.

## Sistema (administradores)

La pestaña **Sistema** muestra las conversiones de FFmpeg en curso (con qué ruta, GPU o CPU, y hasta dónde va cada una; se pueden detener) y el almacenamiento de cada carpeta: vídeo que ocupa, uso del disco y espacio libre.

## Descargas (en preparación)

Nebula controlará un qBittorrent instalado en el mismo equipo (plan en [`docs/plan-descargas.md`](docs/plan-descargas.md)).
De momento solo está la comprobación de la conexión:

1. En qBittorrent: *Herramientas → Opciones → Interfaz web*, activa la interfaz, deja la dirección en `127.0.0.1` y pon usuario y contraseña.
2. En `.env`: `TORRENT_URL` (por defecto `http://127.0.0.1:8080`), `TORRENT_USER` y `TORRENT_PASS`.
3. Recomendado en qBittorrent (*Opciones → Descargas*): carpeta de descargas completas, otra para las descargas en curso («Mantener los torrents incompletos en») y modo de gestión de torrents **Automático**. En *Opciones → BitTorrent → Límites de compartición*: ratio 1,0 y 1440 min, y «Parar torrents» al llegar. En un disco mecánico conviene limitar la velocidad de bajada (*Opciones → Velocidad*).
4. Ejecuta `npm run torrents:doctor`: comprueba la conexión, lee las carpetas y la configuración de siembra, y prueba a crear y borrar una categoría temporal.

## Subtítulos y audio

- Subtítulos de texto (SRT, ASS/SSA, mov_text, WebVTT), incrustados o en archivos externos junto al vídeo, se convierten a WebVTT al vuelo y se guardan en caché. Los de imagen (PGS, DVD) no se pueden mostrar en el navegador y aparecen desactivados.
- En el reproductor eliges subtítulo y pista de audio; Nebula recuerda tu idioma preferido en ese navegador.

## Carátulas y sinopsis (TMDB)

Opcional. Con una clave gratuita de [TMDB](https://www.themoviedb.org/settings/api), Nebula añade carátulas y sinopsis.

- `TMDB_API_KEY`: clave de API (v3) o token de acceso de lectura (v4). En Windows (cmd): `set TMDB_API_KEY=tu_clave`.
- `TMDB_LANGUAGE`: idioma de los datos, por defecto `es-ES`.
- A TMDB solo se envían título y año. Las carátulas se descargan una vez y se sirven desde Nebula.
- Estado y búsqueda manual: Ajustes → «Carátulas y sinopsis» (solo administradores).

This product uses the TMDB API but is not endorsed or certified by TMDB.

## Configuración con `.env`

Copia `.env.example` a `.env` (junto a `package.json`) y arranca con `npm start` (compila la web y lanza el servidor).
Así no hace falta `set` en cada sesión. `npm run dev:backend` también lo lee.

## Carpetas vigiladas

Nebula escanea sola cuando copias, cambias o borras vídeos y subtítulos: espera 10 s de calma tras el último cambio (para no leer
una copia a medias) y hace un escaneo incremental. `WATCH=0` lo desactiva; `WATCH_DEBOUNCE_MS` ajusta la espera.
En carpetas de red (SMB/NFS) el sistema no avisa de los cambios: usa `SCAN_INTERVAL_MINUTES=30` para un escaneo periódico.

## Publicar en Internet

Elige una opción; en las dos, **no abras el puerto de Nebula directamente**.

1. **Proxy inverso con HTTPS automático (recomendado):** [Caddy](https://caddyserver.com) obtiene y renueva el certificado solo.
   Usa `deploy/Caddyfile`, arranca Nebula con `HOST=127.0.0.1` y `TRUST_PROXY=1`, y abre en el router solo los puertos 80 y 443 hacia Caddy.
2. **HTTPS directo:** `TLS_CERT` y `TLS_KEY` (PEM). Para la red local sirve [mkcert](https://github.com/FiloSottile/mkcert); un certificado
   autofirmado funciona, pero cada navegador mostrará un aviso.

Antes de exponerlo: contraseñas largas (mínimo 8, mejor una frase), solo las cuentas necesarias, y actualiza Node y FFmpeg.

## Arrancar con el equipo

- **Windows:** `deploy/windows/instalar-servicio.ps1` instala Nebula como servicio con [NSSM](https://nssm.cc) (arranca con Windows, rota el registro en `data/nebula.log`). Gestión día a día, actualizar y solución de problemas: [`docs/servicio-windows.md`](docs/servicio-windows.md).
  Una alternativa sin NSSM: Programador de tareas → «Al iniciar el sistema» → `npm start` en la carpeta del proyecto.
- **Docker:** `docker-compose.yml` y `Dockerfile` (Node 22 + FFmpeg). Monta tus carpetas en solo lectura y añádelas en Ajustes con la ruta de dentro del contenedor.
  La GPU NVIDIA en Docker requiere NVIDIA Container Toolkit; en Windows, lo más fiable para NVENC es ejecutarlo directamente (sin Docker).

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
