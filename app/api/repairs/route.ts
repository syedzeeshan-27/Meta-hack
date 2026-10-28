// POST SaveRepairRequest -> { id }: stores the before/after photos and the repair card (one write, at the end).
import { randomUUID } from "node:crypto";
import { dataUrlToBuffer, savePhoto, saveRepair } from "@/lib/store";
import type { RepairCard, SaveRepairRequest, StoredPhoto } from "@/lib/repair/types";
import type { Frame } from "@/lib/types";

const MAX_PHOTO_BYTES = 3_000_000;

export async function POST(request: Request) {
  let body: Partial<SaveRepairRequest>;
  try {
    body = (await request.json()) as Partial<SaveRepairRequest>;
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const r = body.repair;
  if (!r || typeof r !== "object" || !Array.isArray(r.causes) || !Array.isArray(r.tests)) {
    return Response.json({ error: "repair is required." }, { status: 400 });
  }

  const id = randomUUID().replace(/-/g, "").slice(0, 12);
  try {
    const [before, after] = await Promise.all([store(id, "before", body.before), store(id, "after", body.after)]);
    const card: RepairCard = {
      id,
      createdAt: Date.now(),
      object: r.object?.name ? r.object : { name: "Device" },
      ...(r.complaint && { complaint: String(r.complaint).slice(0, 300) }),
      causes: r.causes.slice(0, 4),
      tests: r.tests.slice(-12),
      ...(r.verdict && { verdict: r.verdict }),
      ...(r.research && { research: r.research }),
      steps: (r.guide?.steps ?? []).map((s) => s.instruction).slice(0, 20),
      fixed: !!r.outcome?.fixed,
      summary: String(r.outcome?.summary ?? "").slice(0, 600),
      ...(before && { before }),
      ...(after && { after }),
      minutes: Math.max(1, Math.round((Date.now() - (Number(r.startedAt) || Date.now())) / 60_000)),
    };
    await saveRepair(card);
    return Response.json({ id });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 502 });
  }
}

async function store(id: string, side: "before" | "after", frame?: Frame): Promise<StoredPhoto | undefined> {
  if (!frame || typeof frame.image !== "string" || !frame.image.startsWith("data:image/jpeg;base64,")) return undefined;
  const jpeg = dataUrlToBuffer(frame.image);
  if (!jpeg.length || jpeg.length > MAX_PHOTO_BYTES) return undefined;
  const { url } = await savePhoto(`repairs/${id}-${side}`, jpeg);
  return { url, width: Number(frame.width) || 0, height: Number(frame.height) || 0 };
}
