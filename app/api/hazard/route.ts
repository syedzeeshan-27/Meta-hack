import { watcherConfigured } from "@/lib/fireworks";
import { watchHazards } from "@/lib/hazard-watch";
import { cleanHazards } from "@/lib/repair/safety";
import type { HazardRequest } from "@/lib/repair/types";
import type { Gate } from "@/lib/types";

export const maxDuration = 30;

const GATES: Gate[] = ["unplugged", "cooled", "blade_stopped"];

// POST HazardRequest -> HazardResponse. Errors come back as JSON {error}; the client stops polling quietly.
export async function POST(request: Request) {
  let body: Partial<HazardRequest>;
  try {
    body = (await request.json()) as Partial<HazardRequest>;
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }
  const frame = body.frame;
  if (typeof frame?.image !== "string" || !frame.image.startsWith("data:image/")) {
    return Response.json({ error: "frame.image (image data URL) is required" }, { status: 400 });
  }
  if (!watcherConfigured()) {
    return Response.json({ error: "watcher off: FIREWORKS_API_KEY (or WATCHER_API_KEY) is not set" }, { status: 503 });
  }

  try {
    return Response.json(
      await watchHazards({
        frame: { image: frame.image, width: Number(frame.width) || 0, height: Number(frame.height) || 0 },
        object: typeof body.object === "string" ? body.object.slice(0, 80) : undefined,
        step: typeof body.step === "string" ? body.step.slice(0, 300) : undefined,
        hazards: cleanHazards(body.hazards),
        gatesPassed: Array.isArray(body.gatesPassed) ? body.gatesPassed.filter((g): g is Gate => GATES.includes(g)) : [],
      }),
    );
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 502 });
  }
}
