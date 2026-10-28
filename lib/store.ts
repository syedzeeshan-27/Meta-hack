// Storage for repair cards and their photos.
// Default: files under .data/ (photos served by /api/files/[...path]).
// When BLOB_READ_WRITE_TOKEN is set (Vercel): Vercel Blob. A card is written once, at the end of a repair,
// so there are no concurrent writers; photos are public blobs with a random suffix.
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RepairCard } from "./repair/types";

const ROOT = path.join(process.cwd(), ".data");
const ONE_YEAR = 365 * 24 * 60 * 60;

const onBlob = () => !!process.env.BLOB_READ_WRITE_TOKEN;
// Loaded only on the Blob path, so local dev never touches it.
const blobSdk = () => import("@vercel/blob");

/** Ids end up in file paths and blob pathnames, so only plain ids are accepted. */
const isSafeId = (id: string) => /^[A-Za-z0-9_-]{1,100}$/.test(id);

/** Absolute path of a file under .data/, or null if `rel` tries to leave it. */
export function localFilePath(rel: string): string | null {
  const parts = rel.split("/");
  if (parts.some((p) => !p || p === "." || p === ".." || /[\\:\0]/.test(p))) return null;
  const file = path.resolve(ROOT, ...parts);
  return file.startsWith(ROOT + path.sep) ? file : null;
}

// ---------- JSON documents ----------

async function writeJson(rel: string, data: unknown) {
  const body = JSON.stringify(data, null, 2);
  if (onBlob()) {
    const { put } = await blobSdk();
    await put(rel, body, {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 60,
    });
    return;
  }
  const file = path.join(ROOT, rel);
  await mkdir(path.dirname(file), { recursive: true });
  // Write then rename, so a reader never sees half a file. Windows can refuse the rename while
  // a reader has the file open; then fall back to a plain write.
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, body);
  try {
    await rename(tmp, file);
  } catch {
    await writeFile(file, body);
    await rm(tmp, { force: true });
  }
}

/** Fetches a public JSON blob, skipping CDN copies of older versions (the etag changes on every write). */
async function fetchBlobJson<T>(url: string, etag: string): Promise<T | null> {
  const res = await fetch(`${url}?v=${encodeURIComponent(etag)}`, { cache: "no-store" });
  return res.ok ? ((await res.json()) as T) : null;
}

async function readJson<T>(rel: string): Promise<T | null> {
  if (onBlob()) {
    const { head, BlobNotFoundError } = await blobSdk();
    try {
      // head() asks the Blob API directly, so the url + etag are current.
      const meta = await head(rel);
      return await fetchBlobJson<T>(meta.url, meta.etag);
    } catch (err) {
      if (err instanceof BlobNotFoundError) return null;
      throw err;
    }
  }
  try {
    return JSON.parse(await readFile(path.join(ROOT, rel), "utf8")) as T;
  } catch {
    return null;
  }
}

export const saveRepair = (c: RepairCard) => writeJson(`repairs/${c.id}.json`, c);
export const getRepair = async (id: string) => (isSafeId(id) ? readJson<RepairCard>(`repairs/${id}.json`) : null);

// ---------- Photos ----------

/** Stores a JPEG and returns a URL the browser can load plus the SHA-256 of the stored bytes. */
export async function savePhoto(key: string, jpeg: Buffer): Promise<{ url: string; sha256: string }> {
  const sha256 = createHash("sha256").update(jpeg).digest("hex");
  const rel = `photos/${key}.jpg`;
  if (onBlob()) {
    const { put } = await blobSdk();
    const blob = await put(rel, jpeg, {
      access: "public",
      contentType: "image/jpeg",
      addRandomSuffix: true,
      cacheControlMaxAge: ONE_YEAR,
    });
    return { url: blob.url, sha256 };
  }
  const file = localFilePath(rel);
  if (!file) throw new Error(`Bad photo key: ${key}`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, jpeg);
  return { url: `/api/files/${rel}`, sha256 };
}

/** Reads a stored photo back as a data URL (models need the bytes, not our URL). */
export async function photoDataUrl(url: string): Promise<string> {
  if (/^https?:\/\//.test(url)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Photo fetch failed (${res.status}): ${url}`);
    const type = res.headers.get("content-type") ?? "image/jpeg";
    return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
  }
  const file = localFilePath(url.replace(/^\/api\/files\//, ""));
  if (!file) throw new Error(`Bad photo url: ${url}`);
  return `data:image/jpeg;base64,${(await readFile(file)).toString("base64")}`;
}

/** Decodes a JPEG data URL into bytes. */
export function dataUrlToBuffer(dataUrl: string): Buffer {
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
}
