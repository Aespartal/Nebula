# Diseño de Nebula

Nebula se ve como una herramienta de ingeniería para cine: **oscura, densa, silenciosa**. La referencia visual es
`diseño/nebula_personal_self_hosted_media_server.tsx`. Este documento fija las reglas; los valores viven en
[`frontend/src/styles/tokens.css`](frontend/src/styles/tokens.css), que es la **única fuente de verdad**.

## Principios

1. **El contenido manda.** Las carátulas son lo único con color. La interfaz es gris casi negro y no compite con ellas.
2. **Líneas, no sombras.** Separación con bordes de 1 px. Sin sombras, sin degradados (salvo un velo sobre imágenes), sin escalados al pasar el ratón.
3. **Lo técnico va en monoespaciada.** Tiempos, tamaños, contadores y etiquetas se ven en mono con cifras tabulares, para que se lean como datos.
4. **Un solo color de acción.** Blanco roto. El color solo significa estado: verde = bien, ámbar = en curso, rojo = error.
5. **Accesible por construcción.** Todos los pares de colores cumplen WCAG AA y se comprueban con `npm run tokens`. Móvil primero, objetivos táctiles de 44 px, teclado completo, foco siempre visible, `prefers-reduced-motion` respetado.

## Tokens

No se escriben colores, radios ni tamaños sueltos en los componentes: se usan las utilidades que generan estos tokens.

### Color

| Token | Valor | Utilidad | Uso |
| --- | --- | --- | --- |
| `bg` | `#0a0a0b` | `bg-bg` | Fondo de página |
| `surface` | `#111113` | `bg-surface` | Tarjetas, paneles, campos |
| `raised` | `#18181b` | `bg-raised` | Pestaña activa, hover de filas, chips |
| `track` | `#27272a` | `bg-track` | Carril de las barras de progreso |
| `rule` | `#1f1f23` | `border-rule` | Separadores y bordes **decorativos** |
| `rule-strong` | `#3f3f46` | `border-rule-strong` | Borde decorativo en hover |
| `line` | `#6a6a73` | `border-line` | Borde de **controles** (campos, botones). ≥ 3:1 |
| `text` | `#f4f4f5` | `text-text` | Texto principal |
| `soft` | `#e4e4e7` | `text-soft` | Texto de segundo nivel, etiquetas de formulario |
| `muted` | `#a1a1aa` | `text-muted` | Descripciones, navegación inactiva |
| `faint` | `#8b8b94` | `text-faint` | Metadatos y etiquetas técnicas |
| `accent` / `on-accent` | `#f4f4f5` / `#0a0a0b` | `bg-accent text-on-accent` | Botón principal, barras de progreso, foco |
| `ok` | `#16a34a` | `text-ok` | Reproducción directa, completado |
| `warn` | `#d97706` | `text-warn` | Trabajo en curso, avisos |
| `danger` | `#f87171` | `text-danger` | Errores |
| `scrim` | `#0a0a0b` al 75 % | `bg-scrim` | Velo sobre carátulas y detrás de paneles |

**Dos desviaciones respecto al archivo de referencia**, necesarias para cumplir AA:

- `faint` pasa de `#71717a` (4,1:1 sobre el fondo) a `#8b8b94` (5,9:1). El texto de 11–12 px exige 4,5:1.
- Los controles usan `line` (`#6a6a73`, 3,7:1) en vez de `#1f1f23` (1,2:1). Un campo o botón debe distinguirse del fondo (WCAG 1.4.11). Los bordes decorativos de tarjetas y separadores siguen siendo `rule`, como en la referencia.

### Tipografía

| Token | Valor | Uso |
| --- | --- | --- |
| `font-sans` | Atkinson Hyperlegible | Todo el texto. Pensada para legibilidad a tamaños pequeños |
| `font-mono` | JetBrains Mono | Datos técnicos, etiquetas, contadores |
| `text-label` | 11 px / 16 | Etiquetas: mono, mayúsculas, `tracking-label`, color `faint` (clase `label`) |
| `text-meta` | 12 px / 18 | Botones, campos, datos secundarios |
| `text-body` | 15 px / 24 | Texto de lectura |
| títulos | 18 px · 24–30 px · 30–48 px, negrita, `tracking-tight` | Sección · página · hero |
| `tracking-wordmark` | 0,22 em | Solo el logotipo «NEBULA» |

Atkinson solo tiene pesos 400 y 700: la jerarquía se hace con tamaño, color y negrita, no con pesos intermedios.

### Forma, tamaño y movimiento

| Token | Valor | Notas |
| --- | --- | --- |
| `rounded-ctl` | 4 px | Todo: botones, campos, tarjetas, paneles. Círculo solo para el botón de reproducir |
| `rounded-bar` | 2 px | Barras de progreso |
| `--control-h` | 44 px (táctil) · 36 px (ratón) | Alto mínimo de botones y campos: `min-h-[var(--control-h)]` |
| `--topbar-h` | 56 px | Cabecera fija |
| `max-w-page` | 1520 px | Ancho máximo del contenido; márgenes 16 px (móvil) y 32 px (≥ sm) |
| duración | 150 ms | Todas las transiciones |

## Componentes

- **Cabecera**: logotipo, pestañas (activa = `raised`), avatar con iniciales y «Salir». En móvil, las pestañas pasan a una barra inferior.
- **Botón principal**: sólido `accent`, texto `on-accent`. **Secundario**: `surface` con borde `line`; en hover, borde `muted`.
- **Campo** (clase `field`): `surface`, borde `line`, el borde se aclara al enfocar. Etiqueta encima, en `soft` y negrita.
- **Cartel** (`TitleCard`): 2:3, borde `rule` (→ `rule-strong` en hover), título debajo y datos en mono. Con ratón, un velo con botón de reproducir. Barra de progreso de 3 px al pie. Sin carátula: cartel tipográfico neutro con el título.
- **Etiqueta** (clase `label`): mono, mayúsculas, `faint`. Encabezan secciones y campos de búsqueda.
- **Mensajes**: `msg-info` (borde `line`) y `msg-error` (borde y texto `danger`); siempre con texto, nunca solo color.
- **Panel** (clase `panel`): `surface`, borde `rule`, 20 px de relleno.
- **Hero** (Inicio): lo primero que dejaste a medias, con título grande, tiempo restante y botón «Reanudar».

## Cómo cambiar el diseño

1. Edita un valor en `frontend/src/styles/tokens.css`.
2. Ejecuta `npm run tokens`: falla si algún par de colores deja de cumplir AA.
3. Si añades un token de color que lleve texto encima, añade su par a `frontend/scripts/check-tokens.mjs`.

Un tema claro sería un segundo bloque de tokens (`@media (prefers-color-scheme: light)` o un atributo `data-theme`) con los mismos nombres; ningún componente tendría que cambiar. Hoy la app es solo oscura, como la referencia.

## Lo que no está en el diseño de referencia

El archivo de referencia es una maqueta con datos inventados. Estas partes **no existen** en Nebula y por eso no están en la interfaz: pestañas de cola FFmpeg y almacenamiento, estado del nodo («VAL-SRV-01 · ONLINE»), fondo panorámico del hero, panel MediaInfo con pistas y códecs en las tarjetas. Los tokens están listos para cuando existan.
