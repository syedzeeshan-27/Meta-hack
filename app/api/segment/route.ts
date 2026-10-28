import { sam } from "@/lib/meta";
import type { SegmentResponse } from "@/lib/types";

// POST { image: dataURL, phrase: string } -> outlines of every match, in image pixels.
export async function POST(request: Request) {
  const { image, phrase } = (await request.json()) as { image: string; phrase: string };
  if (!image || !phrase) return Response.json({ error: "image and phrase are required" }, { status: 400 });

  const started = Date.now();
  if (!process.env.MODEL_API_KEY) return Response.json(fakeSegment(started));

  try {
    const seg = await sam(image, phrase);
    return Response.json({ ...seg, ms: Date.now() - started } satisfies SegmentResponse);
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 502 });
  }
}

// Without an API key the UI still works: a pulsing rounded box in the middle of the frame.
function fakeSegment(started: number): SegmentResponse {
  const w = 1280;
  const h = 720;
  return {
    width: w,
    height: h,
    outlines: [
      {
        id: "0",
        box: { left: 520, top: 260, right: 760, bottom: 460 },
        path: "M20 0 L220 0 L240 20 L240 180 L220 200 L20 200 L0 180 L0 20 Z",
        transform: "translate(520 260)",
      },
    ],
    ms: Date.now() - started,
    fake: true,
  };
}
