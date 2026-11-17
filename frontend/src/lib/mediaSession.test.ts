import { test } from "node:test";
import assert from "node:assert/strict";
import { bindMediaSession, type MediaSessionLike, type MediaVideoLike } from "./mediaSession";

class FakeVideo extends EventTarget implements MediaVideoLike {
  currentTime = 0;
  duration = 100;
  playbackRate = 1;
  calls: string[] = [];
  play() { this.calls.push("play"); return Promise.resolve(); }
  pause() { this.calls.push("pause"); }
}

function setup(opts: { next?: boolean; previous?: boolean; unsupported?: string[]; poster?: string | null; subtitle?: string | null } = {}) {
  const handlers = new Map<string, ((d: any) => void) | null>();
  const positions: unknown[] = [];
  const session: MediaSessionLike & { metadata: any } = {
    metadata: undefined,
    setActionHandler(a, h) {
      if (opts.unsupported?.includes(a)) throw new TypeError(`acción no admitida: ${a}`);
      handlers.set(a, h);
    },
    setPositionState(s) { positions.push(s); },
  };
  const video = new FakeVideo();
  const nav: string[] = [];
  const unbind = bindMediaSession(
    session, video,
    { title: "Piloto", subtitle: opts.subtitle === undefined ? "Serie · T1 E1" : opts.subtitle, poster: opts.poster === undefined ? "/api/posters/series/1" : opts.poster },
    { onNext: opts.next ? () => nav.push("next") : undefined, onPrevious: opts.previous ? () => nav.push("previous") : undefined },
    (init) => ({ ...init }),
  );
  return { session, handlers, positions, video, nav, unbind };
}

test("metadatos: título, línea secundaria y carátula", () => {
  const { session } = setup();
  assert.deepEqual(session.metadata, { title: "Piloto", artist: "Serie · T1 E1", artwork: [{ src: "/api/posters/series/1" }] });
});

test("metadatos: sin subtítulo ni carátula no se inventan campos", () => {
  const { session } = setup({ subtitle: null, poster: null });
  assert.deepEqual(session.metadata, { title: "Piloto" });
});

test("play y pausa llegan al vídeo", () => {
  const { handlers, video } = setup();
  handlers.get("play")!({});
  handlers.get("pause")!({});
  assert.deepEqual(video.calls, ["play", "pause"]);
});

test("adelantar y retroceder: 10 s por defecto, o lo que pida el sistema, sin salirse de 0 ni del final", () => {
  const { handlers, video } = setup();
  video.currentTime = 50;
  handlers.get("seekforward")!({});
  assert.equal(video.currentTime, 60);
  handlers.get("seekbackward")!({ seekOffset: 30 });
  assert.equal(video.currentTime, 30);
  handlers.get("seekbackward")!({ seekOffset: 999 });
  assert.equal(video.currentTime, 0);
  video.currentTime = 95;
  handlers.get("seekforward")!({});
  assert.equal(video.currentTime, 100);
});

test("seekto salta a la posición pedida y no hace nada sin ella", () => {
  const { handlers, video } = setup();
  handlers.get("seekto")!({ seekTime: 42 });
  assert.equal(video.currentTime, 42);
  handlers.get("seekto")!({});
  assert.equal(video.currentTime, 42);
});

test("siguiente: solo se registra si hay siguiente episodio", () => {
  const sin = setup();
  assert.equal(sin.handlers.get("nexttrack"), null);
  const con = setup({ next: true });
  con.handlers.get("nexttrack")!({});
  assert.deepEqual(con.nav, ["next"]);
});

test("anterior: pasados 5 s reinicia el episodio; al principio va al anterior", () => {
  const { handlers, video, nav } = setup({ previous: true });
  video.currentTime = 30;
  handlers.get("previoustrack")!({});
  assert.equal(video.currentTime, 0);
  assert.deepEqual(nav, []);
  video.currentTime = 3;
  handlers.get("previoustrack")!({});
  assert.deepEqual(nav, ["previous"]);
});

test("anterior sin episodio anterior: reinicia", () => {
  const { handlers, video, nav } = setup();
  video.currentTime = 3;
  handlers.get("previoustrack")!({});
  assert.equal(video.currentTime, 0);
  assert.deepEqual(nav, []);
});

test("posición: se informa al cargar y en los eventos, y no con duración desconocida", () => {
  const { positions, video } = setup();
  assert.equal(positions.length, 1);
  assert.deepEqual(positions[0], { duration: 100, playbackRate: 1, position: 0 });
  video.currentTime = 20;
  video.dispatchEvent(new Event("seeked"));
  assert.deepEqual(positions.at(-1), { duration: 100, playbackRate: 1, position: 20 });
  (video as any).duration = NaN;
  const n = positions.length;
  video.dispatchEvent(new Event("durationchange"));
  assert.equal(positions.length, n);
});

test("una acción no admitida por el navegador no impide registrar las demás", () => {
  const { handlers } = setup({ unsupported: ["seekto"], next: true });
  assert.ok(handlers.get("play"));
  assert.ok(handlers.get("nexttrack"));
  assert.equal(handlers.has("seekto"), false);
});

test("al desmontar se limpia todo: manejadores, metadatos y eventos", () => {
  const { session, handlers, positions, video, unbind } = setup({ next: true });
  unbind();
  assert.equal(session.metadata, null);
  for (const a of ["play", "pause", "seekbackward", "seekforward", "seekto", "previoustrack", "nexttrack"]) assert.equal(handlers.get(a), null, a);
  const n = positions.length;
  video.dispatchEvent(new Event("seeked"));
  assert.equal(positions.length, n, "ya no escucha eventos");
});
