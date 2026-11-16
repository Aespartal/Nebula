import { createReadStream } from "node:fs";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { IndexedItem } from "./scanner.js";

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mkv": "video/x-matroska",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
};

/** Direct Play con soporte de HTTP Range (necesario para seek en <video>). */
export function sendRanged(req: FastifyRequest, reply: FastifyReply, item: IndexedItem) {
  const size = item.sizeBytes;
  const range = req.headers.range;
  reply.header("Accept-Ranges", "bytes");
  reply.header("Content-Type", MIME[item.ext] ?? "application/octet-stream");

  if (!range) {
    reply.header("Content-Length", size);
    return reply.send(createReadStream(item.absPath));
  }

  const m = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!m || (m[1] === "" && m[2] === "")) {
    return reply.code(416).header("Content-Range", `bytes */${size}`).send();
  }
  let start: number;
  let end: number;
  if (m[1] === "") {
    // sufijo: últimos N bytes
    start = Math.max(size - Number(m[2]), 0);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) {
    return reply.code(416).header("Content-Range", `bytes */${size}`).send();
  }
  reply
    .code(206)
    .header("Content-Range", `bytes ${start}-${end}/${size}`)
    .header("Content-Length", end - start + 1);
  return reply.send(createReadStream(item.absPath, { start, end }));
}
