import path from "node:path";

export type Parsed =
  | { kind: "movie"; title: string; year: number | null }
  | { kind: "episode"; series: string; season: number; episode: number; episodeTitle: string | null };

const JUNK =
  /\b(2160p|1080p|720p|480p|4k|uhd|bluray|blu-ray|brrip|bdrip|web-?dl|webrip|hdtv|dvdrip|hdrip|x264|x265|h\.?264|h\.?265|hevc|remux|10bit|hdr|dts|aac|ac3|atmos|proper|repack|extended|unrated|multi|dual|castellano|latino)\b/i;

export function cleanTitle(raw: string): string {
  let s = raw.replace(/[._]+/g, " ").replace(/\s+/g, " ").trim();
  const m = JUNK.exec(s);
  if (m) s = s.slice(0, m.index);
  return s.replace(/[\s\-–(\[]+$/, "").trim();
}

const SEASON_DIR = /^(?:season|temporada|s)[\s._-]*(\d{1,2})$/i;
const EP_SXXEXX = /^(.*?)[\s._-]*s(\d{1,2})e(\d{1,3})(?:[e-]\d{1,3})?(?:[\s._-]+(.*))?$/i;
const EP_NXNN = /^(.*?)[\s._-]*(\d{1,2})x(\d{2,3})(?:[\s._-]+(.*))?$/i;
const EP_ONLY = /^(?:e|ep|episode|episodio)?[\s._-]*(\d{1,3})(?:[\s._-]+(.*))?$/i;

function parseMovie(relPath: string): Parsed {
  const parts = relPath.split("/");
  const name = path.posix.basename(parts[parts.length - 1], path.posix.extname(relPath));

  // Último año plausible que no esté al principio ("2001 A Space Odyssey (1968)").
  const re = /(?:^|[\s.(\[_-])((?:19|20)\d{2})(?=$|[\s.)\]_-])/g;
  let yearMatch: { year: number; start: number } | null = null;
  for (let m = re.exec(name); m; m = re.exec(name)) {
    const start = m.index + m[0].length - m[1].length;
    if (start > 0) yearMatch = { year: Number(m[1]), start };
  }
  if (yearMatch) {
    const title = cleanTitle(name.slice(0, yearMatch.start));
    if (title) return { kind: "movie", title, year: yearMatch.year };
  }

  // Layout "Título (Año)/archivo.mkv": manda el nombre de la carpeta.
  const parent = parts.length > 1 ? parts[parts.length - 2] : "";
  const pm = /^(.*?)[\s._-]*\(((?:19|20)\d{2})\)$/.exec(parent);
  if (pm && cleanTitle(pm[1])) return { kind: "movie", title: cleanTitle(pm[1]), year: Number(pm[2]) };
  return { kind: "movie", title: cleanTitle(name) || name, year: null };
}

function parseEpisode(relPath: string): Parsed | null {
  const parts = relPath.split("/");
  const name = path.posix.basename(parts[parts.length - 1], path.posix.extname(relPath));
  const dirs = parts.slice(0, -1);

  const seasonDir = [...dirs].reverse().map((d) => SEASON_DIR.exec(d)).find(Boolean);
  const showDir = dirs.length > 0 && !SEASON_DIR.test(dirs[0]) ? cleanTitle(dirs[0]) : "";

  const m = EP_SXXEXX.exec(name) ?? EP_NXNN.exec(name);
  if (m) {
    const series = showDir || cleanTitle(m[1]);
    if (!series) return null;
    const rest = m[4] ? cleanTitle(m[4]) : "";
    return {
      kind: "episode",
      series,
      season: Number(m[2]),
      episode: Number(m[3]),
      episodeTitle: rest || null,
    };
  }

  // "Show/Season 2/05 - Titulo.mkv"
  const e = EP_ONLY.exec(name);
  if (e && showDir && seasonDir) {
    const rest = e[2] ? cleanTitle(e[2]) : "";
    return {
      kind: "episode",
      series: showDir,
      season: Number(seasonDir[1]),
      episode: Number(e[1]),
      episodeTitle: rest || null,
    };
  }
  return null;
}

/** relPath con separador "/" relativo a la raíz de la biblioteca. */
export function parseMedia(relPath: string, type: "movies" | "series"): Parsed | null {
  return type === "movies" ? parseMovie(relPath) : parseEpisode(relPath);
}
