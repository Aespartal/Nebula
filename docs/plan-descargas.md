# Plan: Descargas de torrents integradas en Nebula

Estado: **propuesta**, sin implementar. Cada hito termina en una PR propia.

## 1. Objetivo

Que un administrador pueda, desde la app de Nebula:

1. **Añadir** un torrent (enlace magnet o archivo `.torrent`) y elegir si es película o serie.
2. **Ver** la lista de descargas con progreso, velocidad y estado, y pausarlas, reanudarlas o quitarlas.
3. Que al terminar, el vídeo **aparezca solo** en el catálogo, listo para reproducir.
4. **Descargar el archivo** de cualquier vídeo del catálogo a su móvil o PC (copia local, aparte de verlo en streaming).

Fuera de alcance (a propósito): buscar torrents, indexadores, RSS o descarga automática de series; ver un vídeo mientras aún se descarga; que Nebula sea el cliente BitTorrent.

## 2. Decisiones de diseño

| Decisión | Elección | Por qué |
| --- | --- | --- |
| Quién descarga | Un cliente existente en el mismo equipo (**qBittorrent** primero, **Transmission** después). Nebula solo lo controla | Implementar BitTorrent es enorme y arriesgado; los clientes ya hacen cola, reanudación, verificación y siembra |
| Acoplamiento | Interfaz `TorrentClient` con un adaptador por cliente | Cambiar de cliente no toca la API ni la interfaz |
| Dónde viven las credenciales | `.env` (`TORRENT_CLIENT`, `TORRENT_URL`, `TORRENT_USER`, `TORRENT_PASS`), nunca en la base de datos ni en la web | Mismo criterio que `TMDB_API_KEY`: un administrador remoto no puede ver ni cambiar a dónde se conecta el servidor |
| Exposición del cliente | Solo en `127.0.0.1`; lo único accesible desde fuera es Nebula | La interfaz web del cliente es un punto de entrada más |
| Permisos | Solo administradores añaden, pausan y borran. Los usuarios normales no ven la pestaña | Misma regla que carpetas y metadatos. «Solicitudes» de usuarios queda como mejora futura |
| Qué se acepta al añadir | `magnet:?xt=urn:btih:…` y subida de `.torrent` (máx. 1 MB). **No** URLs `http(s)` | Una URL arbitraria haría que el cliente (y el servidor) pida direcciones elegidas por quien llama: riesgo SSRF |
| Cómo llega el vídeo a la biblioteca | El cliente descarga en una carpeta **de en curso** y, al terminar, **mueve** el archivo a la carpeta de la biblioteca (que ya vigila Nebula). Nebula además fuerza un escaneo al detectar «completado» | El archivo nunca está a medias dentro de la biblioteca y sigue sembrando desde su sitio final |
| Seguimiento propio | Tabla `downloads` en SQLite (hash, nombre, quién lo añadió, tipo, fechas) | El cliente no sabe quién pidió qué ni a qué biblioteca iba |
| Ver mientras descarga | No en esta versión | Exige descarga secuencial y reproducir archivos incompletos; mucho más frágil |

## 3. Arquitectura

```
Navegador ──► Nebula (Fastify) ──► qBittorrent / Transmission  (solo localhost)
                 │   ▲                      │
                 │   └─ sondeo cada 3–5 s   └─ descarga ► carpeta en curso ► (al terminar) biblioteca
                 ▼
              SQLite (downloads)         vigilancia de carpetas ► escaneo ► catálogo
```

### Backend (`backend/src/torrents/`)

- `client.ts`: interfaz común.
  ```ts
  interface TorrentClient {
    check(): Promise<{ ok: boolean; version?: string; error?: "unreachable" | "auth" | "unsupported" }>;
    list(): Promise<TorrentInfo[]>;               // hash, nombre, estado, progreso, bytes, velocidad, ETA, ruta
    addMagnet(uri: string, opts: AddOptions): Promise<string>;   // devuelve el hash
    addFile(data: Buffer, opts: AddOptions): Promise<string>;
    pause(hash: string): Promise<void>;
    resume(hash: string): Promise<void>;
    remove(hash: string, deleteFiles: boolean): Promise<void>;
  }
  ```
