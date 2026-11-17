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

También puedes añadir carpetas desde la propia app (Ajustes). Una biblioteca debe ser la carpeta donde están tus vídeos: Nebula rechaza una unidad entera (`D:\`) o una carpeta del sistema, y al escanear se salta `node_modules`, la papelera y similares. Requisitos: Node 22+, `ffprobe` en el PATH (o `FFPROBE_PATH`).

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

## Catálogo y uso diario

- **Inicio**: «Seguir viendo» y, debajo, «Recién añadidos» con lo último que ha entrado en la biblioteca (películas, y series con sus episodios nuevos agrupados: una descarga de 8 episodios es una sola entrada). La fecha es la de la primera vez que Nebula vio el archivo; lo que ya estaba antes de actualizar se ordena por la fecha del archivo.
- **Películas y Series**: filtra por estado (Todas · Pendientes · En curso · Vistas, con su recuento) y ordena por título, año (solo películas) o añadido recientemente. La elección va en la dirección (`?estado=vistas&orden=reciente`), así que se conserva al recargar y se puede enlazar. En una serie, «En curso» es que tiene algún episodio visto o empezado.
- **Instalar como aplicación**: desde el menú de Chrome, Edge o Android («Instalar Nebula» o «Añadir a pantalla de inicio», según el navegador); en iPhone y iPad, Compartir → «Añadir a pantalla de inicio». Se abre sin barra de direcciones. Los navegadores solo la ofrecen por HTTPS (o en `localhost`), así que desde fuera de casa hace falta [publicarla con HTTPS](#publicar-en-internet). No funciona sin conexión.
- **Teclas multimedia**: play/pausa, ±10 s y siguiente/anterior episodio desde el teclado, los auriculares o la pantalla de bloqueo del móvil, con el título y la carátula. «Anterior» reinicia el episodio si ya han pasado 5 s.

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

## Descargas (administradores)

Nebula controla un qBittorrent instalado **en el mismo equipo** (decisiones y plan en [`docs/plan-descargas.md`](docs/plan-descargas.md)). Solo los administradores ven la pestaña **Descargas**.

**Qué permite**
- Añadir por enlace magnet o archivo `.torrent` (nunca una URL) y elegir si es Película o Serie: la descarga va a la carpeta de esa biblioteca.
- Ver progreso, velocidad y tiempo restante; pausar, reanudar y quitar. Quitar puede dejar los archivos o borrarlos también (pide confirmación).
- Al terminar, el vídeo entra solo en el catálogo; un vídeo a medias nunca aparece.
- Cualquier usuario puede usar **Descargar archivo** en la página de reproducción para bajarse el original (admite reanudar).
- Solo se gestionan las descargas que añade Nebula, no el resto de lo que haya en qBittorrent. Si en el disco no queda margen libre (`TORRENT_MIN_FREE_GB`, 5 GB por defecto) se niega a añadir.

**Buscador (opcional)**: con [Prowlarr](https://prowlarr.com) instalado en el mismo equipo, la pestaña Descargas puede buscar torrents y añadirlos con un clic.
1. Instala Prowlarr y añade los indexadores que quieras usar (*Indexers → Add Indexer*). Nebula no trae ninguno: qué buscar y dónde lo decides tú.
2. Copia la API key (*Settings → General → Security*) y ponla en `.env` como `PROWLARR_API_KEY`; `PROWLARR_URL` por defecto es `http://127.0.0.1:9696`. Reinicia Nebula.
3. En Descargas aparece «Buscar torrents»: eliges Película o Serie, buscas y pulsas **Descargar**. Los resultados salen ordenados por semillas y los ya añadidos se marcan.
- Solo administradores. Nebula pide a Prowlarr únicamente lo que ha salido en la última búsqueda: el navegador nunca envía direcciones, y el `.torrent` solo se descarga del propio Prowlarr.
- Los resultados con 0 semillas se muestran, pero normalmente no avanzan.

**Configuración**
1. En qBittorrent: *Herramientas → Opciones → Interfaz web*, activa la interfaz, deja la dirección en `127.0.0.1` y pon usuario y contraseña. No la expongas fuera del equipo.
2. En `.env`: `TORRENT_URL` (por defecto `http://127.0.0.1:8080`), `TORRENT_USER` y `TORRENT_PASS`. El `.env` se lee al arrancar: reinicia Nebula tras cambiarlo.
3. Recomendado en qBittorrent:
   - *Descargas*: carpeta de descargas completas, otra para «Mantener los torrents incompletos en», **«Añadir extensión .!qB a los archivos incompletos»** y gestión de torrents **Automático**.
   - *BitTorrent → Límites de compartición*: ratio 1,0 y 1440 min, y «Parar torrents» al llegar.
   - *Velocidad*: en un disco mecánico, limita la bajada para no saturarlo.
4. Ejecuta `npm run torrents:doctor`: comprueba conexión, carpetas y siembra, y prueba a crear y borrar una categoría temporal.

**Si algo falla**
- *«Usuario o contraseña incorrectos»*: tras 5 fallos qBittorrent bloquea la IP un rato; espera o reinícialo.
- *El vídeo terminó pero no aparece*: Nebula deduce título, temporada y episodio del nombre del archivo; si no lo entiende, lo omite y lo deja anotado en el log (`nombre no reconocido`). Renombra el archivo (`Título (año)/Título (año).mkv`, `Serie/Temporada 1/Serie S01E02.mkv`) y pulsa «Buscar cambios» en Ajustes.
- *Servicio de Windows*: el servicio de Nebula y qBittorrent deben tener permisos sobre las carpetas de las bibliotecas; usa rutas locales, no unidades de red.
- Mientras qBittorrent no responde, Nebula no sabe qué descargas siguen incompletas; la extensión `.!qB` evita que se escaneen.

**Aviso legal**: lo que se descarga es responsabilidad del administrador. Si tu tráfico lo requiere, usa una VPN.

## Subtítulos y audio

- Subtítulos de texto (SRT, ASS/SSA, mov_text, WebVTT), incrustados o en archivos externos junto al vídeo, se convierten a WebVTT al vuelo y se guardan en caché. Los de imagen (PGS, DVD) no se pueden mostrar en el navegador y aparecen desactivados.
- En el reproductor eliges subtítulo y pista de audio; Nebula recuerda tu idioma preferido en ese navegador.
- **Sincronía**: si un subtítulo sale antes o después, ajústalo en pasos de 0,5 s (hasta ±60 s) con «−0,5 s» y «+0,5 s» bajo el selector. Se aplica al instante en el navegador, sin tocar el archivo, y se recuerda para ese vídeo y esa pista.

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

## Enviar a la TV (Chromecast)

En la página de reproducción aparece **Enviar a la TV** (Chrome en Android o PC). Tu móvil hace de mando (pausa, ±10 s, parar) y la Chromecast pide el vídeo **directamente a Nebula por Internet**, así que funciona aunque estés en otra casa y otra wifi.

**Qué necesita**
1. Una dirección pública con HTTPS válido. Sin dominio y gratis: [Tailscale Funnel](https://tailscale.com/kb/1223/funnel). Instala Tailscale **solo en el PC**, actívalo con tu cuenta y ejecuta `tailscale funnel --bg 3000`; te da `https://nombre-del-pc.tu-red.ts.net`.
2. En `.env`: `PUBLIC_URL=https://nombre-del-pc.tu-red.ts.net` y `TRUST_PROXY=1`. Reinicia Nebula. Sin `PUBLIC_URL` el botón no aparece.
3. El PC encendido y con Nebula en marcha mientras se ve la película.

**Cómo funciona y qué se expone**
- La tele no tiene tu sesión. Nebula crea una conversión para esa película y una dirección con **permiso firmado que caduca a las 6 horas**; sirve solo esa conversión (lista y segmentos), con CORS. No da acceso a la biblioteca, a otras películas ni a la API.
- Siempre se convierte a H.264/AAC en **720p máximo**, para que la tele lo reproduzca y el túnel no se sature. Con GPU NVIDIA va fluido; solo con CPU depende del equipo.
- Al pulsar **Dejar de enviar** se libera la conversión. El progreso se guarda en tu cuenta cada 15 s.
- Tailscale Funnel tiene límites de ancho de banda no publicados: si se corta o se pausa a menudo, prueba con otra hora.
- No hay botón en iPhone/Safari (Google Cast solo existe en Chrome).

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
