import { askAgent, type Frame } from "@/lib/agent";
import type { Guide } from "@/lib/types";

export const maxDuration = 60;

// POST { question, frame: {image,width,height}, guide, stepIndex } -> AgentReply
export async function POST(request: Request) {
  const body = (await request.json()) as { question?: string; frame?: Frame; guide?: Guide; stepIndex?: number };
  if (!body.question?.trim() || !body.frame?.image || !body.guide) {
    return Response.json({ error: "question, frame and guide are required" }, { status: 400 });
  }
  if (!process.env.MODEL_API_KEY) return Response.json({ say: "Demo mode: add an API key to get real answers.", actions: [] });

  const started = Date.now();
  try {
    const reply = await askAgent({
      question: body.question.trim(),
      frame: body.frame,
      guide: body.guide,
      stepIndex: body.stepIndex ?? 0,
    });
    return Response.json({ ...reply, ms: Date.now() - started });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 502 });
  }
}
