import { connection } from "next/server";
import { shortId } from "@/lib/inspect/index-frame";
import type { CreateInspectionRequest, Inspection } from "@/lib/inspect/types";
import { getInspection, listInspections, saveInspection } from "@/lib/store";

// POST { kind, property, city, baselineId? } → Inspection
export async function POST(request: Request) {
  let body: Partial<CreateInspectionRequest>;
  try {
    body = (await request.json()) as Partial<CreateInspectionRequest>;
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const kind = body.kind;
  const property = typeof body.property === "string" ? body.property.trim().slice(0, 200) : "";
  const city = typeof body.city === "string" ? body.city.trim().slice(0, 100) : "";
  if (kind !== "move_in" && kind !== "move_out") return Response.json({ error: 'kind must be "move_in" or "move_out".' }, { status: 400 });
  if (!property) return Response.json({ error: "property is required." }, { status: 400 });
  if (!city) return Response.json({ error: "city is required." }, { status: 400 });

  let baselineId: string | undefined;
  if (kind === "move_out") {
    if (typeof body.baselineId !== "string" || !body.baselineId) {
      return Response.json({ error: "A move-out needs baselineId (the move-in inspection)." }, { status: 400 });
    }
    const baseline = await getInspection(body.baselineId);
    if (!baseline) return Response.json({ error: `Move-in inspection ${body.baselineId} not found.` }, { status: 404 });
    if (baseline.kind !== "move_in") return Response.json({ error: "baselineId must be a move-in inspection." }, { status: 400 });
    baselineId = baseline.id;
  }

  let id = shortId(8);
  while (await getInspection(id)) id = shortId(8);
  const inspection: Inspection = {
    id,
    kind,
    ...(baselineId && { baselineId }),
    property,
    city,
    createdAt: Date.now(),
    rooms: [],
  };
  await saveInspection(inspection);
  return Response.json(inspection);
}

// GET → Inspection[] newest first
export async function GET() {
  await connection();
  return Response.json(await listInspections());
}
