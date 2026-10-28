// Serves locally stored photos (.data/photos/**) in dev. On Vercel, photos are Blob URLs and this isn't used.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { localFilePath } from "@/lib/store";

const TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const notFound = () => new Response("Not found", { status: 404 });

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const parts = (await params).path ?? [];
  if (parts[0] !== "photos") return notFound();
  const file = localFilePath(parts.join("/"));
  const type = file ? TYPES[path.extname(file).toLowerCase()] : undefined;
  if (!file || !type) return notFound();
  try {
    const bytes = await readFile(file);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": type,
        "Content-Length": String(bytes.length),
        // Photo keys are never reused, so the bytes at a URL never change.
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return notFound();
  }
}
