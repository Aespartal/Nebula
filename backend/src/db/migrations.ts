import type Database from "better-sqlite3";

// Añade migraciones al final; nunca edites las ya publicadas.
const migrations: string[] = [
  `
  CREATE TABLE libraries (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('movies','series')),
    root_path TEXT NOT NULL UNIQUE
  );
  CREATE TABLE movies (
    id INTEGER PRIMARY KEY,
    library_id INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    year INTEGER,
    overview TEXT, tmdb_id INTEGER, poster_path TEXT
  );
  CREATE TABLE series (
    id INTEGER PRIMARY KEY,
    library_id INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    year INTEGER,
    overview TEXT, tmdb_id INTEGER, poster_path TEXT
  );
  CREATE TABLE seasons (
    id INTEGER PRIMARY KEY,
    series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
    number INTEGER NOT NULL,
    UNIQUE (series_id, number)
  );
  CREATE TABLE episodes (
    id INTEGER PRIMARY KEY,
    season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    number INTEGER NOT NULL,
    title TEXT, overview TEXT,
    UNIQUE (season_id, number)
  );
  CREATE TABLE media_files (
    id INTEGER PRIMARY KEY,
    library_id INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    movie_id INTEGER REFERENCES movies(id) ON DELETE CASCADE,
    episode_id INTEGER REFERENCES episodes(id) ON DELETE CASCADE,
    path TEXT NOT NULL UNIQUE,
    rel_path TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    mtime_ms INTEGER NOT NULL,
    container TEXT, duration_s REAL, bitrate INTEGER,
    CHECK ((movie_id IS NULL) <> (episode_id IS NULL))
  );
  CREATE INDEX idx_media_files_library ON media_files(library_id);
  CREATE TABLE media_streams (
    id INTEGER PRIMARY KEY,
    file_id INTEGER NOT NULL REFERENCES media_files(id) ON DELETE CASCADE,
    idx INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('video','audio','subtitle')),
    codec TEXT, profile TEXT, pix_fmt TEXT, width INTEGER, height INTEGER,
    channels INTEGER, language TEXT, title TEXT,
    is_default INTEGER NOT NULL DEFAULT 0,
    is_forced INTEGER NOT NULL DEFAULT 0,
    is_external INTEGER NOT NULL DEFAULT 0,
    external_path TEXT
  );
  CREATE INDEX idx_media_streams_file ON media_streams(file_id);
  `,
];

export function migrate(db: Database.Database) {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (let i = current; i < migrations.length; i++) {
    db.transaction(() => {
      db.exec(migrations[i]);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
}
