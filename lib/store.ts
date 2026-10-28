// Storage for inspections, comparisons and photos.
// Dev: files under .data/ (served by /api/files/[...path]). Production: Vercel Blob when BLOB_READ_WRITE_TOKEN is set.
// This first version is the local-file backend; the Blob backend plugs in behind the same functions.
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Comparison, Inspection } from "./inspect/types";

const ROOT = path.join(process.cwd(), ".data");

async function writeJson(rel: string, data: unknown) {
  const file = path.join(ROOT, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2));
}

async function readJson<T>(rel: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path.join(ROOT, rel), "utf8")) as T;
  } catch {
    return null;
  }
}

export const saveInspection = (i: Inspection) => writeJson(`inspections/${i.id}.json`, i);
export const getInspection = (id: string) => readJson<Inspection>(`inspections/${id}.json`);
export const saveComparison = (c: Comparison) => writeJson(`comparisons/${c.inspectionId}.json`, c);
export const getComparison = (inspectionId: string) => readJson<Comparison>(`comparisons/${inspectionId}.json`);

export async function listInspections(): Promise<Inspection[]> {
  try {
    const files = await readdir(path.join(ROOT, "inspections"));
    const all = await Promise.all(files.map((f) => readJson<Inspection>(`inspections/${f}`)));
    return all.filter((i): i is Inspection => !!i).sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

/** Stores a JPEG and returns a URL the browser can load plus the SHA-256 of the stored bytes. */
export async function savePhoto(key: string, jpeg: Buffer): Promise<{ url: string; sha256: string }> {
  const sha256 = createHash("sha256").update(jpeg).digest("hex");
  const rel = `photos/${key}.jpg`;
  const file = path.join(ROOT, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, jpeg);
  return { url: `/api/files/${rel}`, sha256 };
}

/** Reads a stored photo back as a data URL (models need the bytes, not our local URL). */
export async function photoDataUrl(url: string): Promise<string> {
  const rel = url.replace(/^\/api\/files\//, "");
  const bytes = await readFile(path.join(ROOT, rel));
  return `data:image/jpeg;base64,${bytes.toString("base64")}`;
}

/** Decodes a JPEG data URL into bytes. */
export function dataUrlToBuffer(dataUrl: string): Buffer {
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
}
