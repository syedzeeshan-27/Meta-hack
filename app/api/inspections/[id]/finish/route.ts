import { after } from "next/server";
import { comparisonStatus, hasComparison, runComparison, updateInspection } from "@/lib/inspect/jobs";

// After the response, a move-out waits up to 60 s for frames still indexing, then runs the comparison
// (one Spark call per distinct damaged view + web searches for repair costs).
export const maxDuration = 300;

const WAIT_FOR_FRAMES_MS = 60_000;

// POST → Inspection (finishedAt set). For a move-out, the comparison then appears at GET …/comparison.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const inspection = await updateInspection(id, (i) => {
    i.finishedAt ??= Date.now();
  });
  if (!inspection) return Response.json({ error: "not found" }, { status: 404 });

  // Finishing twice (a retried request) doesn't re-run a comparison that exists or is running; POST …/comparison does.
  if (inspection.kind === "move_out" && comparisonStatus(id).status !== "running" && !(await hasComparison(id))) {
    after(() => runComparison(id, { waitMs: WAIT_FOR_FRAMES_MS }).catch(() => undefined));
  }
  return Response.json(inspection);
}
