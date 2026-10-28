import { locatePart } from "@/lib/locate";
import type { SegmentResponse } from "@/lib/types";

// POST { image: dataURL, phrase, width, height } -> outlines of the part, in image pixels.
export async function POST(request: Request) {
  const { image, phrase, width, height } = (await request.json()) as {
    image: string;
    phrase: string;
    width: number;
    height: number;
  };
  if (!image || !phrase || !width || !height) {
    return Response.json({ error: "image, phrase, width and height are required" }, { status: 400 });
  }

  const started = Date.now();
  if (!process.env.MODEL_API_KEY) return Response.json(fakeSegment(started));

  try {
    const found = await locatePart(image, phrase, { width, height });
    return Response.json({ ...found, ms: Date.now() - started } satisfies SegmentResponse);
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 502 });
  }
}

// Without an API key the UI still works: a pulsing rounded box in the middle of the frame.
function fakeSegment(started: number): SegmentResponse {
  return {
    width: 1280,
    height: 720,
    outlines: [
      {
        id: "0",
        box: { left: 520, top: 260, right: 760, bottom: 460 },
        path: "M20 0 L220 0 L240 20 L240 180 L220 200 L20 200 L0 180 L0 20 Z",
        transform: "translate(520 260)",
      },
    ],
    via: "name",
    ms: Date.now() - started,
    fake: true,
  };
}
