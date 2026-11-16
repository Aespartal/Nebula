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
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','user')),
    created_at INTEGER NOT NULL
  );
  -- Solo se guarda el hash (SHA-256) del token: una copia de la base de datos no sirve para suplantar sesiones.
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    user_agent TEXT
  );
  CREATE INDEX idx_sessions_user ON sessions(user_id);
  CREATE TABLE watch_progress (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_id INTEGER NOT NULL REFERENCES media_files(id) ON DELETE CASCADE,
    position_s REAL NOT NULL DEFAULT 0,
    duration_s REAL,
    watched INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, file_id)
  );
  CREATE INDEX idx_progress_recent ON watch_progress(user_id, updated_at DESC);
  `,
  `
  -- Metadatos (TMDB). poster_path es la ruta en TMDB; la imagen se descarga a data/posters la primera vez que se pide.
  ALTER TABLE movies ADD COLUMN meta_checked_at INTEGER;
  ALTER TABLE series ADD COLUMN meta_checked_at INTEGER;
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
