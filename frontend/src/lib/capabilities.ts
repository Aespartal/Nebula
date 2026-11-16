import type { ClientCapabilities } from "@nebula/shared";

/** Lo que este navegador puede reproducir, según el propio navegador (no se adivina por el user-agent). */
export function detectCapabilities(): ClientCapabilities {
  const v = document.createElement("video");
  const can = (t: string) => v.canPlayType(t) !== "";

  const w = window as unknown as { MediaSource?: typeof MediaSource; ManagedMediaSource?: typeof MediaSource };
  const mse = w.ManagedMediaSource ?? w.MediaSource;
  const hlsNative = can("application/vnd.apple.mpegurl") || can("application/x-mpegURL");
  const hlsViaMse = !!mse?.isTypeSupported?.('video/mp4; codecs="avc1.42E01E,mp4a.40.2"');

  return {
    video: {
      h264: can('video/mp4; codecs="avc1.640029"'),
      hevc: can('video/mp4; codecs="hvc1.1.6.L93.B0"'),
      vp9: can('video/webm; codecs="vp9"'),
      av1: can('video/mp4; codecs="av01.0.05M.08"'),
    },
    audio: {
      aac: can('audio/mp4; codecs="mp4a.40.2"'),
      mp3: can("audio/mpeg"),
      opus: can('audio/webm; codecs="opus"'),
      vorbis: can('audio/webm; codecs="vorbis"'),
      flac: can("audio/flac"),
      ac3: can('audio/mp4; codecs="ac-3"'),
      eac3: can('audio/mp4; codecs="ec-3"'),
    },
    containers: {
      mp4: can("video/mp4"),
      webm: can("video/webm"),
      mkv: can("video/x-matroska"),
    },
    hls: hlsViaMse ? "mse" : hlsNative ? "native" : "none",
  };
}
