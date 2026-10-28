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
        path: "M540 260 L740 260 L760 280 L760 440 L740 460 L540 460 L520 440 L520 280 Z",
      },
    ],
    ms: Date.now() - started,
    fake: true,
  };
}
