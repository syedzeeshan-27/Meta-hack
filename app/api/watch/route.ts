import type { WatchRequest } from "@/lib/live-types";
import { watcherConfigured } from "@/lib/fireworks";
import { watch } from "@/lib/watcher";

export const maxDuration = 30;

// POST WatchRequest -> WatchResponse. Errors come back as JSON {error}; the client stops polling quietly.
export async function POST(request: Request) {
  let body: Partial<WatchRequest>;
  try {
    body = (await request.json()) as Partial<WatchRequest>;
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }
  const { sessionId, frame } = body;
  if (
    typeof sessionId !== "string" ||
    !sessionId.trim() ||
    typeof frame?.image !== "string" ||
    !frame.image.startsWith("data:image/")
  ) {
    return Response.json({ error: "sessionId and frame.image (image data URL) are required" }, { status: 400 });
  }
  if (!watcherConfigured()) {
    return Response.json({ error: "watcher off: FIREWORKS_API_KEY (or WATCHER_API_KEY) is not set" }, { status: 503 });
  }

  try {
    const out = await watch({
      sessionId,
      frame: { image: frame.image, width: Number(frame.width) || 0, height: Number(frame.height) || 0 },
    });
    return Response.json(out);
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 502 });
  }
}
