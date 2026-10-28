// Finds a named part in a camera frame: SAM by name first, then Spark points at it and SAM outlines from the point.
import { sam, samAtPoint, spark, type Segmentation } from "./meta";

export type Located = Segmentation & {
  /** "name": SAM found it from the phrase. "pointed": Spark pointed at it, SAM outlined from the point. */
  via: "name" | "pointed" | "none";
};

const POINT_SCHEMA = {
  name: "point",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["found", "x", "y"],
    properties: { found: { type: "boolean" }, x: { type: "number" }, y: { type: "number" } },
  },
};

export async function locatePart(
  image: string,
  phrase: string,
  size: { width: number; height: number },
): Promise<Located> {
  const byName = await sam(image, phrase);
  if (byName.outlines.length) return { ...byName, via: "name" };

  // SAM's text prompt misses some parts entirely (a loose backrest lying upside down, for one),
  // but Spark can still see them. Ask it where the part is, then let SAM outline from that point.
  const point = await spark<{ found: boolean; x: number; y: number }>(
    [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              `Point at the ${phrase} in this image. Give x and y from 0 to 1000 ` +
              "(0,0 = top-left, 1000,1000 = bottom-right), on the object itself, not its edge. " +
              "found=false if it isn't visible.",
          },
          { type: "image_url", image_url: { url: image } },
        ],
      },
    ],
    { schema: POINT_SCHEMA, effort: "low" },
  );
  if (!point.found) return { width: size.width, height: size.height, outlines: [], via: "none" };

  const pointed = await samAtPoint(
    image,
    { x: (point.x / 1000) * size.width, y: (point.y / 1000) * size.height },
    size,
  );
  // A point that misses the part by a few pixels lands on the floor or wall, and SAM then
  // outlines the whole background. No single part fills most of the frame, so drop those.
  const outlines = pointed.outlines.filter((o) => boxShare(o.box, size) < MAX_PART_SHARE);
  return { ...pointed, outlines, via: outlines.length ? "pointed" : "none" };
}

const MAX_PART_SHARE = 0.5;

function boxShare(b: { left: number; top: number; right: number; bottom: number }, size: { width: number; height: number }) {
  return ((b.right - b.left) * (b.bottom - b.top)) / (size.width * size.height);
}
