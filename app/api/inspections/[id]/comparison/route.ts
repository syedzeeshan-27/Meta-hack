import { connection } from "next/server";
import { comparisonStatus, runComparison } from "@/lib/inspect/jobs";
import { getComparison, getInspection } from "@/lib/store";

// POST re-runs the comparison and waits for it (frames still indexing get up to 60 s first).
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

// GET → Comparison, or 404 { error: "not ready", status: "running" | "failed" | "not_started", detail? }
export async function GET(_request: Request, { params }: Ctx) {
  await connection();
  const { id } = await params;
  const saved = await getComparison(id);
  if (saved) return Response.json(saved);

  const inspection = await getInspection(id);
  if (!inspection) return Response.json({ error: "not found" }, { status: 404 });
  if (inspection.kind !== "move_out") {
    return Response.json({ error: "Only move-out inspections have a comparison." }, { status: 404 });
  }
  const { status, error } = comparisonStatus(id);
  return Response.json({ error: "not ready", status, ...(error && { detail: error }) }, { status: 404 });
}

// POST → Comparison (re-run). Joins a run that's already going instead of starting a second one.
export async function POST(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const inspection = await getInspection(id);
  if (!inspection) return Response.json({ error: "not found" }, { status: 404 });
  if (inspection.kind !== "move_out" || !inspection.baselineId) {
    return Response.json({ error: "Only a move-out inspection with a baseline can be compared." }, { status: 400 });
  }
  try {
    return Response.json(await runComparison(id, { waitMs: 60_000 }));
  } catch (err) {
    return Response.json({ error: String(err instanceof Error ? err.message : err) }, { status: 502 });
  }
}