- `qbittorrent.ts`: API Web v2. Inicio de sesión con cookie `SID` y reintento si caduca. **Ojo con la versión:** qBittorrent 5.0 renombró pausar/reanudar a `stop`/`start`; el adaptador consulta la versión de la API y usa el nombre que toque. El cliente exige cabeceras `Origin`/`Referer` coherentes con su host.
- `transmission.ts` (hito 5): RPC JSON en `/transmission/rpc`; el primer intento devuelve HTTP 409 con la cabecera `X-Transmission-Session-Id`, que se reenvía y se guarda. Autenticación básica si está activada.
- `service.ts`: `TorrentService` con caché del último `list()`, **sondeo solo mientras hay torrents activos** (si no, cada 30 s para detectar cambios), detección de transiciones a «completado», y llamada al escaneo de la biblioteca correspondiente. Reintentos con espera creciente si el cliente no responde.
- `routes.ts` (todas con `requireAdmin`):

| Método y ruta | Qué hace |
| --- | --- |
| `GET /api/downloads/status` | Conexión con el cliente, versión, espacio libre en la carpeta de destino |
| `GET /api/downloads` | Lista combinada: datos del cliente + tipo y quién lo añadió |
| `POST /api/downloads` | Añade (`{ magnet, kind }` o `{ torrentBase64, kind }`). Valida, comprueba espacio libre y evita duplicados por hash |
| `POST /api/downloads/:hash/pause` y `/resume` | Controla la descarga |
| `DELETE /api/downloads/:hash?files=0\|1` | Quita de la lista, con o sin borrar archivos. Con archivos, pide confirmación en la interfaz |
| `GET /api/files/:id/download` (cualquier usuario con sesión) | Envía el vídeo como adjunto, con `Range` y nombre de archivo saneado (`Content-Disposition` con `filename*`) |

- **Migración 4:** `downloads(hash PRIMARY KEY, name, kind, added_by, added_at, completed_at, library_id)`.
- **Config:** si no hay `TORRENT_CLIENT`, la pestaña muestra instrucciones y la API responde «no configurado» (como TMDB).

### Preparación del cliente

Un botón **«Preparar qBittorrent»** (o un script `npm run torrents:doctor`) que comprueba y, con permiso del administrador, aplica:

1. Carpeta de **en curso** distinta de la biblioteca.
2. Categorías `nebula-peliculas` y `nebula-series`, cada una con su carpeta final.
3. Modo de gestión automática de torrents para que, al terminar, se muevan a la carpeta de su categoría.

Estos pasos usan endpoints de preferencias y categorías de la API que **hay que verificar en el hito 0** contra un qBittorrent real; hay informes de que pasar la ruta de guardado directamente en `torrents/add` se comporta de forma inconsistente, así que se prefiere configurarla por categoría.

### Frontend

- **Pestaña «Descargas»** (solo admin), con el estilo del diseño: lista densa en mono con barra de progreso (`role="progressbar"`), velocidad, ETA y estado. Móvil: una tarjeta por torrent.
- **Añadir:** campo para pegar un magnet, subida de `.torrent`, selector Película/Serie, mensajes de error claros (sin espacio, duplicado, cliente apagado).
- Acciones por fila: Pausar/Reanudar y Quitar (con opción de borrar archivos y confirmación).
- Cuando algo termina, un aviso accesible (`role="status"`) y el título aparece en el catálogo.
- **Botón «Descargar archivo»** en la página de reproducción.
- Estado de conexión con el cliente siempre visible; si falla, instrucciones concretas.

## 4. Hitos

