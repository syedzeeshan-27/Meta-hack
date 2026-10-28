import { roomFor, updateInspection } from "@/lib/inspect/jobs";
import type { AddNoteRequest } from "@/lib/inspect/types";

// POST { room, t, text } → { ok: true }
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: Partial<AddNoteRequest>;
  try {
    body = (await request.json()) as Partial<AddNoteRequest>;
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const room = typeof body.room === "string" ? body.room.trim().slice(0, 60) : "";
  const text = typeof body.text === "string" ? body.text.trim().slice(0, 2000) : "";
  const t = Number.isFinite(Number(body.t)) && Number(body.t) > 0 ? Number(body.t) : Date.now();
  if (!room) return Response.json({ error: "room is required." }, { status: 400 });
  if (!text) return Response.json({ error: "text is required." }, { status: 400 });

  const saved = await updateInspection(id, (i) => {
    roomFor(i, room).notes.push({ t, text });
  });
  if (!saved) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ ok: true });
}
