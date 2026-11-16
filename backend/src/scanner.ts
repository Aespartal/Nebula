import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { ScanStats } from "@nebula/shared";
import { SUB_EXTS, VIDEO_EXTS, config } from "./config.js";
import type { Db } from "./db/index.js";
import { probe, type ProbeResult } from "./ffmpeg/probe.js";
import { parseMedia, type Parsed } from "./parser.js";

export interface LibraryRow { id: number; name: string; type: "movies" | "series"; root_path: string }

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

/** Subtítulos externos junto al vídeo: "Peli.es.srt", "Peli.srt". */
async function findExternalSubs(videoPath: string) {
  const dir = path.dirname(videoPath);
  const base = path.basename(videoPath, path.extname(videoPath));
  const out: { path: string; language: string | null; title: string }[] = [];
  for (const name of await readdir(dir)) {
    const ext = path.extname(name).toLowerCase();
    if (!SUB_EXTS.has(ext) || !name.startsWith(base + ".")) continue;
    const middle = name.slice(base.length + 1, name.length - ext.length); // "es" | "" | "es.forced"
    const lang = /^[a-z]{2,3}\b/i.exec(middle)?.[0].toLowerCase() ?? null;
    out.push({ path: path.join(dir, name), language: lang, title: name });
  }
  return out;
}

function createStatements(db: Db) {
  return {
    findMovie: db.prepare(
      "SELECT id FROM movies WHERE library_id=? AND lower(title)=lower(?) AND COALESCE(year,0)=COALESCE(?,0)",
    ),
    insertMovie: db.prepare("INSERT INTO movies(library_id,title,year) VALUES(?,?,?)"),
    findSeries: db.prepare("SELECT id FROM series WHERE library_id=? AND lower(title)=lower(?)"),
    insertSeries: db.prepare("INSERT INTO series(library_id,title) VALUES(?,?)"),
    findSeason: db.prepare("SELECT id FROM seasons WHERE series_id=? AND number=?"),
    insertSeason: db.prepare("INSERT INTO seasons(series_id,number) VALUES(?,?)"),
    findEpisode: db.prepare("SELECT id FROM episodes WHERE season_id=? AND number=?"),
    insertEpisode: db.prepare("INSERT INTO episodes(season_id,number,title) VALUES(?,?,?)"),
    upsertFile: db.prepare(`
      INSERT INTO media_files(library_id,movie_id,episode_id,path,rel_path,size_bytes,mtime_ms,container,duration_s,bitrate)
      VALUES(@library_id,@movie_id,@episode_id,@path,@rel_path,@size_bytes,@mtime_ms,@container,@duration_s,@bitrate)
      ON CONFLICT(path) DO UPDATE SET movie_id=excluded.movie_id, episode_id=excluded.episode_id,
        rel_path=excluded.rel_path, size_bytes=excluded.size_bytes, mtime_ms=excluded.mtime_ms,
        container=excluded.container, duration_s=excluded.duration_s, bitrate=excluded.bitrate
      RETURNING id`),
    deleteStreams: db.prepare("DELETE FROM media_streams WHERE file_id=?"),
    insertStream: db.prepare(`
      INSERT INTO media_streams(file_id,idx,kind,codec,profile,pix_fmt,width,height,channels,language,title,
        is_default,is_forced,is_external,external_path)
      VALUES(@file_id,@idx,@kind,@codec,@profile,@pix_fmt,@width,@height,@channels,@language,@title,
        @is_default,@is_forced,@is_external,@external_path)`),
  };
}

type Stmts = ReturnType<typeof createStatements>;
type Subs = Awaited<ReturnType<typeof findExternalSubs>>;

function resolveEntity(st: Stmts, lib: LibraryRow, parsed: Parsed) {
  const id = (r: unknown) => (r as { id: number } | undefined)?.id;
  if (parsed.kind === "movie") {
    const movieId =
      id(st.findMovie.get(lib.id, parsed.title, parsed.year)) ??
      Number(st.insertMovie.run(lib.id, parsed.title, parsed.year).lastInsertRowid);
    return { movie_id: movieId, episode_id: null };
  }
  const seriesId =
    id(st.findSeries.get(lib.id, parsed.series)) ??
    Number(st.insertSeries.run(lib.id, parsed.series).lastInsertRowid);
  const seasonId =
    id(st.findSeason.get(seriesId, parsed.season)) ??
    Number(st.insertSeason.run(seriesId, parsed.season).lastInsertRowid);
  const episodeId =
    id(st.findEpisode.get(seasonId, parsed.episode)) ??
    Number(st.insertEpisode.run(seasonId, parsed.episode, parsed.episodeTitle).lastInsertRowid);
  return { movie_id: null, episode_id: episodeId };
}