| # | Hito | Entregable | Criterio de aceptación | Tamaño |
| --- | --- | --- | --- | --- |
| 0 | **Prueba de concepto contra qBittorrent real** | `npm run torrents:doctor`: conecta, lista, añade un torrent de prueba y lo borra | Funciona en tu PC. Confirmados los endpoints de categorías y preferencias y el comportamiento de versión 4.x y 5.x | S |
| 1 | Cliente y servicio | Adaptador qBittorrent, `TorrentService`, servidor simulado para tests | Tests: login y reintento, estados, completado detectado una sola vez, cliente caído | M |
| 2 | API, permisos y base de datos | Rutas, validación, migración 4 | Tests: solo admin, magnet inválido, `.torrent` grande, URL `http` rechazada, duplicado, sin espacio | M |
| 3 | Interfaz «Descargas» | Pestaña, formulario, acciones, estado | e2e en Chrome con cliente simulado; axe sin violaciones en móvil y escritorio | M |
| 4 | Completado → catálogo, y descarga de archivo | Escaneo al completar, archivo incompleto nunca visible, `GET /api/files/:id/download` y botón | Un torrent de prueba termina y aparece sin intervención; la descarga reanuda con `Range` | M |
| 5 | Transmission | Segundo adaptador, mismos tests | Los mismos tests pasan con ambos clientes | M |
| 6 | Pulido | Lista de «sin reconocer» (archivos cuyo nombre no encaja) con botón para indicar título, temporada y episodio; documentación | Ningún vídeo descargado se queda sin poder verse | M |

El hito 0 va primero porque aclara las dudas de la API antes de construir encima. El 6 es el más opcional.

## 5. Pruebas

- **Servidor simulado** del cliente (como el de TMDB): responde a login, lista, añadir, pausar y borrar, y permite simular estados, caídas y versiones 4.x/5.x.
- **Contrato compartido**: la misma batería de tests corre contra cada adaptador.
- **e2e** (Playwright + axe) de todo el flujo con el cliente simulado.
- **Manual** en tu PC con un torrent legal y pequeño (por ejemplo una distribución de Linux), comprobando que se mueve, se escanea y se reproduce.

## 6. Riesgos y cómo se tratan

| Riesgo | Mitigación |
| --- | --- |
| La API cambia entre versiones del cliente | Detectar versión, hito 0 en tu equipo, tests con 4.x y 5.x simulados |
| Nombres de torrent que el escáner no reconoce | Hito 6; mientras tanto, el archivo existe pero no aparece, y la pantalla de Descargas lo indica |
| Archivo a medias dentro de la biblioteca | Carpeta de en curso separada; la vigilancia ya ignora lo que no es vídeo |
| Disco lleno | Comprobar espacio libre antes de añadir y mostrarlo en la página |
| Servicio de Windows sin acceso a las carpetas del cliente | Documentar que el servicio y el cliente deben compartir permisos sobre ambas carpetas; usar rutas locales |
| Exposición accidental del cliente | Documentar `127.0.0.1`; `status` avisa si detecta que el cliente escucha en otra interfaz |
| Contenido y legalidad | La responsabilidad de lo que se descarga es del administrador; la documentación lo indica y recomienda un VPN si el tráfico lo requiere |

## 7. Decisiones que necesito de ti

1. **Cliente:** ¿qBittorrent (recomendado) o ya usas Transmission? Empezaría por el que tengas.
2. **Usuarios normales:** ¿solo el administrador gestiona las descargas, o quieres que otras cuentas puedan *pedir* una y tú aprobarla?
3. **Borrado:** al quitar una descarga, ¿qué es lo normal: conservar el archivo y seguir sembrando, o borrar todo?
4. **Siembra:** ¿hay que parar al terminar o seguir compartiendo (límite de ratio o de tiempo)?
5. **Descarga de archivo al dispositivo:** ¿para todos los usuarios o solo administradores?
