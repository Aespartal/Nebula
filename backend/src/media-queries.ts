import type { MediaStreamInfo } from "@nebula/shared";
import type { Db } from "./db/index.js";
import { isTextSubtitle } from "./subtitles.js";

export function getStreams(db: Db, fileId: number): MediaStreamInfo[] {
  return (db.prepare(`
    SELECT idx, kind, codec, profile, pix_fmt AS pixFmt, width, height, channels, language, title,
           is_default AS isDefault, is_forced AS isForced, is_external AS isExternal
    FROM media_streams WHERE file_id=? ORDER BY idx`).all(fileId) as any[]).map((s) => ({
    ...s, isDefault: !!s.isDefault, isForced: !!s.isForced, isExternal: !!s.isExternal,
    textual: s.kind === "subtitle" && isTextSubtitle(s.codec),
  }));
}
