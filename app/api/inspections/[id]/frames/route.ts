import { after } from "next/server";
import { shortId } from "@/lib/inspect/index-frame";
import { roomFor, startIndexing, updateInspection } from "@/lib/inspect/jobs";
import type { AddFrameRequest, AddFrameResponse, Frame } from "@/lib/inspect/types";
import { dataUrlToBuffer, getInspection, savePhoto } from "@/lib/store";

// Indexing runs after the response; a frame can wait behind others in the 3-at-a-time queue.
export const maxDuration = 300;

const MAX_BYTES = 8 * 1024 * 1024;

// POST { room, t, image (JPEG data URL), width, height } → { frame } (status "pending"; indexed in the background)
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: Partial<AddFrameRequest>;
  try {
    body = (await request.json()) as Partial<AddFrameRequest>;
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const room = typeof body.room === "string" ? body.room.trim().slice(0, 60) : "";
  const width = Math.round(Number(body.width));
  const height = Math.round(Number(body.height));
  const t = Number.isFinite(Number(body.t)) && Number(body.t) > 0 ? Number(body.t) : Date.now();
  if (!room) return Response.json({ error: "room is required." }, { status: 400 });
  if (!(width > 0 && height > 0)) return Response.json({ error: "width and height must be positive numbers." }, { status: 400 });
  if (typeof body.image !== "string" || !body.image.startsWith("data:image/")) {
    return Response.json({ error: "image must be a JPEG data URL." }, { status: 400 });
  }

  const jpeg = dataUrlToBuffer(body.image);
  if (jpeg.length < 3 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || jpeg[2] !== 0xff) {
    return Response.json({ error: "image must be a JPEG data URL." }, { status: 400 });
  }
  if (jpeg.length > MAX_BYTES) return Response.json({ error: "image is larger than 8 MB." }, { status: 413 });
  if (!(await getInspection(id))) return Response.json({ error: "not found" }, { status: 404 });

  const frameId = `f${shortId(9)}`;
  const { url, sha256 } = await savePhoto(`${id}/${frameId}`, jpeg);
  const frame: Frame = { id: frameId, t, imageUrl: url, sha256, width, height, items: [], defects: [], status: "pending" };

  let roomName = room;
  const saved = await updateInspection(id, (i) => {
    const r = roomFor(i, room);
    roomName = r.name;
    r.frames.push(frame);
  });
  if (!saved) return Response.json({ error: "not found" }, { status: 404 });

  const image = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  after(() => startIndexing(id, frameId, image, { width, height }, roomName));

  return Response.json({ frame } satisfies AddFrameResponse);
}
