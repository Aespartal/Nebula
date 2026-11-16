/** Contrato común de los clientes de torrents (qBittorrent hoy, Transmission más adelante). */

/** Estado ya normalizado: la interfaz y el servicio no conocen los nombres internos de cada cliente. */
export type TorrentState =
  | "downloading" // descargando (o buscando metadatos)
  | "stalled" // descargando pero sin ningún par que dé datos
  | "queued" // en cola del cliente
  | "checking" // verificando archivos o reservando espacio
  | "moving" // moviendo a su carpeta final
  | "seeding" // compartiendo
  | "paused" // parado
  | "error" // error o archivos que faltan
  | "unknown";

export interface TorrentInfo {
  /** Hash del torrent, en minúsculas y en hexadecimal (40 caracteres). */
  hash: string;
  name: string;
  state: TorrentState;
  /** 0 a 1. */
  progress: number;
  /** Descargado por completo (aunque ahora esté compartiendo, parado o moviéndose). */
  done: boolean;
  sizeBytes: number;
  downloadedBytes: number;
  speedDown: number;
  speedUp: number;
  /** Segundos que faltan; null si no se puede estimar. */
  etaS: number | null;
  category: string;
  /** Carpeta donde está (o estará) el contenido. */
  savePath: string;
  addedAt: number | null;
  completedAt: number | null;
}

export interface AddOptions {
  /** Categoría del cliente; decide la carpeta final cuando la gestión automática está activada. */
  category?: string;
  /** Añadir sin empezar a descargar. */
  paused?: boolean;
}

export type CheckError = "unreachable" | "auth" | "unsupported";

export interface TorrentClient {
  check(): Promise<{ ok: boolean; version?: string; error?: CheckError; message?: string }>;
  list(): Promise<TorrentInfo[]>;
  /** Devuelve el hash del torrent añadido. */
  addMagnet(uri: string, opts?: AddOptions): Promise<string>;
  addFile(data: Buffer, opts?: AddOptions): Promise<string>;
  pause(hash: string): Promise<void>;
  resume(hash: string): Promise<void>;
  remove(hash: string, deleteFiles: boolean): Promise<void>;
}

export type TorrentErrorCode = "invalid_magnet" | "invalid_torrent" | "rejected";
export class TorrentError extends Error {
  constructor(public code: TorrentErrorCode, message: string) { super(message); }
}
