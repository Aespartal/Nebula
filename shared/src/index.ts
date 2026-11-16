export type LibraryType = "movies" | "series";

export interface Library { id: number; name: string; type: LibraryType; rootPath: string }

export interface MovieSummary { id: number; title: string; year: number | null; fileId: number }
export interface SeriesSummary { id: number; title: string; seasons: number; episodes: number }

export interface EpisodeItem { id: number; number: number; title: string | null; fileId: number }
export interface SeasonItem { id: number; number: number; episodes: EpisodeItem[] }
export interface SeriesDetail { id: number; title: string; seasons: SeasonItem[] }

export interface MediaStreamInfo {
  idx: number;
  kind: "video" | "audio" | "subtitle";
  codec: string | null;
  profile: string | null;
  pixFmt: string | null;
  width: number | null;
  height: number | null;
  channels: number | null;
  language: string | null;
  title: string | null;
  isDefault: boolean;
  isForced: boolean;
  isExternal: boolean;
}

export interface MediaFileInfo {
  id: number;
  relPath: string;
  sizeBytes: number;
  container: string | null;
  durationS: number | null;
  bitrate: number | null;
  streams: MediaStreamInfo[];
}

export interface ScanStats { added: number; updated: number; unchanged: number; removed: number; skipped: number; failed: number }
