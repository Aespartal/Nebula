import type { MediaStreamInfo } from "@nebula/shared";
import { languageName, normalizeLang } from "./lang";

export interface SubtitleTrack { idx: number; label: string; lang: string; forced: boolean }

const FORMAT_LABEL: Record<string, string> = { subrip: "SRT", srt: "SRT", ass: "ASS", ssa: "SSA", mov_text: "texto", webvtt: "VTT", vtt: "VTT" };

export function subtitleLabel(s: MediaStreamInfo): string {
  const parts = [languageName(s.language)];
  if (s.isForced) parts.push("forzados");
  if (s.isExternal) parts.push("archivo");
  else if (s.title && !/^[\w.\- ]+\.(srt|vtt|ass)$/i.test(s.title) && s.title.length < 30) parts.push(s.title);
  if (!s.textual) parts.push("de imagen, no compatible");
  else if (s.codec && FORMAT_LABEL[s.codec.toLowerCase()] && !s.isExternal) parts.push(FORMAT_LABEL[s.codec.toLowerCase()]);
  return parts.join(" · ");
}

export function textSubtitles(streams: MediaStreamInfo[]): SubtitleTrack[] {
  return streams.filter((s) => s.kind === "subtitle" && s.textual)
    .map((s) => ({ idx: s.idx, label: subtitleLabel(s), lang: normalizeLang(s.language) ?? "und", forced: s.isForced }));
}

/** Subtítulo inicial: el idioma que el usuario eligió la última vez (los completos antes que los «forzados»). */
export function pickSubtitle(tracks: SubtitleTrack[], pref: string | null): number | null {
  if (!pref) return null;
  const same = tracks.filter((t) => t.lang === pref);
  return (same.find((t) => !t.forced) ?? same[0])?.idx ?? null;
}

/** Audio inicial: el idioma recordado, si el archivo lo tiene y no es ya el predeterminado. undefined = el predeterminado. */
export function pickAudio(streams: MediaStreamInfo[], pref: string | null): number | undefined {
  const audio = streams.filter((s) => s.kind === "audio");
  if (!pref || audio.length < 2) return undefined;
  const def = audio.find((s) => s.isDefault) ?? audio[0];
  const match = audio.find((s) => normalizeLang(s.language) === pref);
  return match && match.idx !== def.idx ? match.idx : undefined;
}
