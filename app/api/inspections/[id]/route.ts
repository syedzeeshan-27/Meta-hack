import { connection } from "next/server";
import { getInspection } from "@/lib/store";

// GET → Inspection
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const inspection = await getInspection(id);
  if (!inspection) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(inspection);
}
