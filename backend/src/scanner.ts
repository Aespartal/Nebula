import { createHash } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { MediaItem } from "@nebula/shared";
import { VIDEO_EXTS } from "./config.js";

export interface IndexedItem extends MediaItem {
  absPath: string;
}

const idFor = (relPath: string) =>
  createHash("sha1").update(relPath).digest("hex").slice(0, 16);

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

export async function scanLibrary(root: string): Promise<IndexedItem[]> {
  const items: IndexedItem[] = [];
  for await (const file of walk(root)) {
    const ext = path.extname(file).toLowerCase();
    if (!VIDEO_EXTS.has(ext)) continue;
    const relPath = path.relative(root, file).split(path.sep).join("/");
    const { size } = await stat(file);
    items.push({
      id: idFor(relPath),
      title: path.basename(file, ext),
      relPath,
      sizeBytes: size,
      ext,
      absPath: file,
    });
  }
  return items.sort((a, b) => a.relPath.localeCompare(b.relPath));
}