function cleanupOrphans(db: Db) {
  db.exec(`
    DELETE FROM movies WHERE id NOT IN (SELECT movie_id FROM media_files WHERE movie_id IS NOT NULL);
    DELETE FROM episodes WHERE id NOT IN (SELECT episode_id FROM media_files WHERE episode_id IS NOT NULL);
    DELETE FROM seasons WHERE id NOT IN (SELECT season_id FROM episodes);
    DELETE FROM series WHERE id NOT IN (SELECT series_id FROM seasons);
  `);
}

/** Escaneo incremental: solo hace ffprobe de archivos nuevos o cambiados (tamaño/mtime). */
const scanning = new Set<number>();

export async function scanLibrary(db: Db, lib: LibraryRow): Promise<ScanStats> {
  if (scanning.has(lib.id)) throw Object.assign(new Error("scan_in_progress"), { statusCode: 409 });
  scanning.add(lib.id);
  try {
    return await doScan(db, lib);
  } finally {
    scanning.delete(lib.id);
  }
}

async function doScan(db: Db, lib: LibraryRow): Promise<ScanStats> {
  const stats: ScanStats = { added: 0, updated: 0, unchanged: 0, removed: 0, skipped: 0, failed: 0 };
  const st = createStatements(db);

  const existing = new Map<string, { id: number; size_bytes: number; mtime_ms: number }>();
  for (const r of db
    .prepare("SELECT id,path,size_bytes,mtime_ms FROM media_files WHERE library_id=?")
    .all(lib.id) as any[]) {
    existing.set(r.path, r);
  }

  const seen = new Set<string>();
  const todo: { file: string; size: number; mtimeMs: number; isNew: boolean }[] = [];
  for await (const file of walk(lib.root_path)) {
    if (!VIDEO_EXTS.has(path.extname(file).toLowerCase())) continue;
    seen.add(file);
    const s = await stat(file);
    const prev = existing.get(file);
    if (prev && prev.size_bytes === s.size && prev.mtime_ms === Math.floor(s.mtimeMs)) {
      stats.unchanged++;
      continue;
    }
    todo.push({ file, size: s.size, mtimeMs: Math.floor(s.mtimeMs), isNew: !prev });
  }

  const processFile = async (t: (typeof todo)[number]) => {
    const relPath = path.relative(lib.root_path, t.file).split(path.sep).join("/");
    const parsed = parseMedia(relPath, lib.type);
    if (!parsed) {
      stats.skipped++;
      console.warn(`[scan] nombre no reconocido, se omite: ${relPath}`);
      return;
    }
    let probed: ProbeResult;
    let subs: Subs;
    try {
      probed = await probe(t.file);
      subs = await findExternalSubs(t.file);
    } catch (err) {
      stats.failed++;
      console.warn(`[scan] ffprobe falló en ${relPath}: ${(err as Error).message.split("\n")[0]}`);
      return;
    }
    db.transaction(() => {
      const ent = resolveEntity(st, lib, parsed);
      const row = st.upsertFile.get({
        library_id: lib.id, ...ent, path: t.file, rel_path: relPath,
        size_bytes: t.size, mtime_ms: t.mtimeMs,
        container: probed.container, duration_s: probed.durationS, bitrate: probed.bitrate,
      }) as { id: number };
      st.deleteStreams.run(row.id);
      const base = { file_id: row.id, profile: null, pix_fmt: null, width: null, height: null, channels: null, external_path: null };
      for (const s of probed.streams) {
        st.insertStream.run({
          ...base, idx: s.idx, kind: s.kind, codec: s.codec, profile: s.profile, pix_fmt: s.pixFmt,
          width: s.width, height: s.height, channels: s.channels, language: s.language, title: s.title,
          is_default: +s.isDefault, is_forced: +s.isForced, is_external: 0,
        });
      }
      subs.forEach((sub, i) =>
        st.insertStream.run({
          ...base, idx: 1000 + i, kind: "subtitle", codec: path.extname(sub.path).slice(1),
          language: sub.language, title: sub.title, is_default: 0, is_forced: 0,
          is_external: 1, external_path: sub.path,
        }),
      );
    })();
    t.isNew ? stats.added++ : stats.updated++;
  };

  // Pool de ffprobe concurrentes; las escrituras en SQLite son síncronas y no se pisan.
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, config.probeConcurrency) }, async () => {
      while (next < todo.length) await processFile(todo[next++]);
    }),
  );

  const gone = [...existing.entries()].filter(([p]) => !seen.has(p));
  if (gone.length) {
    const del = db.prepare("DELETE FROM media_files WHERE id=?");
    db.transaction(() => gone.forEach(([, r]) => del.run(r.id)))();
    stats.removed = gone.length;
  }
  cleanupOrphans(db);
  return stats;
}
