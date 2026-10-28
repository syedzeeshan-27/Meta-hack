import type { Frame } from "@/lib/agent";
import { checkParts, checkStep, finalCheck } from "@/lib/checks";
import type { Guide } from "@/lib/types";

export const maxDuration = 90;

// POST { kind: "step" | "parts" | "final", frame, guide, stepIndex? }
export async function POST(request: Request) {
  const { kind, frame, guide, stepIndex = 0 } = (await request.json()) as {
    kind?: "step" | "parts" | "final";
    frame?: Frame;
    guide?: Guide;
    stepIndex?: number;
  };
  if (!kind || !frame?.image || !guide) return Response.json({ error: "kind, frame and guide are required" }, { status: 400 });
  if (!process.env.MODEL_API_KEY) return Response.json({ error: "Checks need an API key." }, { status: 400 });

  const started = Date.now();
  try {
    const result =
      kind === "step"
        ? await checkStep(frame, guide.steps[stepIndex], guide.product)
        : kind === "parts"
          ? await checkParts(frame, guide.parts)
          : await finalCheck(frame, guide);
    return Response.json({ kind, ...result, ms: Date.now() - started });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 502 });
  }
}
