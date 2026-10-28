// POST FixRequest -> Server-Sent Events, one `data: <FixEvent JSON>` per event, ending with done or error.
import { runFix } from "@/lib/repair/brain";
import type { FixEvent, FixRequest, RepairState } from "@/lib/repair/types";

export const maxDuration = 90;

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const problem = validate(body);
  if (problem) return Response.json({ error: problem }, { status: 400 });
  const req = body as FixRequest;
  req.question = req.question.trim().slice(0, 2000);

  const encoder = new TextEncoder();
  const encode = (ev: FixEvent) => encoder.encode(`data: ${JSON.stringify(ev)}\n\n`);

  if (!process.env.MODEL_API_KEY) {
    const events: FixEvent[] = [
      { type: "text", delta: "Demo mode: add a Meta Model API key (MODEL_API_KEY in .env.local) to get real answers." },
      { type: "done", ms: 0 },
    ];
    return new Response(new Blob(events.map((e) => `data: ${JSON.stringify(e)}\n\n`)).stream(), { headers: SSE_HEADERS });
  }

  // Stop calling Spark/SAM when the person says something new or closes the tab.
  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort());

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const started = Date.now();
      let ended = false;
      try {
        for await (const ev of runFix(req, { signal: abort.signal })) {
          if (abort.signal.aborted) break;
          controller.enqueue(encode(ev));
          if (ev.type === "done" || ev.type === "error") ended = true;
        }
        if (!ended && !abort.signal.aborted) controller.enqueue(encode({ type: "done", ms: Date.now() - started }));
      } catch (err) {
        if (!abort.signal.aborted) {
          console.error("[/api/fix]", err);
          controller.enqueue(encode({ type: "error", message: err instanceof Error ? err.message : String(err) }));
        }
      } finally {
        try {
          controller.close();
        } catch {
          // already closed by a cancelled client
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}

function validate(body: unknown): string | null {
  if (!body || typeof body !== "object") return "Body must be a JSON object.";
  const b = body as Partial<FixRequest>;
  if (typeof b.question !== "string" || !b.question.trim()) return "question is required.";
  const f = b.frame;
  if (!f || typeof f !== "object") return "frame is required.";
  if (typeof f.image !== "string" || !/^data:image\/[a-z+]+;base64,/.test(f.image)) return "frame.image must be an image data URL.";
  if (!(Number(f.width) > 0) || !(Number(f.height) > 0)) return "frame.width and frame.height must be positive numbers.";
  const r = b.repair as Partial<RepairState> | undefined;
  if (!r || typeof r !== "object") return "repair is required.";
  if (!Array.isArray(r.causes) || !Array.isArray(r.tests) || !Array.isArray(r.gatesPassed)) return "repair needs causes, tests and gatesPassed arrays.";
  if (!Number.isInteger(r.stepIndex)) return "repair.stepIndex must be an integer.";
  if (r.guide != null && (typeof r.guide !== "object" || !Array.isArray(r.guide.steps))) return "repair.guide must have a steps array.";
  if (b.history != null) {
    if (!Array.isArray(b.history)) return "history must be an array.";
    if (b.history.some((h) => typeof h?.question !== "string" || typeof h?.answer !== "string"))
      return "history items need question and answer strings.";
  }
  return null;
}
